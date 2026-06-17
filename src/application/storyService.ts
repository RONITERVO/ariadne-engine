import type { AppConfig } from '../config.js';
import {
  ACTION_ID,
  ACTION_TOKEN,
  ActionGateError,
  type ActionTokenSnapshot,
  type ActionTokenSet,
  createActionTokenSet
} from '../domain/actionTokens.js';
import { buildContextCapsule, type ContextCapsule } from '../domain/contextCapsule.js';
import { CONTEXT_BUDGET_MODE, decideContextBudget, estimateTokensRoughly } from '../domain/contextBudget.js';
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
  expectedHeadTurnId: string | null;
  userAudioAssetId?: string | null;
  assistantAudioAssetId?: string | null;
  actorModel?: string;
  canonizerModel?: string;
  tokens?: ActionTokenSet;
}

export interface CommitLiveTurnInput {
  repoId: string;
  branchId: string;
  providerKey: string;
  provider: StoryReasoningProvider;
  userTranscript: string;
  assistantTranscript: string;
  liveSessionId?: string;
  expectedHeadTurnId: string | null;
  userAudioAssetId?: string | null;
  assistantAudioAssetId?: string | null;
  liveModel?: string;
  canonizerModel?: string;
  tokens?: ActionTokenSet;
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
  | { type: 'done'; assistantTranscript: string; modelMetadata: ModelInvocationMetadata[]; tokens?: ActionTokenSnapshot };

interface PreparedTurn {
  repo: StoryRepo;
  branch: BranchRef;
  expectedHeadTurnId: string | null;
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
    return this.withBranchMutationLease(input, async () => {
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
    });
  }

  async commitLiveTurn(input: CommitLiveTurnInput): Promise<ContinueStoryResult> {
    return this.withBranchMutationLease(input, async () => {
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
    });
  }

  async buildLiveSystemInstruction(input: { repoId: string; branchId: string; tokens?: ActionTokenSet }): Promise<string> {
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
    const tokens = turnTokens(input);
    const lease = await this.acquireBranchMutationLease(input, tokens);
    try {
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
      const final = await this.canonizeCommittedTurn(input, prepared, actor, turn);
      yield { type: 'turn_committed', turn: final.turn };
      yield { type: 'canonized', patch: final.patch, state: final.state, continuityWarnings: final.continuityWarnings };
      yield { type: 'done', assistantTranscript: final.assistantTranscript, modelMetadata: final.modelMetadata };
    } finally {
      await this.releaseBranchMutationLeaseBestEffort(lease);
    }
  }

