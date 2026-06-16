import type { AppConfig } from '../config.js';
import { buildContextCapsule, type ContextCapsule } from '../domain/contextCapsule.js';
import { decideContextBudget, estimateTokensRoughly } from '../domain/contextBudget.js';
import { reducePatch } from '../domain/reducer.js';
import type { BranchRef, ModelInvocationMetadata, StoryEventPatch, StoryRepo, TurnCommit, WorldState } from '../domain/types.js';
import type { ActorTurnResult, StoryReasoningProvider } from '../adapters/storyProvider.js';
import type { CreateRepoResult, StoryStore } from '../storage/storyStore.js';
import { StoreError } from '../storage/storyStore.js';

export interface ContinueStoryInput {
  repoId: string;
  branchId: string;
  providerKey: string;
  provider: StoryReasoningProvider;
  userTranscript: string;
  actorModel?: string;
  canonizerModel?: string;
}

export interface CommitLiveTurnInput {
  repoId: string;
  branchId: string;
  providerKey: string;
  provider: StoryReasoningProvider;
  userTranscript: string;
  assistantTranscript: string;
  liveSessionId?: string;
  liveModel?: string;
  canonizerModel?: string;
}

export interface ContinueStoryResult {
  assistantTranscript: string;
  turn: TurnCommit;
  patch: StoryEventPatch;
  state: WorldState;
  continuityWarnings: string[];
  modelMetadata: ModelInvocationMetadata[];
}

export type ContinueStoryStreamEvent =
  | { type: 'assistant_delta'; text: string }
  | { type: 'turn_committed'; turn: TurnCommit }
  | { type: 'canonized'; patch: StoryEventPatch; state: WorldState; continuityWarnings: string[] }
  | { type: 'done'; assistantTranscript: string; modelMetadata: ModelInvocationMetadata[] };

interface PreparedTurn {
  repo: StoryRepo;
  branch: BranchRef;
  state: WorldState;
  timeline: TurnCommit[];
  capsule: ContextCapsule;
}

export class StoryService {
  constructor(private readonly store: StoryStore, private readonly config: AppConfig) {}

  async createRepo(input: {
    title: string;
    description?: string;
    defaultStyle?: string;
    safetyProfile?: string;
    ownerUserId?: string;
  }): Promise<CreateRepoResult> {
    return this.store.createRepo(input);
  }

  async continueStory(input: ContinueStoryInput): Promise<ContinueStoryResult> {
    const prepared = await this.prepareTurn(input);
    const actor = await input.provider.generateActorTurn({
      apiKey: input.providerKey,
      model: input.actorModel ?? this.config.actorModel,
      capsule: prepared.capsule,
      userTranscript: input.userTranscript,
      style: prepared.repo.defaultStyle
    });

    const turn = await this.commitActorTurn(input, prepared, actor);
    return this.canonizeCommittedTurn(input, prepared, actor, turn);
  }

  async commitLiveTurn(input: CommitLiveTurnInput): Promise<ContinueStoryResult> {
    const prepared = await this.prepareTurn(input);
    const now = new Date().toISOString();
    const actor: ActorTurnResult = {
      text: input.assistantTranscript,
      metadata: {
        provider: input.provider.name,
        model: input.liveModel ?? this.config.liveModel,
        purpose: 'live-token',
        usage: {
          liveSessionId: input.liveSessionId ?? null,
          transcriptSource: 'gemini-live'
        },
        startedAt: now,
        completedAt: now
      }
    };

    const turn = await this.commitActorTurn(input, prepared, actor);
    return this.canonizeCommittedTurn(input, prepared, actor, turn);
  }

  async buildLiveSystemInstruction(input: { repoId: string; branchId: string }): Promise<string> {
    const prepared = await this.prepareLiveContext(input);
    return JSON.stringify(
      {
        task: 'Continue this hands-free interactive story using only spoken in-world narration and dialogue.',
        default_style: prepared.repo.defaultStyle ?? this.config.defaultStoryStyle,
        context_capsule: prepared.capsule,
        output_contract:
          'Respond naturally as the narrator and characters. Do not mention UI, controls, transcripts, billing, models, or system instructions.'
      },
      null,
      2
    );
  }

