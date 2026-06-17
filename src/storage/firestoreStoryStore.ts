import { randomUUID } from 'node:crypto';
import type { DocumentData, DocumentReference, Firestore, Query, Transaction } from 'firebase-admin/firestore';
import { createInitialWorldState } from '../domain/initialState.js';
import { sha256Json } from '../domain/stateHash.js';
import type { AudioAsset, AudioUploadIntent, BranchRef, CreateRepoInput, ForkBranchInput, RegisterAudioAssetInput, StoryRepo, TurnCommit, WorldState } from '../domain/types.js';
import { getFirebaseAdminDb } from '../firebase/admin.js';
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

const SCHEMA_VERSION = 2;
const UNOWNED_OWNER_KEY = '__unowned__';

const COLLECTIONS = {
  users: 'users',
  repos: 'storyRepos',
  branches: 'branches',
  turns: 'turns',
  states: 'branchState',
  snapshots: 'stateSnapshots',
  patches: 'canonPatches',
  warnings: 'continuityWarnings',
  locks: 'mutationLocks',
  audioAssets: 'audioAssets',
  audioUploads: 'audioUploads',
  repoIndex: 'storyRepoIndex',
  branchIndex: 'storyBranchIndex',
  turnIndex: 'storyTurnIndex'
} as const;

type FirestoreDocRef = DocumentReference<DocumentData, DocumentData>;

type RepoLoc = {
  ownerKey: string;
  ownerUserId: string | null;
  repoId: string;
};

type BranchLoc = RepoLoc & { branchId: string };
type TurnLoc = BranchLoc & { turnId: string };

export class FirestoreStoryStore implements StoryStore {
  constructor(private readonly db: Firestore = getFirebaseAdminDb()) {}

  async createRepo(input: CreateRepoInput): Promise<CreateRepoResult> {
    const now = new Date().toISOString();
    const repoId = randomUUID();
    const branchId = randomUUID();
    const ownerUserId = normalizeOwnerUserId(input.ownerUserId);
    const ownerKey = ownerKeyFromOwnerUserId(ownerUserId);
    const repo: StoryRepo = {
      id: repoId,
      ownerUserId,
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
      ownerUserId,
      name: 'main',
      headTurnId: null,
      forkedFromTurnId: null,
      createdAt: now,
      updatedAt: now
    };
    const state = createInitialWorldState(branchId, { style: input.defaultStyle });
    const repoLoc: RepoLoc = { ownerKey, ownerUserId, repoId };
    const branchLoc: BranchLoc = { ...repoLoc, branchId };

    await this.db.runTransaction(async tx => {
      tx.set(this.userRef(ownerKey), userRootData(ownerKey, ownerUserId, now), { merge: true });
      tx.set(this.repoRef(repoLoc), storyDoc(repo, 'story_repo'));
      tx.set(this.repoIndexRef(repoId), repoIndexData(repo, ownerKey, this.repoRef(repoLoc).path));
      tx.set(this.branchRef(branchLoc), storyDoc(branch, 'branch'));
      tx.set(this.branchIndexRef(branchId), branchIndexData(branch, ownerKey, this.branchRef(branchLoc).path));
      tx.set(this.stateRef(branchLoc), branchStateData(repoLoc, branchId, null, state, now));
    });

    return clone({ repo, branch, state });
  }

  async getRepo(repoId: string): Promise<StoryRepo | null> {
    const loc = await this.locateRepo(repoId);
    if (!loc) return null;
    const snapshot = await this.repoRef(loc).get();
    return snapshot.exists ? cleanRepo(snapshot.data()) : null;
  }

  async listRepos(ownerUserId?: string): Promise<StoryRepo[]> {
    if (ownerUserId !== undefined) {
      const ownerKey = ownerKeyFromOwnerUserId(normalizeOwnerUserId(ownerUserId));
      const snapshot = await this.userRef(ownerKey).collection(COLLECTIONS.repos).get();
      return snapshot.docs.map(doc => cleanRepo(doc.data())).filter(isPresent).sort(sortByCreatedAt);
    }
    const snapshot = await this.db.collectionGroup(COLLECTIONS.repos).get();
    return snapshot.docs.map(doc => cleanRepo(doc.data())).filter(isPresent).sort(sortByCreatedAt);
  }

  async getBranch(branchId: string): Promise<BranchRef | null> {
    const loc = await this.locateBranch(branchId);
    if (!loc) return null;
    const snapshot = await this.branchRef(loc).get();
    return snapshot.exists ? cleanBranch(snapshot.data()) : null;
  }

