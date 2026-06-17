import { randomUUID } from 'node:crypto';
import { createInitialWorldState } from '../domain/initialState.js';
import { sha256Json } from '../domain/stateHash.js';
import type { AudioAsset, AudioUploadIntent, BranchRef, CreateRepoInput, ForkBranchInput, RegisterAudioAssetInput, StoryRepo, TurnCommit, WorldState } from '../domain/types.js';
import type {
  ApplyCanonPatchInput,
  BranchMutationLease,
  BranchMutationLeaseInput,
  CommitTurnInput,
  CompleteAudioUploadIntentInput,
  CreateAudioUploadIntentInput,
  CreateRepoResult,
  StoryStore
} from './storyStore.js';
import { StoreError } from './storyStore.js';

export class InMemoryStoryStore implements StoryStore {
  private readonly repos = new Map<string, StoryRepo>();
  private readonly branches = new Map<string, BranchRef>();
  private readonly turns = new Map<string, TurnCommit>();
  private readonly states = new Map<string, WorldState>();
  private readonly audioAssets = new Map<string, AudioAsset>();
  private readonly audioUploads = new Map<string, AudioUploadIntent>();
  private readonly snapshotsByTurn = new Map<string, WorldState>();
  private readonly patchesByTurn = new Map<string, unknown>();
  private readonly branchMutationLeases = new Map<string, BranchMutationLease>();

  async createRepo(input: CreateRepoInput): Promise<CreateRepoResult> {
    const now = new Date().toISOString();
    const repoId = randomUUID();
    const branchId = randomUUID();

    const repo: StoryRepo = {
      id: repoId,
      ownerUserId: input.ownerUserId ?? null,
      title: input.title,
      description: input.description ?? null,
      defaultStyle: input.defaultStyle ?? null,
      safetyProfile: input.safetyProfile ?? 'general',
      createdAt: now,
      updatedAt: now
    };

    const branch: BranchRef = {
      id: branchId,
      repoId,
      ownerUserId: repo.ownerUserId,
      name: 'main',
      headTurnId: null,
      forkedFromTurnId: null,
      createdAt: now,
      updatedAt: now
    };

    const state = createInitialWorldState(branchId, { style: input.defaultStyle });

    this.repos.set(repoId, repo);
    this.branches.set(branchId, branch);
    this.states.set(branchId, state);

    return { repo: structuredClone(repo), branch: structuredClone(branch), state: structuredClone(state) };
  }

  async getRepo(repoId: string): Promise<StoryRepo | null> {
    const repo = this.repos.get(repoId);
    return repo ? structuredClone(repo) : null;
  }

