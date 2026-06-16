import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createInitialWorldState } from '../domain/initialState.js';
import { sha256Json } from '../domain/stateHash.js';
import type { BranchRef, CreateRepoInput, ForkBranchInput, StoryRepo, TurnCommit, WorldState } from '../domain/types.js';
import { getFirebaseAdminDb } from '../firebase/admin.js';
import type {
  ApplyCanonPatchInput,
  BranchMutationLease,
  BranchMutationLeaseInput,
  CommitTurnInput,
  CreateRepoResult,
  StoryStore
} from './storyStore.js';
import { StoreError } from './storyStore.js';

const COLLECTIONS = {
  repos: 'storyRepos',
  branches: 'branches',
  turns: 'turns',
  states: 'branchStates',
  snapshots: 'branchSnapshots',
  patches: 'eventPatches',
  warnings: 'continuityWarnings',
  branchLocks: 'branchMutationLocks'
} as const;

export class FirestoreStoryStore implements StoryStore {
  constructor(private readonly db: Firestore = getFirebaseAdminDb()) {}

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
      name: 'main',
      headTurnId: null,
      forkedFromTurnId: null,
      createdAt: now,
      updatedAt: now
    };
    const state = createInitialWorldState(branchId, { style: input.defaultStyle });

    await this.db.runTransaction(async tx => {
      tx.set(this.repoRef(repoId), repo);
      tx.set(this.branchRef(branchId), branch);
      tx.set(this.stateRef(branchId), {
        repoId,
        branchId,
        headTurnId: null,
        state,
        stateHash: sha256Json(state),
        updatedAt: now
      });
    });

    return clone({ repo, branch, state });
  }

  async getRepo(repoId: string): Promise<StoryRepo | null> {
    const snapshot = await this.repoRef(repoId).get();
    return snapshot.exists ? clone(snapshot.data() as StoryRepo) : null;
  }

  async listRepos(ownerUserId?: string): Promise<StoryRepo[]> {
    const query = ownerUserId === undefined
      ? this.db.collection(COLLECTIONS.repos).orderBy('createdAt', 'asc')
      : this.db.collection(COLLECTIONS.repos).where('ownerUserId', '==', ownerUserId);
    const snapshot = await query.get();
    return snapshot.docs
      .map(doc => clone(doc.data() as StoryRepo))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getBranch(branchId: string): Promise<BranchRef | null> {
    const snapshot = await this.branchRef(branchId).get();
    return snapshot.exists ? clone(snapshot.data() as BranchRef) : null;
  }

  async listBranches(repoId: string): Promise<BranchRef[]> {
    const snapshot = await this.db
      .collection(COLLECTIONS.branches)
      .where('repoId', '==', repoId)
      .orderBy('createdAt', 'asc')
      .get();
    return snapshot.docs.map(doc => clone(doc.data() as BranchRef));
  }

  async forkBranch(input: ForkBranchInput): Promise<{ branch: BranchRef; state: WorldState }> {
    return this.db.runTransaction(async tx => {
      const repoSnapshot = await tx.get(this.repoRef(input.repoId));
      if (!repoSnapshot.exists) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      const repo = repoSnapshot.data() as StoryRepo;

      const duplicate = await tx.get(
        this.db.collection(COLLECTIONS.branches)
          .where('repoId', '==', input.repoId)
          .where('name', '==', input.name)
          .limit(1)
      );
      if (!duplicate.empty) throw new StoreError(`branch already exists: ${input.name}`, 'conflict');

      let sourceState: WorldState | null = null;
      if (input.sourceTurnId) {
        const snapshot = await tx.get(this.snapshotRef(input.sourceTurnId));
        if (!snapshot.exists) {
          throw new StoreError(
            `cannot fork from ${input.sourceTurnId}; no compiled state snapshot exists for that turn`,
            'not_found'
          );
        }
        sourceState = (snapshot.data() as { state?: WorldState }).state ?? null;
      } else {
        const main = await tx.get(
          this.db.collection(COLLECTIONS.branches)
            .where('repoId', '==', input.repoId)
            .where('name', '==', 'main')
            .limit(1)
        );
        const mainBranch = main.docs[0]?.data() as BranchRef | undefined;
        if (mainBranch) {
          const stateSnapshot = await tx.get(this.stateRef(mainBranch.id));
          sourceState = (stateSnapshot.data() as { state?: WorldState } | undefined)?.state ?? null;
        }
      }

      const now = new Date().toISOString();
      const branchId = randomUUID();
      const branch: BranchRef = {
        id: branchId,
        repoId: input.repoId,
        name: input.name,
        headTurnId: input.sourceTurnId ?? null,
        forkedFromTurnId: input.sourceTurnId ?? null,
        createdAt: now,
        updatedAt: now
      };
      const state = clone(sourceState ?? createInitialWorldState(branchId, { style: repo.defaultStyle ?? undefined }));
      state.branchId = branchId;
      state.headTurnId = input.sourceTurnId ?? 'root';

      tx.set(this.branchRef(branchId), branch);
      tx.set(this.stateRef(branchId), {
        repoId: input.repoId,
        branchId,
        headTurnId: input.sourceTurnId ?? null,
        state,
        stateHash: sha256Json(state),
        updatedAt: now
      });
      return clone({ branch, state });
    });
  }

  async acquireBranchMutationLease(input: BranchMutationLeaseInput): Promise<BranchMutationLease> {
    return this.db.runTransaction(async tx => {
      const repoSnapshot = await tx.get(this.repoRef(input.repoId));
      if (!repoSnapshot.exists) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      const branchSnapshot = await tx.get(this.branchRef(input.branchId));
      if (!branchSnapshot.exists) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      const branch = branchSnapshot.data() as BranchRef;
      if (branch.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');

      const nowMs = Date.now();
      const lockRef = this.branchLockRef(input.branchId);
      const lockSnapshot = await tx.get(lockRef);
      const lock = lockSnapshot.data() as { leaseId?: string; expiresAtMillis?: number } | undefined;
      if (lockSnapshot.exists && (lock?.expiresAtMillis ?? 0) > nowMs) {
        throw new StoreError('branch already has a story turn in progress', 'conflict');
      }

      const lease: BranchMutationLease = {
        leaseId: randomUUID(),
        repoId: input.repoId,
        branchId: input.branchId,
        expiresAt: new Date(nowMs + input.ttlMs).toISOString()
      };
      tx.set(lockRef, {
        ...lease,
        expiresAtMillis: nowMs + input.ttlMs,
        acquiredAt: new Date(nowMs).toISOString()
      });
      return lease;
    });
  }

  async releaseBranchMutationLease(lease: BranchMutationLease): Promise<void> {
    await this.db.runTransaction(async tx => {
      const lockRef = this.branchLockRef(lease.branchId);
      const lockSnapshot = await tx.get(lockRef);
      const lock = lockSnapshot.data() as { leaseId?: string } | undefined;
      if (lockSnapshot.exists && lock?.leaseId === lease.leaseId) {
        tx.delete(lockRef);
      }
    });
  }

  async commitTurn(input: CommitTurnInput): Promise<TurnCommit> {
    return this.db.runTransaction(async tx => {
      const repoSnapshot = await tx.get(this.repoRef(input.repoId));
      if (!repoSnapshot.exists) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      const branchSnapshot = await tx.get(this.branchRef(input.branchId));
      if (!branchSnapshot.exists) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      const branch = branchSnapshot.data() as BranchRef;
      if (branch.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');

      const parentTurnId = branch.headTurnId ?? null;
      if (input.expectedHeadTurnId !== undefined && input.expectedHeadTurnId !== parentTurnId) {
        throw new StoreError('branch head moved before the turn could be committed', 'conflict');
      }
      const parent = parentTurnId ? await this.getTurnInTransaction(tx, parentTurnId) : null;
      const now = new Date().toISOString();
      const turn: TurnCommit = {
        id: randomUUID(),
        repoId: input.repoId,
        branchId: input.branchId,
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

      tx.set(this.turnRef(turn.id), turn);
      tx.update(this.branchRef(input.branchId), { headTurnId: turn.id, updatedAt: now });
      tx.update(this.repoRef(input.repoId), { updatedAt: now });
      return clone(turn);
    });
  }

  async getTimeline(branchId: string): Promise<TurnCommit[]> {
    const branch = await this.getBranch(branchId);
    if (!branch) throw new StoreError(`branch not found: ${branchId}`, 'not_found');

    const timeline: TurnCommit[] = [];
    const seen = new Set<string>();
    let currentId = branch.headTurnId ?? null;
    while (currentId) {
      if (seen.has(currentId)) throw new StoreError(`cycle detected at turn ${currentId}`, 'invalid');
      seen.add(currentId);
      const snapshot = await this.turnRef(currentId).get();
      if (!snapshot.exists) throw new StoreError(`turn not found: ${currentId}`, 'not_found');
      const turn = snapshot.data() as TurnCommit;
      timeline.push(turn);
      currentId = turn.parentTurnId ?? null;
    }
    return timeline.reverse().map(turn => clone(turn));
  }

  async getState(branchId: string): Promise<WorldState | null> {
    const snapshot = await this.stateRef(branchId).get();
    const state = (snapshot.data() as { state?: WorldState } | undefined)?.state;
    return state ? clone(state) : null;
  }

  async applyCanonPatch(input: ApplyCanonPatchInput): Promise<void> {
    await this.db.runTransaction(async tx => {
      const turnSnapshot = await tx.get(this.turnRef(input.turnId));
      if (!turnSnapshot.exists) throw new StoreError(`turn not found: ${input.turnId}`, 'not_found');
      const turn = turnSnapshot.data() as TurnCommit;
      if (turn.branchId !== input.branchId) throw new StoreError('turn does not belong to branch', 'invalid');
      const branchSnapshot = await tx.get(this.branchRef(input.branchId));
      if (!branchSnapshot.exists) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      const branch = branchSnapshot.data() as BranchRef;
      if ((branch.headTurnId ?? null) !== input.turnId) {
        throw new StoreError('cannot canonize a turn that is no longer the branch head', 'conflict');
      }

      const now = new Date().toISOString();
      const stateHash = sha256Json(input.state);
      const status = input.patch.warnings.some(w => w.severity === 'high') ? 'needs_review' : 'canonized';
      const modelMetadata = [...(turn.modelMetadata ?? []), ...(input.modelMetadata ?? [])];

      tx.set(this.db.collection(COLLECTIONS.patches).doc(randomUUID()), {
        id: randomUUID(),
        repoId: input.repoId,
        branchId: input.branchId,
        turnId: input.turnId,
        patch: input.patch,
        status: 'applied',
        createdAt: now,
        appliedAt: now
      });
      tx.set(this.snapshotRef(input.turnId), {
        repoId: input.repoId,
        branchId: input.branchId,
        turnId: input.turnId,
        state: input.state,
        stateHash,
        createdAt: now
      });
      tx.set(this.stateRef(input.branchId), {
        repoId: input.repoId,
        branchId: input.branchId,
        headTurnId: input.turnId,
        state: input.state,
        stateHash,
        updatedAt: now
      });
      tx.update(this.turnRef(input.turnId), { stateStatus: status, modelMetadata });
      tx.update(this.repoRef(input.repoId), { updatedAt: now });

      for (const warning of input.patch.warnings) {
        tx.set(this.db.collection(COLLECTIONS.warnings).doc(randomUUID()), {
          repoId: input.repoId,
          branchId: input.branchId,
          turnId: input.turnId,
          severity: warning.severity,
          warningType: warning.type,
          message: warning.message,
          repairStrategy: warning.repairStrategy ?? null,
          createdAt: now,
          resolvedAt: null
        });
      }
    });
  }

  async close(): Promise<void> {
    // Firebase Admin owns the process-level Firestore client.
  }

  private repoRef(id: string) {
    return this.db.collection(COLLECTIONS.repos).doc(id);
  }

  private branchRef(id: string) {
    return this.db.collection(COLLECTIONS.branches).doc(id);
  }

  private turnRef(id: string) {
    return this.db.collection(COLLECTIONS.turns).doc(id);
  }

  private stateRef(branchId: string) {
    return this.db.collection(COLLECTIONS.states).doc(branchId);
  }

  private snapshotRef(turnId: string) {
    return this.db.collection(COLLECTIONS.snapshots).doc(turnId);
  }

  private branchLockRef(branchId: string) {
    return this.db.collection(COLLECTIONS.branchLocks).doc(branchId);
  }

  private async getTurnInTransaction(tx: Transaction, turnId: string): Promise<TurnCommit | null> {
    const snapshot = await tx.get(this.turnRef(turnId));
    return snapshot.exists ? (snapshot.data() as TurnCommit) : null;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