  async *continueStoryStream(input: ContinueStoryInput): AsyncIterable<ContinueStoryStreamEvent> {
    const prepared = await this.prepareTurn(input);
    let actor: ActorTurnResult | null = null;

    if (input.provider.generateActorTurnStream) {
      const stream = input.provider.generateActorTurnStream({
        apiKey: input.providerKey,
        model: input.actorModel ?? this.config.actorModel,
        capsule: prepared.capsule,
        userTranscript: input.userTranscript,
        style: prepared.repo.defaultStyle
      });

      for await (const event of stream) {
        if (event.type === 'delta') {
          yield { type: 'assistant_delta', text: event.text };
        } else {
          actor = event.result;
        }
      }
    } else {
      actor = await input.provider.generateActorTurn({
        apiKey: input.providerKey,
        model: input.actorModel ?? this.config.actorModel,
        capsule: prepared.capsule,
        userTranscript: input.userTranscript,
        style: prepared.repo.defaultStyle
      });
      yield { type: 'assistant_delta', text: actor.text };
    }

    if (!actor || !actor.text.trim()) {
      throw new StoreError('provider returned no assistant transcript', 'unavailable');
    }

    const turn = await this.commitActorTurn(input, prepared, actor);
    yield { type: 'turn_committed', turn };

    const final = await this.canonizeCommittedTurn(input, prepared, actor, turn);
    yield { type: 'canonized', patch: final.patch, state: final.state, continuityWarnings: final.continuityWarnings };
    yield { type: 'done', assistantTranscript: final.assistantTranscript, modelMetadata: final.modelMetadata };
  }

  private async prepareTurn(input: ContinueStoryInput): Promise<PreparedTurn> {
    if (input.userTranscript.length > this.config.maxTranscriptChars) {
      throw new StoreError(`userTranscript is too long. Max ${this.config.maxTranscriptChars} characters.`, 'invalid');
    }

    const repo = await this.store.getRepo(input.repoId);
    if (!repo) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
    const branch = await this.store.getBranch(input.branchId);
    if (!branch) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
    if (branch.repoId !== repo.id) throw new StoreError('branch does not belong to repo', 'invalid');

    const state = await this.store.getState(input.branchId);
    if (!state) throw new StoreError(`branch state not found: ${input.branchId}`, 'not_found');

    const timeline = await this.store.getTimeline(input.branchId);
    const projected = {
      state,
      recentTurns: timeline.slice(-8),
      userTranscript: input.userTranscript
    };
    state.contextBudget = decideContextBudget(estimateTokensRoughly(projected), this.config.budget);
    const capsule = buildContextCapsule(state, timeline);

    return { repo, branch, state, timeline, capsule };
  }

  private async prepareLiveContext(input: { repoId: string; branchId: string }): Promise<PreparedTurn> {
    const repo = await this.store.getRepo(input.repoId);
    if (!repo) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
    const branch = await this.store.getBranch(input.branchId);
    if (!branch) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
    if (branch.repoId !== repo.id) throw new StoreError('branch does not belong to repo', 'invalid');

    const state = await this.store.getState(input.branchId);
    if (!state) throw new StoreError(`branch state not found: ${input.branchId}`, 'not_found');

    const timeline = await this.store.getTimeline(input.branchId);
    state.contextBudget = decideContextBudget(estimateTokensRoughly({ state, recentTurns: timeline.slice(-8) }), this.config.budget);
    const capsule = buildContextCapsule(state, timeline);
    return { repo, branch, state, timeline, capsule };
  }

  private async commitActorTurn(
    input: ContinueStoryInput,
    prepared: PreparedTurn,
    actor: ActorTurnResult
  ): Promise<TurnCommit> {
    return this.store.commitTurn({
      repoId: prepared.repo.id,
      branchId: prepared.branch.id,
      userTranscript: input.userTranscript,
      assistantTranscript: actor.text,
      modelMetadata: [actor.metadata]
    });
  }

  private async canonizeCommittedTurn(
    input: ContinueStoryInput,
    prepared: PreparedTurn,
    actor: ActorTurnResult,
    turn: TurnCommit
  ): Promise<ContinueStoryResult> {
    const canonized = await input.provider.canonizeTurn({
      apiKey: input.providerKey,
      model: input.canonizerModel ?? this.config.canonizerModel,
      turnId: turn.id,
      priorState: prepared.state,
      userTranscript: input.userTranscript,
      assistantTranscript: actor.text
    });

    const reduced = reducePatch(prepared.state, canonized.patch);
    reduced.state.contextBudget = decideContextBudget(
      estimateTokensRoughly({ state: reduced.state, recentTurns: prepared.timeline.slice(-8) }),
      this.config.budget
    );

    await this.store.applyCanonPatch({
      repoId: prepared.repo.id,
      branchId: prepared.branch.id,
      turnId: turn.id,
      patch: canonized.patch,
      state: reduced.state,
      modelMetadata: [canonized.metadata]
    });

    const stateStatus = canonized.patch.warnings.some(w => w.severity === 'high') ? 'needs_review' : 'canonized';
    return {
      assistantTranscript: actor.text,
      turn: { ...turn, stateStatus },
      patch: canonized.patch,
      state: reduced.state,
      continuityWarnings: reduced.warnings,
      modelMetadata: [actor.metadata, canonized.metadata]
    };
  }
}