  async listRepos(ownerUserId?: string): Promise<StoryRepo[]> {
    return [...this.repos.values()]
      .filter(repo => ownerUserId === undefined || repo.ownerUserId === ownerUserId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(repo => structuredClone(repo));
  }

  async getBranch(branchId: string): Promise<BranchRef | null> {
    const branch = this.branches.get(branchId);
    return branch ? structuredClone(branch) : null;
  }

  async listBranches(repoId: string): Promise<BranchRef[]> {
    return [...this.branches.values()]
      .filter(branch => branch.repoId === repoId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(branch => structuredClone(branch));
  }

  async forkBranch(input: ForkBranchInput): Promise<{ branch: BranchRef; state: WorldState }> {
    const repo = this.repos.get(input.repoId);
    if (!repo) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');

    const existing = [...this.branches.values()].find(
      branch => branch.repoId === input.repoId && branch.name === input.name
    );
    if (existing) throw new StoreError(`branch already exists: ${input.name}`, 'conflict');

    const sourceState = input.sourceTurnId
      ? this.snapshotsByTurn.get(input.sourceTurnId)
      : [...this.branches.values()].find(branch => branch.repoId === input.repoId && branch.name === 'main')
        ? this.states.get([...this.branches.values()].find(branch => branch.repoId === input.repoId && branch.name === 'main')!.id)
        : undefined;

    if (input.sourceTurnId && !sourceState) {
      throw new StoreError(
        `cannot fork from ${input.sourceTurnId}; no compiled state snapshot exists for that turn`,
        'not_found'
      );
    }

    const now = new Date().toISOString();
    const branchId = randomUUID();
    const branch: BranchRef = {
      id: branchId,
      repoId: input.repoId,
      ownerUserId: repo.ownerUserId ?? null,
      name: input.name,
      headTurnId: input.sourceTurnId ?? null,
      forkedFromTurnId: input.sourceTurnId ?? null,
      createdAt: now,
      updatedAt: now
    };

    const state = structuredClone(sourceState ?? createInitialWorldState(branchId, { style: repo.defaultStyle ?? undefined }));
    state.branchId = branchId;
    state.headTurnId = input.sourceTurnId ?? 'root';

    this.branches.set(branchId, branch);
    this.states.set(branchId, state);

    return { branch: structuredClone(branch), state: structuredClone(state) };
  }

  async deleteRepo(repoId: string): Promise<void> {
    if (!this.repos.has(repoId)) throw new StoreError(`repo not found: ${repoId}`, 'not_found');
    const branchIds = [...this.branches.values()].filter(branch => branch.repoId === repoId).map(branch => branch.id);
    const turnIds = [...this.turns.values()].filter(turn => turn.repoId === repoId).map(turn => turn.id);

    this.repos.delete(repoId);
    for (const branchId of branchIds) {
      this.branches.delete(branchId);
      this.states.delete(branchId);
      this.branchMutationLeases.delete(branchId);
    }
    for (const turnId of turnIds) {
      this.turns.delete(turnId);
      this.snapshotsByTurn.delete(turnId);
      this.patchesByTurn.delete(turnId);
    }
    for (const [assetId, asset] of this.audioAssets.entries()) {
      if (asset.repoId === repoId) this.audioAssets.delete(assetId);
    }
    for (const [uploadId, upload] of this.audioUploads.entries()) {
      if (upload.repoId === repoId) this.audioUploads.delete(uploadId);
    }
  }

  async createAudioUploadIntent(input: CreateAudioUploadIntentInput): Promise<AudioUploadIntent> {
    const repo = this.repos.get(input.repoId);
    if (!repo) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
    if (input.branchId) {
      const branch = this.branches.get(input.branchId);
      if (!branch) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      if (branch.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');
    }
    if (this.audioUploads.has(input.uploadId)) throw new StoreError(`audio upload already exists: ${input.uploadId}`, 'conflict');
    const intent: AudioUploadIntent = {
      id: input.uploadId,
      repoId: input.repoId,
      branchId: input.branchId ?? null,
      ownerUserId: input.ownerUserId ?? repo.ownerUserId ?? null,
      role: input.role,
      storageProvider: input.storageProvider,
      storageUri: input.storageUri,
      contentType: input.contentType,
      sha256: input.sha256,
      crc32c: input.crc32c ?? null,
      codec: input.codec,
      container: input.container,
      sampleRate: input.sampleRate,
      durationMs: input.durationMs,
      byteLength: input.byteLength,
      encryptionKeyRef: input.encryptionKeyRef ?? null,
      status: 'pending',
      audioAssetId: null,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      verifiedAt: null
    };
    this.audioUploads.set(intent.id, intent);
    return structuredClone(intent);
  }

  async getAudioUploadIntent(repoId: string, uploadId: string): Promise<AudioUploadIntent | null> {
    const intent = this.audioUploads.get(uploadId);
    return intent && intent.repoId === repoId ? structuredClone(intent) : null;
  }

  async completeAudioUploadIntent(input: CompleteAudioUploadIntentInput): Promise<AudioAsset> {
    const intent = this.audioUploads.get(input.uploadId);
    if (!intent || intent.repoId !== input.repoId) throw new StoreError(`audio upload not found: ${input.uploadId}`, 'not_found');
    if (intent.status === 'verified' && intent.audioAssetId) {
      const existing = this.audioAssets.get(intent.audioAssetId);
      if (existing) return structuredClone(existing);
    }
    if (intent.status !== 'pending') throw new StoreError(`audio upload is not pending: ${intent.status}`, 'conflict');
    if (Date.parse(intent.expiresAt) < Date.now()) {
      intent.status = 'expired';
      this.audioUploads.set(intent.id, intent);
      throw new StoreError('audio upload URL has expired', 'conflict');
    }
    const now = new Date().toISOString();
    const asset: AudioAsset = {
      id: randomUUID(),
      repoId: intent.repoId,
      branchId: intent.branchId ?? null,
      uploadId: intent.id,
      role: intent.role,
      storageProvider: intent.storageProvider,
      storageUri: intent.storageUri,
      contentType: input.verification.contentType ?? intent.contentType,
      sha256: intent.sha256,
      crc32c: input.verification.crc32c ?? intent.crc32c ?? null,
      md5Hash: input.verification.md5Hash ?? null,
      gcsGeneration: input.verification.generation ?? null,
      gcsMetageneration: input.verification.metageneration ?? null,
      codec: intent.codec,
      container: intent.container,
      sampleRate: intent.sampleRate,
      durationMs: intent.durationMs,
      byteLength: input.verification.byteLength,
      encryptionKeyRef: intent.encryptionKeyRef ?? null,
      uploadedAt: input.verification.updatedAt ?? now,
      verifiedAt: now,
      createdAt: now
    };
    this.audioAssets.set(asset.id, asset);
    intent.status = 'verified';
    intent.audioAssetId = asset.id;
    intent.verifiedAt = now;
    this.audioUploads.set(intent.id, intent);
    const repo = this.repos.get(intent.repoId);
    if (repo) this.repos.set(repo.id, { ...repo, updatedAt: now });
    return structuredClone(asset);
  }

  async saveAudioAsset(input: RegisterAudioAssetInput): Promise<AudioAsset> {
    const repo = this.repos.get(input.repoId);
    if (!repo) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
    if (input.branchId) {
      const branch = this.branches.get(input.branchId);
      if (!branch) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      if (branch.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');
    }
    const asset: AudioAsset = {
      id: randomUUID(),
      repoId: input.repoId,
      branchId: input.branchId ?? null,
      uploadId: input.uploadId ?? null,
      role: input.role,
      storageProvider: input.storageProvider ?? 'external',
      storageUri: input.storageUri,
      contentType: input.contentType ?? null,
      sha256: input.sha256,
      crc32c: input.crc32c ?? null,
      md5Hash: input.md5Hash ?? null,
      gcsGeneration: input.gcsGeneration ?? null,
      gcsMetageneration: input.gcsMetageneration ?? null,
      codec: input.codec,
      container: input.container,
      sampleRate: input.sampleRate,
      durationMs: input.durationMs,
      byteLength: input.byteLength,
      encryptionKeyRef: input.encryptionKeyRef ?? null,
      uploadedAt: input.uploadedAt ?? null,
      verifiedAt: input.verifiedAt ?? null,
      createdAt: new Date().toISOString()
    };
    this.audioAssets.set(asset.id, asset);
    return structuredClone(asset);
  }

  async listAudioAssets(repoId: string, branchId?: string): Promise<AudioAsset[]> {
    if (!this.repos.has(repoId)) throw new StoreError(`repo not found: ${repoId}`, 'not_found');
    return [...this.audioAssets.values()]
      .filter(asset => asset.repoId === repoId && (branchId === undefined || asset.branchId === branchId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(asset => structuredClone(asset));
  }

  async acquireBranchMutationLease(input: BranchMutationLeaseInput): Promise<BranchMutationLease> {
    const repo = this.repos.get(input.repoId);
    if (!repo) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
    const branch = this.branches.get(input.branchId);
    if (!branch) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
    if (branch.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');

    const nowMs = Date.now();
    const existing = this.branchMutationLeases.get(input.branchId);
    if (existing && Date.parse(existing.expiresAt) > nowMs) {
      throw new StoreError('branch already has a story turn in progress', 'conflict');
    }

    const lease: BranchMutationLease = {
      leaseId: randomUUID(),
      repoId: input.repoId,
      branchId: input.branchId,
      ownerUserId: repo.ownerUserId ?? branch.ownerUserId ?? null,
      expiresAt: new Date(nowMs + input.ttlMs).toISOString()
    };
    this.branchMutationLeases.set(input.branchId, lease);
    return structuredClone(lease);
  }

  async releaseBranchMutationLease(lease: BranchMutationLease): Promise<void> {
    const existing = this.branchMutationLeases.get(lease.branchId);
    if (existing?.leaseId === lease.leaseId) {
      this.branchMutationLeases.delete(lease.branchId);
    }
  }

  async commitTurn(input: CommitTurnInput): Promise<TurnCommit> {
    const repo = this.repos.get(input.repoId);
    if (!repo) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
    const branch = this.branches.get(input.branchId);
    if (!branch) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
    if (branch.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');

    const parentTurnId = branch.headTurnId ?? null;
    if (input.expectedHeadTurnId !== undefined && input.expectedHeadTurnId !== parentTurnId) {
      throw new StoreError('branch head moved before the turn could be committed', 'conflict');
    }
    const parent = parentTurnId ? this.turns.get(parentTurnId) : undefined;
    const now = new Date().toISOString();
    const turn: TurnCommit = {
      id: randomUUID(),
      repoId: input.repoId,
      branchId: input.branchId,
      ownerUserId: repo.ownerUserId ?? branch.ownerUserId ?? null,
      parentTurnId,
      turnIndex: parent ? parent.turnIndex + 1 : 1,
      userAudioAssetId: input.userAudioAssetId ?? null,
      assistantAudioAssetId: input.assistantAudioAssetId ?? null,
      userTranscript: input.userTranscript,
      assistantTranscript: input.assistantTranscript,
      stateStatus: 'pending',
      modelMetadata: input.modelMetadata ?? [],
      createdAt: now,
      committedAt: now
    };

    this.turns.set(turn.id, turn);
    branch.headTurnId = turn.id;
    branch.updatedAt = now;
    repo.updatedAt = now;

    return structuredClone(turn);
  }

  async getTimeline(branchId: string): Promise<TurnCommit[]> {
    const branch = this.branches.get(branchId);
    if (!branch) throw new StoreError(`branch not found: ${branchId}`, 'not_found');

    const timeline: TurnCommit[] = [];
    const seen = new Set<string>();
    let currentId = branch.headTurnId ?? null;

    while (currentId) {
      if (seen.has(currentId)) throw new StoreError(`cycle detected at turn ${currentId}`, 'invalid');
      seen.add(currentId);
      const turn = this.turns.get(currentId);
      if (!turn) throw new StoreError(`turn not found: ${currentId}`, 'not_found');
      timeline.push(turn);
      currentId = turn.parentTurnId ?? null;
    }

    return timeline.reverse().map(turn => structuredClone(turn));
  }

  async getState(branchId: string): Promise<WorldState | null> {
    const state = this.states.get(branchId);
    return state ? structuredClone(state) : null;
  }

  async applyCanonPatch(input: ApplyCanonPatchInput): Promise<void> {
    const turn = this.turns.get(input.turnId);
    if (!turn) throw new StoreError(`turn not found: ${input.turnId}`, 'not_found');
    if (turn.branchId !== input.branchId) throw new StoreError('turn does not belong to branch', 'invalid');
    if (turn.repoId !== input.repoId) throw new StoreError('turn does not belong to repo', 'invalid');
    const branch = this.branches.get(input.branchId);
    if (!branch) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
    if (branch.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');
    if ((branch.headTurnId ?? null) !== input.turnId) {
      throw new StoreError('cannot canonize a turn that is no longer the branch head', 'conflict');
    }

    turn.stateStatus = input.patch.warnings.some(w => w.severity === 'high') ? 'needs_review' : 'canonized';
    if (input.modelMetadata?.length) {
      turn.modelMetadata = [...(turn.modelMetadata ?? []), ...input.modelMetadata];
    }
    this.patchesByTurn.set(input.turnId, structuredClone(input.patch));
    this.states.set(input.branchId, structuredClone(input.state));
    this.snapshotsByTurn.set(input.turnId, structuredClone(input.state));

    const repo = this.repos.get(input.repoId);
    if (repo) repo.updatedAt = new Date().toISOString();

    // Make the hash reachable to debuggers without imposing a snapshot table in memory mode.
    void sha256Json(input.state);
  }
  async close(): Promise<void> {
    // no-op for local development store
  }
}