  private async prepareTurn(input: ContinueStoryInput): Promise<PreparedTurn> {
    const tokens = turnTokens(input);
    if (input.userTranscript.length > this.config.maxTranscriptChars) {
      throw tokens.fail(
        `userTranscript is too long. Max ${this.config.maxTranscriptChars} characters.`,
        400,
        'store_invalid',
        ACTION_TOKEN.CONTEXT_TRANSCRIPT_TOO_LONG
      );
    }
    tokens.add(ACTION_TOKEN.CONTEXT_TRANSCRIPT_WITHIN_LIMIT);

    const repo = await this.store.getRepo(input.repoId);
    if (!repo) {
      throw tokens.fail(`repo not found: ${input.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    }
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    const branch = await this.store.getBranch(input.branchId);
    if (!branch) {
      throw tokens.fail(`branch not found: ${input.branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
    }
    tokens.add(ACTION_TOKEN.STORY_BRANCH_FOUND);
    if (branch.repoId !== repo.id) {
      throw tokens.fail('branch does not belong to repo', 400, 'store_invalid', ACTION_TOKEN.STORY_BRANCH_REPO_MISMATCH);
    }
    tokens.add(ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO);
    const branchHeadTurnId = branch.headTurnId ?? null;
    if (input.expectedHeadTurnId !== undefined && input.expectedHeadTurnId !== branchHeadTurnId) {
      throw tokens.fail('branch head moved since this turn started', 409, 'store_conflict', ACTION_TOKEN.STORY_BRANCH_HEAD_STALE);
    }
    tokens.add(ACTION_TOKEN.STORY_BRANCH_HEAD_CURRENT);

    const state = await this.store.getState(input.branchId);
    if (!state) {
      throw tokens.fail(`branch state not found: ${input.branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_STATE_MISSING);
    }
    tokens.add(ACTION_TOKEN.STORY_BRANCH_STATE_FOUND);

    const timeline = await this.store.getTimeline(input.branchId);
    const projected = {
      state,
      recentTurns: timeline.slice(-8),
      userTranscript: input.userTranscript
    };
    state.contextBudget = decideContextBudget(estimateTokensRoughly(projected), this.config.budget);
    addContextBudgetTokens(tokens, state.contextBudget);
    const capsule = buildContextCapsule(state, timeline);

    return { repo, branch, expectedHeadTurnId: branchHeadTurnId, state, timeline, capsule };
  }

  private async prepareLiveContext(input: { repoId: string; branchId: string; tokens?: ActionTokenSet }): Promise<PreparedTurn> {
    const tokens = input.tokens ?? createActionTokenSet(ACTION_ID.PROVIDER_CREATE_LIVE_TOKEN);
    const repo = await this.store.getRepo(input.repoId);
    if (!repo) {
      throw tokens.fail(`repo not found: ${input.repoId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_REPO_MISSING);
    }
    tokens.add(ACTION_TOKEN.STORY_REPO_FOUND);
    const branch = await this.store.getBranch(input.branchId);
    if (!branch) {
      throw tokens.fail(`branch not found: ${input.branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_MISSING);
    }
    tokens.add(ACTION_TOKEN.STORY_BRANCH_FOUND);
    if (branch.repoId !== repo.id) {
      throw tokens.fail('branch does not belong to repo', 400, 'store_invalid', ACTION_TOKEN.STORY_BRANCH_REPO_MISMATCH);
    }
    tokens.add(ACTION_TOKEN.STORY_BRANCH_BELONGS_TO_REPO);

    const state = await this.store.getState(input.branchId);
    if (!state) {
      throw tokens.fail(`branch state not found: ${input.branchId}`, 404, 'store_not_found', ACTION_TOKEN.STORY_BRANCH_STATE_MISSING);
    }
    tokens.add(ACTION_TOKEN.STORY_BRANCH_STATE_FOUND);

    const timeline = await this.store.getTimeline(input.branchId);
    state.contextBudget = decideContextBudget(estimateTokensRoughly({ state, recentTurns: timeline.slice(-8) }), this.config.budget);
    addContextBudgetTokens(tokens, state.contextBudget);
    const capsule = buildContextCapsule(state, timeline);
    return { repo, branch, expectedHeadTurnId: branch.headTurnId ?? null, state, timeline, capsule };
  }

  private async commitActorTurn(
    input: ContinueStoryInput,
    prepared: PreparedTurn,
    actor: ActorTurnResult
  ): Promise<TurnCommit> {
    return this.store.commitTurn({
      repoId: prepared.repo.id,
      branchId: prepared.branch.id,
      expectedHeadTurnId: prepared.expectedHeadTurnId,
      userTranscript: input.userTranscript,
      assistantTranscript: actor.text,
      userAudioAssetId: input.userAudioAssetId ?? null,
      assistantAudioAssetId: input.assistantAudioAssetId ?? null,
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

  private async withBranchMutationLease<T>(
    input: { repoId: string; branchId: string; tokens?: ActionTokenSet },
    run: () => Promise<T>
  ): Promise<T> {
    const tokens = turnTokens(input);
    const lease = await this.acquireBranchMutationLease(input, tokens);
    try {
      return await run();
    } finally {
      await this.releaseBranchMutationLeaseBestEffort(lease);
    }
  }

  private async releaseBranchMutationLeaseBestEffort(
    lease: Awaited<ReturnType<StoryStore['acquireBranchMutationLease']>>
  ): Promise<void> {
    await this.store.releaseBranchMutationLease(lease).catch(() => {});
  }

  private async acquireBranchMutationLease(
    input: { repoId: string; branchId: string },
    tokens: ActionTokenSet
  ): Promise<Awaited<ReturnType<StoryStore['acquireBranchMutationLease']>>> {
    try {
      const lease = await this.store.acquireBranchMutationLease({
        repoId: input.repoId,
        branchId: input.branchId,
        ttlMs: this.config.branchTurnLockTtlMs
      });
      tokens.add(ACTION_TOKEN.MUTATION_BRANCH_LEASE_ACQUIRED);
      return lease;
    } catch (error) {
      if (error instanceof StoreError && error.code === 'conflict') {
        throw tokens.fail(error.message, 409, 'store_conflict', ACTION_TOKEN.MUTATION_BRANCH_LEASE_ACTIVE);
      }
      throw error;
    }
  }
}

function turnTokens(input: { tokens?: ActionTokenSet }): ActionTokenSet {
  return input.tokens ?? createActionTokenSet(ACTION_ID.STORY_TURN);
}

function addContextBudgetTokens(tokens: ActionTokenSet, budget: WorldState['contextBudget']): void {
  if (!budget) return;
  switch (budget.mode) {
    case CONTEXT_BUDGET_MODE.HARD_STOP:
      tokens.block(ACTION_TOKEN.CONTEXT_BUDGET_HARD_STOP);
      return;
    case CONTEXT_BUDGET_MODE.CLOSURE:
      tokens.add(ACTION_TOKEN.CONTEXT_BUDGET_CLOSURE);
      return;
    case CONTEXT_BUDGET_MODE.STABLE:
      tokens.add(ACTION_TOKEN.CONTEXT_BUDGET_STABLE);
      return;
  }
}