  async listBranches(repoId: string): Promise<BranchRef[]> {
    const loc = await this.locateRepo(repoId);
    if (!loc) return [];
    const snapshot = await this.repoRef(loc).collection(COLLECTIONS.branches).get();
    return snapshot.docs.map(doc => cleanBranch(doc.data())).filter(isPresent).sort(sortByCreatedAt);
  }

  async forkBranch(input: ForkBranchInput): Promise<{ branch: BranchRef; state: WorldState }> {
    return this.db.runTransaction(async tx => {
      const repoLoc = await this.locateRepoTx(tx, input.repoId);
      if (!repoLoc) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');

      const repoSnapshot = await tx.get(this.repoRef(repoLoc));
      if (!repoSnapshot.exists) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      const repo = cleanRepo(repoSnapshot.data());
      if (!repo) throw new StoreError(`repo is invalid: ${input.repoId}`, 'invalid');

      const duplicate = await tx.get(
        this.repoRef(repoLoc).collection(COLLECTIONS.branches).where('name', '==', input.name).limit(1)
      );
      if (!duplicate.empty) throw new StoreError(`branch already exists: ${input.name}`, 'conflict');

      let sourceState: WorldState | null = null;
      if (input.sourceTurnId) {
        const sourceTurnLoc = await this.locateTurnTx(tx, input.sourceTurnId);
        if (!sourceTurnLoc) {
          throw new StoreError(`cannot fork from ${input.sourceTurnId}; no turn exists for that id`, 'not_found');
        }
        if (sourceTurnLoc.repoId !== input.repoId) throw new StoreError('source turn does not belong to repo', 'invalid');
        const snapshot = await tx.get(this.snapshotRef(sourceTurnLoc));
        if (!snapshot.exists) {
          throw new StoreError(
            `cannot fork from ${input.sourceTurnId}; no compiled state snapshot exists for that turn`,
            'not_found'
          );
        }
        sourceState = (snapshot.data() as { state?: WorldState }).state ?? null;
      } else {
        const main = await tx.get(
          this.repoRef(repoLoc).collection(COLLECTIONS.branches).where('name', '==', 'main').limit(1)
        );
        const mainBranch = cleanBranch(main.docs[0]?.data());
        if (mainBranch) {
          const stateSnapshot = await tx.get(this.stateRef({ ...repoLoc, branchId: mainBranch.id }));
          sourceState = (stateSnapshot.data() as { state?: WorldState } | undefined)?.state ?? null;
        }
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
      const state = clone(sourceState ?? createInitialWorldState(branchId, { style: repo.defaultStyle ?? undefined }));
      state.branchId = branchId;
      state.headTurnId = input.sourceTurnId ?? 'root';
      const branchLoc: BranchLoc = { ...repoLoc, branchId };

      tx.set(this.userRef(repoLoc.ownerKey), userRootData(repoLoc.ownerKey, repo.ownerUserId ?? null, now), { merge: true });
      tx.set(this.branchRef(branchLoc), storyDoc(branch, 'branch'));
      tx.set(this.branchIndexRef(branchId), branchIndexData(branch, repoLoc.ownerKey, this.branchRef(branchLoc).path));
      tx.set(this.stateRef(branchLoc), branchStateData(repoLoc, branchId, input.sourceTurnId ?? null, state, now));
      tx.set(this.repoRef(repoLoc), { updatedAt: now }, { merge: true });
      tx.set(this.repoIndexRef(input.repoId), { updatedAt: now }, { merge: true });
      return clone({ branch, state });
    });
  }

  async deleteRepo(repoId: string): Promise<void> {
    const repoLoc = await this.locateRepo(repoId);
    if (!repoLoc) throw new StoreError(`repo not found: ${repoId}`, 'not_found');
    const repoRef = this.repoRef(repoLoc);
    const [branches, turns] = await Promise.all([
      repoRef.collection(COLLECTIONS.branches).get(),
      repoRef.collection(COLLECTIONS.turns).get()
    ]);

    const recursiveDelete = (this.db as Firestore & { recursiveDelete?: (ref: FirestoreDocRef) => Promise<unknown> }).recursiveDelete;
    if (typeof recursiveDelete === 'function') {
      await recursiveDelete.call(this.db, repoRef);
    } else {
      await this.deleteKnownRepoDocuments(repoLoc);
    }

    const indexRefs: FirestoreDocRef[] = [this.repoIndexRef(repoId)];
    for (const branchDoc of branches.docs) indexRefs.push(this.branchIndexRef(branchDoc.id));
    for (const turnDoc of turns.docs) indexRefs.push(this.turnIndexRef(turnDoc.id));
    await this.deleteRefs(indexRefs);
  }

  async createAudioUploadIntent(input: CreateAudioUploadIntentInput): Promise<AudioUploadIntent> {
    return this.db.runTransaction(async tx => {
      const repoLoc = await this.locateRepoTx(tx, input.repoId);
      if (!repoLoc) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      const repoSnapshot = await tx.get(this.repoRef(repoLoc));
      if (!repoSnapshot.exists) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      const repo = cleanRepo(repoSnapshot.data());
      if (!repo) throw new StoreError(`repo is invalid: ${input.repoId}`, 'invalid');
      if (input.branchId) {
        const branchLoc = await this.locateBranchTx(tx, input.branchId);
        if (!branchLoc) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
        if (branchLoc.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');
      }
      const uploadRef = this.audioUploadRef(repoLoc, input.uploadId);
      const existing = await tx.get(uploadRef);
      if (existing.exists) throw new StoreError(`audio upload already exists: ${input.uploadId}`, 'conflict');
      const now = new Date().toISOString();
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
        createdAt: now,
        expiresAt: input.expiresAt,
        verifiedAt: null
      };
      tx.set(uploadRef, storyDoc(intent, 'audio_upload'));
      tx.set(this.repoRef(repoLoc), { updatedAt: now }, { merge: true });
      tx.set(this.repoIndexRef(input.repoId), { updatedAt: now }, { merge: true });
      return clone(intent);
    });
  }

  async getAudioUploadIntent(repoId: string, uploadId: string): Promise<AudioUploadIntent | null> {
    const repoLoc = await this.locateRepo(repoId);
    if (!repoLoc) return null;
    const snapshot = await this.audioUploadRef(repoLoc, uploadId).get();
    return snapshot.exists ? cleanAudioUploadIntent(snapshot.data()) : null;
  }

  async completeAudioUploadIntent(input: CompleteAudioUploadIntentInput): Promise<AudioAsset> {
    return this.db.runTransaction(async tx => {
      const repoLoc = await this.locateRepoTx(tx, input.repoId);
      if (!repoLoc) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      const uploadRef = this.audioUploadRef(repoLoc, input.uploadId);
      const uploadSnapshot = await tx.get(uploadRef);
      if (!uploadSnapshot.exists) throw new StoreError(`audio upload not found: ${input.uploadId}`, 'not_found');
      const intent = cleanAudioUploadIntent(uploadSnapshot.data());
      if (!intent) throw new StoreError(`audio upload is invalid: ${input.uploadId}`, 'invalid');
      if (intent.repoId !== input.repoId) throw new StoreError('audio upload does not belong to repo', 'invalid');
      if (intent.status === 'verified' && intent.audioAssetId) {
        const existingSnapshot = await tx.get(this.audioAssetRef(repoLoc, intent.audioAssetId));
        const existing = cleanAudioAsset(existingSnapshot.data());
        if (existing) return existing;
      }
      if (intent.status !== 'pending') throw new StoreError(`audio upload is not pending: ${intent.status}`, 'conflict');
      const now = new Date().toISOString();
      if (Date.parse(intent.expiresAt) < Date.now()) {
        tx.set(uploadRef, { status: 'expired', updatedAt: now }, { merge: true });
        throw new StoreError('audio upload URL has expired', 'conflict');
      }
      if (input.verification.byteLength !== intent.byteLength) {
        throw new StoreError('audio object byte length does not match upload intent', 'invalid');
      }
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
      tx.set(this.audioAssetRef(repoLoc, asset.id), storyDoc(asset, 'audio_asset'));
      tx.set(uploadRef, { status: 'verified', audioAssetId: asset.id, verifiedAt: now, updatedAt: now }, { merge: true });
      tx.set(this.repoRef(repoLoc), { updatedAt: now }, { merge: true });
      tx.set(this.repoIndexRef(input.repoId), { updatedAt: now }, { merge: true });
      return clone(asset);
    });
  }

  async saveAudioAsset(input: RegisterAudioAssetInput): Promise<AudioAsset> {
    return this.db.runTransaction(async tx => {
      const repoLoc = await this.locateRepoTx(tx, input.repoId);
      if (!repoLoc) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      const repoSnapshot = await tx.get(this.repoRef(repoLoc));
      if (!repoSnapshot.exists) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      const repo = cleanRepo(repoSnapshot.data());
      if (!repo) throw new StoreError(`repo is invalid: ${input.repoId}`, 'invalid');
      if (input.branchId) {
        const branchLoc = await this.locateBranchTx(tx, input.branchId);
        if (!branchLoc) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
        if (branchLoc.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');
      }
      const now = new Date().toISOString();
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
        createdAt: now
      };
      tx.set(this.audioAssetRef(repoLoc, asset.id), storyDoc(asset, 'audio_asset'));
      tx.set(this.repoRef(repoLoc), { updatedAt: now }, { merge: true });
      tx.set(this.repoIndexRef(input.repoId), { updatedAt: now }, { merge: true });
      return clone(asset);
    });
  }

  async listAudioAssets(repoId: string, branchId?: string): Promise<AudioAsset[]> {
    const repoLoc = await this.locateRepo(repoId);
    if (!repoLoc) throw new StoreError(`repo not found: ${repoId}`, 'not_found');
    let query: Query<DocumentData, DocumentData> = this.repoRef(repoLoc).collection(COLLECTIONS.audioAssets);
    if (branchId !== undefined) query = query.where('branchId', '==', branchId);
    const snapshot = await query.get();
    return snapshot.docs.map(doc => cleanAudioAsset(doc.data())).filter(isPresent).sort(sortByCreatedAt);
  }

  async acquireBranchMutationLease(input: BranchMutationLeaseInput): Promise<BranchMutationLease> {
    return this.db.runTransaction(async tx => {
      const branchLoc = await this.locateBranchTx(tx, input.branchId);
      if (!branchLoc) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      if (branchLoc.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');

      const repoSnapshot = await tx.get(this.repoRef(branchLoc));
      const branchSnapshot = await tx.get(this.branchRef(branchLoc));
      const lockSnapshot = await tx.get(this.branchLockRef(branchLoc));
      if (!repoSnapshot.exists) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      if (!branchSnapshot.exists) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      const repo = cleanRepo(repoSnapshot.data());
      const branch = cleanBranch(branchSnapshot.data());
      if (!repo || !branch) throw new StoreError('repo or branch is invalid', 'invalid');
      if (branch.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');

      const nowMs = Date.now();
      const lock = lockSnapshot.data() as { leaseId?: string; expiresAtMillis?: number } | undefined;
      if (lockSnapshot.exists && (lock?.expiresAtMillis ?? 0) > nowMs) {
        throw new StoreError('branch already has a story turn in progress', 'conflict');
      }

      const lease: BranchMutationLease = {
        leaseId: randomUUID(),
        repoId: input.repoId,
        branchId: input.branchId,
        ownerUserId: repo.ownerUserId ?? branch.ownerUserId ?? null,
        expiresAt: new Date(nowMs + input.ttlMs).toISOString()
      };
      tx.set(this.branchLockRef(branchLoc), {
        schemaVersion: SCHEMA_VERSION,
        documentKind: 'branch_mutation_lock',
        id: input.branchId,
        ...lease,
        ownerKey: branchLoc.ownerKey,
        expiresAtMillis: nowMs + input.ttlMs,
        acquiredAt: new Date(nowMs).toISOString()
      });
      return lease;
    });
  }

  async releaseBranchMutationLease(lease: BranchMutationLease): Promise<void> {
    await this.db.runTransaction(async tx => {
      const branchLoc = await this.locateBranchTx(tx, lease.branchId);
      if (!branchLoc) return;
      const lockRef = this.branchLockRef(branchLoc);
      const lockSnapshot = await tx.get(lockRef);
      const lock = lockSnapshot.data() as { leaseId?: string } | undefined;
      if (lockSnapshot.exists && lock?.leaseId === lease.leaseId) tx.delete(lockRef);
    });
  }

  async commitTurn(input: CommitTurnInput): Promise<TurnCommit> {
    return this.db.runTransaction(async tx => {
      const branchLoc = await this.locateBranchTx(tx, input.branchId);
      if (!branchLoc) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      if (branchLoc.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');

      const repoSnapshot = await tx.get(this.repoRef(branchLoc));
      const branchSnapshot = await tx.get(this.branchRef(branchLoc));
      if (!repoSnapshot.exists) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      if (!branchSnapshot.exists) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      const repo = cleanRepo(repoSnapshot.data());
      const branch = cleanBranch(branchSnapshot.data());
      if (!repo || !branch) throw new StoreError('repo or branch is invalid', 'invalid');
      if (branch.repoId !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');

      const parentTurnId = branch.headTurnId ?? null;
      if (input.expectedHeadTurnId !== undefined && input.expectedHeadTurnId !== parentTurnId) {
        throw new StoreError('branch head moved before the turn could be committed', 'conflict');
      }
      const parent = parentTurnId ? await this.getTurnTx(tx, parentTurnId) : null;
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
      const turnLoc: TurnLoc = { ...branchLoc, turnId: turn.id };

      tx.set(this.turnRef(turnLoc), storyDoc(turn, 'turn'));
      tx.set(this.turnIndexRef(turn.id), turnIndexData(turn, branchLoc.ownerKey, this.turnRef(turnLoc).path));
      tx.set(this.branchRef(branchLoc), { headTurnId: turn.id, updatedAt: now }, { merge: true });
      tx.set(this.branchIndexRef(input.branchId), { headTurnId: turn.id, updatedAt: now }, { merge: true });
      tx.set(this.repoRef(branchLoc), { updatedAt: now }, { merge: true });
      tx.set(this.repoIndexRef(input.repoId), { updatedAt: now }, { merge: true });
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
      const turn = await this.getTurn(currentId);
      if (!turn) throw new StoreError(`turn not found: ${currentId}`, 'not_found');
      timeline.push(turn);
      currentId = turn.parentTurnId ?? null;
    }
    return timeline.reverse().map(turn => clone(turn));
  }

  async getState(branchId: string): Promise<WorldState | null> {
    const branchLoc = await this.locateBranch(branchId);
    if (!branchLoc) return null;
    const snapshot = await this.stateRef(branchLoc).get();
    const state = (snapshot.data() as { state?: WorldState } | undefined)?.state;
    return state ? clone(state) : null;
  }

  async applyCanonPatch(input: ApplyCanonPatchInput): Promise<void> {
    await this.db.runTransaction(async tx => {
      const turnLoc = await this.locateTurnTx(tx, input.turnId);
      if (!turnLoc) throw new StoreError(`turn not found: ${input.turnId}`, 'not_found');
      if (turnLoc.repoId !== input.repoId || turnLoc.branchId !== input.branchId) {
        throw new StoreError('turn does not belong to branch or repo', 'invalid');
      }

      const repoSnapshot = await tx.get(this.repoRef(turnLoc));
      const branchSnapshot = await tx.get(this.branchRef(turnLoc));
      const turnSnapshot = await tx.get(this.turnRef(turnLoc));
      if (!repoSnapshot.exists) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');
      if (!branchSnapshot.exists) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      if (!turnSnapshot.exists) throw new StoreError(`turn not found: ${input.turnId}`, 'not_found');
      const repo = cleanRepo(repoSnapshot.data());
      const branch = cleanBranch(branchSnapshot.data());
      const turn = cleanTurn(turnSnapshot.data());
      if (!repo || !branch || !turn) throw new StoreError('repo, branch, or turn is invalid', 'invalid');
      if (turn.repoId !== input.repoId || turn.branchId !== input.branchId) {
        throw new StoreError('turn does not belong to branch or repo', 'invalid');
      }
      if ((branch.headTurnId ?? null) !== input.turnId) {
        throw new StoreError('cannot canonize a turn that is no longer the branch head', 'conflict');
      }

      const now = new Date().toISOString();
      const ownerUserId = repo.ownerUserId ?? branch.ownerUserId ?? turn.ownerUserId ?? null;
      const ownerKey = turnLoc.ownerKey;
      const stateHash = sha256Json(input.state);
      const status = input.patch.warnings.some(w => w.severity === 'high') ? 'needs_review' : 'canonized';
      const modelMetadata = [...(turn.modelMetadata ?? []), ...(input.modelMetadata ?? [])];
      const patchId = randomUUID();

      tx.set(this.patchRef(turnLoc, patchId), {
        schemaVersion: SCHEMA_VERSION,
        documentKind: 'canon_patch',
        id: patchId,
        repoId: input.repoId,
        branchId: input.branchId,
        turnId: input.turnId,
        ownerUserId,
        ownerKey,
        patch: input.patch,
        status: 'applied',
        createdAt: now,
        appliedAt: now
      });
      tx.set(this.snapshotRef(turnLoc), {
        schemaVersion: SCHEMA_VERSION,
        documentKind: 'branch_snapshot',
        id: input.turnId,
        repoId: input.repoId,
        branchId: input.branchId,
        turnId: input.turnId,
        ownerUserId,
        ownerKey,
        state: input.state,
        stateHash,
        createdAt: now
      });
      tx.set(this.stateRef(turnLoc), branchStateData(turnLoc, input.branchId, input.turnId, input.state, now));
      tx.set(this.turnRef(turnLoc), { stateStatus: status, modelMetadata, updatedAt: now }, { merge: true });
      tx.set(this.turnIndexRef(input.turnId), { stateStatus: status, updatedAt: now }, { merge: true });
      tx.set(this.repoRef(turnLoc), { updatedAt: now }, { merge: true });
      tx.set(this.repoIndexRef(input.repoId), { updatedAt: now }, { merge: true });

      for (const warning of input.patch.warnings) {
        const warningId = randomUUID();
        tx.set(this.warningRef(turnLoc, warningId), {
          schemaVersion: SCHEMA_VERSION,
          documentKind: 'continuity_warning',
          id: warningId,
          repoId: input.repoId,
          branchId: input.branchId,
          turnId: input.turnId,
          ownerUserId,
          ownerKey,
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

  private async deleteKnownRepoDocuments(loc: RepoLoc): Promise<void> {
    const repoRef = this.repoRef(loc);
    const names = [
      COLLECTIONS.branches,
      COLLECTIONS.turns,
      COLLECTIONS.states,
      COLLECTIONS.snapshots,
      COLLECTIONS.patches,
      COLLECTIONS.warnings,
      COLLECTIONS.locks,
      COLLECTIONS.audioAssets,
      COLLECTIONS.audioUploads
    ];
    const refs: FirestoreDocRef[] = [];
    for (const name of names) {
      const snapshot = await repoRef.collection(name).get();
      refs.push(...snapshot.docs.map(doc => doc.ref));
    }
    refs.push(repoRef);
    await this.deleteRefs(refs);
  }

  private async deleteRefs(refs: FirestoreDocRef[]): Promise<void> {
    const uniqueRefs = [...new Map(refs.map(ref => [ref.path, ref])).values()];
    for (let i = 0; i < uniqueRefs.length; i += 450) {
      const batch = this.db.batch();
      for (const ref of uniqueRefs.slice(i, i + 450)) batch.delete(ref);
      await batch.commit();
    }
  }

  private userRef(ownerKey: string): FirestoreDocRef {
    return this.db.collection(COLLECTIONS.users).doc(ownerKey);
  }

  private repoRef(loc: RepoLoc): FirestoreDocRef {
    return this.userRef(loc.ownerKey).collection(COLLECTIONS.repos).doc(loc.repoId);
  }

  private branchRef(loc: BranchLoc): FirestoreDocRef {
    return this.repoRef(loc).collection(COLLECTIONS.branches).doc(loc.branchId);
  }

  private turnRef(loc: TurnLoc): FirestoreDocRef {
    return this.repoRef(loc).collection(COLLECTIONS.turns).doc(loc.turnId);
  }

  private stateRef(loc: BranchLoc): FirestoreDocRef {
    return this.repoRef(loc).collection(COLLECTIONS.states).doc(loc.branchId);
  }

  private snapshotRef(loc: TurnLoc): FirestoreDocRef {
    return this.repoRef(loc).collection(COLLECTIONS.snapshots).doc(loc.turnId);
  }

  private patchRef(loc: TurnLoc, patchId: string): FirestoreDocRef {
    return this.repoRef(loc).collection(COLLECTIONS.patches).doc(patchId);
  }

  private warningRef(loc: TurnLoc, warningId: string): FirestoreDocRef {
    return this.repoRef(loc).collection(COLLECTIONS.warnings).doc(warningId);
  }

  private branchLockRef(loc: BranchLoc): FirestoreDocRef {
    return this.repoRef(loc).collection(COLLECTIONS.locks).doc(loc.branchId);
  }

  private audioAssetRef(loc: RepoLoc, assetId: string): FirestoreDocRef {
    return this.repoRef(loc).collection(COLLECTIONS.audioAssets).doc(assetId);
  }

  private audioUploadRef(loc: RepoLoc, uploadId: string): FirestoreDocRef {
    return this.repoRef(loc).collection(COLLECTIONS.audioUploads).doc(uploadId);
  }

  private repoIndexRef(repoId: string): FirestoreDocRef {
    return this.db.collection(COLLECTIONS.repoIndex).doc(repoId);
  }

  private branchIndexRef(branchId: string): FirestoreDocRef {
    return this.db.collection(COLLECTIONS.branchIndex).doc(branchId);
  }

  private turnIndexRef(turnId: string): FirestoreDocRef {
    return this.db.collection(COLLECTIONS.turnIndex).doc(turnId);
  }

  private async locateRepo(repoId: string): Promise<RepoLoc | null> {
    const snapshot = await this.repoIndexRef(repoId).get();
    return snapshot.exists ? repoLocFromIndex(repoId, snapshot.data()) : null;
  }

  private async locateRepoTx(tx: Transaction, repoId: string): Promise<RepoLoc | null> {
    const snapshot = await tx.get(this.repoIndexRef(repoId));
    return snapshot.exists ? repoLocFromIndex(repoId, snapshot.data()) : null;
  }

  private async locateBranch(branchId: string): Promise<BranchLoc | null> {
    const snapshot = await this.branchIndexRef(branchId).get();
    return snapshot.exists ? branchLocFromIndex(branchId, snapshot.data()) : null;
  }

  private async locateBranchTx(tx: Transaction, branchId: string): Promise<BranchLoc | null> {
    const snapshot = await tx.get(this.branchIndexRef(branchId));
    return snapshot.exists ? branchLocFromIndex(branchId, snapshot.data()) : null;
  }

  private async locateTurn(turnId: string): Promise<TurnLoc | null> {
    const snapshot = await this.turnIndexRef(turnId).get();
    return snapshot.exists ? turnLocFromIndex(turnId, snapshot.data()) : null;
  }

  private async locateTurnTx(tx: Transaction, turnId: string): Promise<TurnLoc | null> {
    const snapshot = await tx.get(this.turnIndexRef(turnId));
    return snapshot.exists ? turnLocFromIndex(turnId, snapshot.data()) : null;
  }

  private async getTurn(turnId: string): Promise<TurnCommit | null> {
    const loc = await this.locateTurn(turnId);
    if (!loc) return null;
    const snapshot = await this.turnRef(loc).get();
    return snapshot.exists ? cleanTurn(snapshot.data()) : null;
  }

  private async getTurnTx(tx: Transaction, turnId: string): Promise<TurnCommit | null> {
    const loc = await this.locateTurnTx(tx, turnId);
    if (!loc) return null;
    const snapshot = await tx.get(this.turnRef(loc));
    return snapshot.exists ? cleanTurn(snapshot.data()) : null;
  }
}

function userRootData(ownerKey: string, ownerUserId: string | null, now: string): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    documentKind: ownerUserId ? 'user' : 'reserved_owner',
    ownerKey,
    uid: ownerUserId,
    updatedAt: now,
    lastStoryActivityAt: now
  };
}

function branchStateData(loc: RepoLoc, branchId: string, headTurnId: string | null, state: WorldState, now: string): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    documentKind: 'branch_state',
    id: branchId,
    repoId: loc.repoId,
    branchId,
    ownerUserId: loc.ownerUserId,
    ownerKey: loc.ownerKey,
    headTurnId,
    state,
    stateHash: sha256Json(state),
    updatedAt: now
  };
}

function storyDoc<T extends object>(value: T, documentKind: string): Record<string, unknown> {
  return { schemaVersion: SCHEMA_VERSION, documentKind, ...(value as Record<string, unknown>) };
}

function repoIndexData(repo: StoryRepo, ownerKey: string, repoPath: string): Record<string, unknown> {
  return {
    ...storyDoc(repo, 'story_repo_index'),
    repoId: repo.id,
    ownerKey,
    repoPath
  };
}

function branchIndexData(branch: BranchRef, ownerKey: string, branchPath: string): Record<string, unknown> {
  return {
    ...storyDoc(branch, 'story_branch_index'),
    branchId: branch.id,
    ownerKey,
    branchPath
  };
}

function turnIndexData(turn: TurnCommit, ownerKey: string, turnPath: string): Record<string, unknown> {
  return {
    ...storyDoc(turn, 'story_turn_index'),
    turnId: turn.id,
    ownerKey,
    turnPath
  };
}

function repoLocFromIndex(repoId: string, data: DocumentData | undefined): RepoLoc | null {
  const ownerUserId = normalizeOwnerUserId(data?.ownerUserId);
  const ownerKey = stringFrom(data?.ownerKey) || ownerKeyFromOwnerUserId(ownerUserId);
  return ownerKey ? { repoId, ownerKey, ownerUserId } : null;
}

function branchLocFromIndex(branchId: string, data: DocumentData | undefined): BranchLoc | null {
  const repoId = stringFrom(data?.repoId);
  if (!repoId) return null;
  const repoLoc = repoLocFromIndex(repoId, data);
  return repoLoc ? { ...repoLoc, branchId } : null;
}

function turnLocFromIndex(turnId: string, data: DocumentData | undefined): TurnLoc | null {
  const branchId = stringFrom(data?.branchId);
  if (!branchId) return null;
  const branchLoc = branchLocFromIndex(branchId, data);
  return branchLoc ? { ...branchLoc, turnId } : null;
}

function cleanRepo(data: DocumentData | undefined): StoryRepo | null {
  if (!data) return null;
  const id = stringFrom(data.id);
  if (!id) return null;
  return clone({
    id,
    ownerUserId: normalizeOwnerUserId(data.ownerUserId),
    title: stringFrom(data.title),
    description: nullableString(data.description),
    defaultStyle: nullableString(data.defaultStyle),
    safetyProfile: nullableString(data.safetyProfile),
    createdAt: stringFrom(data.createdAt),
    updatedAt: stringFrom(data.updatedAt)
  });
}

function cleanBranch(data: DocumentData | undefined): BranchRef | null {
  if (!data) return null;
  const id = stringFrom(data.id);
  const repoId = stringFrom(data.repoId);
  if (!id || !repoId) return null;
  return clone({
    id,
    repoId,
    ownerUserId: normalizeOwnerUserId(data.ownerUserId),
    name: stringFrom(data.name),
    headTurnId: nullableString(data.headTurnId),
    forkedFromTurnId: nullableString(data.forkedFromTurnId),
    createdAt: stringFrom(data.createdAt),
    updatedAt: stringFrom(data.updatedAt)
  });
}

function cleanTurn(data: DocumentData | undefined): TurnCommit | null {
  if (!data) return null;
  const id = stringFrom(data.id);
  const repoId = stringFrom(data.repoId);
  const branchId = stringFrom(data.branchId);
  if (!id || !repoId || !branchId) return null;
  return clone({
    id,
    repoId,
    branchId,
    ownerUserId: normalizeOwnerUserId(data.ownerUserId),
    parentTurnId: nullableString(data.parentTurnId),
    turnIndex: numberFrom(data.turnIndex),
    userAudioAssetId: nullableString(data.userAudioAssetId),
    assistantAudioAssetId: nullableString(data.assistantAudioAssetId),
    userTranscript: stringFrom(data.userTranscript),
    assistantTranscript: stringFrom(data.assistantTranscript),
    stateStatus: (stringFrom(data.stateStatus) || 'pending') as TurnCommit['stateStatus'],
    modelMetadata: Array.isArray(data.modelMetadata) ? data.modelMetadata : [],
    createdAt: stringFrom(data.createdAt),
    committedAt: nullableString(data.committedAt)
  });
}

function cleanAudioAsset(data: DocumentData | undefined): AudioAsset | null {
  if (!data) return null;
  const id = stringFrom(data.id);
  const repoId = stringFrom(data.repoId);
  if (!id || !repoId) return null;
  return clone({
    id,
    repoId,
    branchId: nullableString(data.branchId),
    uploadId: nullableString(data.uploadId),
    role: (stringFrom(data.role) || 'user') as AudioAsset['role'],
    storageProvider: (stringFrom(data.storageProvider) || null) as AudioAsset['storageProvider'],
    storageUri: stringFrom(data.storageUri),
    contentType: nullableString(data.contentType),
    sha256: stringFrom(data.sha256),
    crc32c: nullableString(data.crc32c),
    md5Hash: nullableString(data.md5Hash),
    gcsGeneration: nullableString(data.gcsGeneration),
    gcsMetageneration: nullableString(data.gcsMetageneration),
    codec: stringFrom(data.codec),
    container: stringFrom(data.container),
    sampleRate: optionalNumber(data.sampleRate),
    durationMs: optionalNumber(data.durationMs),
    byteLength: optionalNumber(data.byteLength),
    encryptionKeyRef: nullableString(data.encryptionKeyRef),
    uploadedAt: nullableString(data.uploadedAt),
    verifiedAt: nullableString(data.verifiedAt),
    createdAt: stringFrom(data.createdAt)
  });
}

function cleanAudioUploadIntent(data: DocumentData | undefined): AudioUploadIntent | null {
  if (!data) return null;
  const id = stringFrom(data.id);
  const repoId = stringFrom(data.repoId);
  const storageUri = stringFrom(data.storageUri);
  if (!id || !repoId || !storageUri) return null;
  return clone({
    id,
    repoId,
    branchId: nullableString(data.branchId),
    ownerUserId: normalizeOwnerUserId(data.ownerUserId),
    role: (stringFrom(data.role) || 'user') as AudioUploadIntent['role'],
    storageProvider: 'gcs',
    storageUri,
    contentType: stringFrom(data.contentType),
    sha256: stringFrom(data.sha256),
    crc32c: nullableString(data.crc32c),
    codec: stringFrom(data.codec),
    container: stringFrom(data.container),
    sampleRate: optionalNumber(data.sampleRate),
    durationMs: optionalNumber(data.durationMs),
    byteLength: numberFrom(data.byteLength),
    encryptionKeyRef: nullableString(data.encryptionKeyRef),
    status: (stringFrom(data.status) || 'pending') as AudioUploadIntent['status'],
    audioAssetId: nullableString(data.audioAssetId),
    createdAt: stringFrom(data.createdAt),
    expiresAt: stringFrom(data.expiresAt),
    verifiedAt: nullableString(data.verifiedAt)
  });
}

function ownerKeyFromOwnerUserId(ownerUserId: string | null | undefined): string {
  return normalizeOwnerUserId(ownerUserId) ?? UNOWNED_OWNER_KEY;
}

function normalizeOwnerUserId(value: unknown): string | null {
  const text = stringFrom(value);
  return text || null;
}

function nullableString(value: unknown): string | null {
  return stringFrom(value) || null;
}

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberFrom(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sortByCreatedAt<T extends { createdAt: string }>(a: T, b: T): number {
  return a.createdAt.localeCompare(b.createdAt);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
