import type {
  AudioAsset,
  AudioObjectVerification,
  AudioUploadIntent,
  BranchRef,
  CreateRepoInput,
  ForkBranchInput,
  ModelInvocationMetadata,
  RegisterAudioAssetInput,
  StoryEventPatch,
  StoryRepo,
  TurnCommit,
  WorldState
} from '../domain/types.js';

export interface CreateRepoResult {
  repo: StoryRepo;
  branch: BranchRef;
  state: WorldState;
}

export interface CommitTurnInput {
  repoId: string;
  branchId: string;
  expectedHeadTurnId: string | null;
  userTranscript: string;
  assistantTranscript: string;
  modelMetadata?: ModelInvocationMetadata[];
}

export interface CreateAudioUploadIntentInput {
  uploadId: string;
  repoId: string;
  branchId?: string | null;
  turnId?: string | null;
  ownerUserId?: string | null;
  role: AudioUploadIntent['role'];
  storageProvider: 'gcs';
  storageUri: string;
  contentType: string;
  sha256: string;
  crc32c?: string | null;
  codec: string;
  container: string;
  qualityProfile?: AudioUploadIntent['qualityProfile'];
  bitrateKbps?: number;
  channelCount?: number;
  sampleRate?: number;
  durationMs?: number;
  byteLength: number;
  encryptionKeyRef?: string | null;
  expiresAt: string;
}

export interface CompleteAudioUploadIntentInput {
  repoId: string;
  uploadId: string;
  verification: AudioObjectVerification;
}

export interface LinkAudioAssetToTurnInput {
  repoId: string;
  branchId: string;
  turnId: string;
  role: AudioUploadIntent['role'];
  audioAssetId: string;
}

export interface BranchMutationLeaseInput {
  repoId: string;
  branchId: string;
  ttlMs: number;
}

export interface BranchMutationLease {
  leaseId: string;
  repoId: string;
  branchId: string;
  ownerUserId?: string | null;
  expiresAt: string;
}

export interface ApplyCanonPatchInput {
  repoId: string;
  branchId: string;
  turnId: string;
  patch: StoryEventPatch;
  state: WorldState;
  modelMetadata?: ModelInvocationMetadata[];
}

export interface StoryStore {
  createRepo(input: CreateRepoInput): Promise<CreateRepoResult>;
  getRepo(repoId: string): Promise<StoryRepo | null>;
  listRepos(ownerUserId?: string): Promise<StoryRepo[]>;
  getBranch(branchId: string): Promise<BranchRef | null>;
  listBranches(repoId: string): Promise<BranchRef[]>;
  forkBranch(input: ForkBranchInput): Promise<{ branch: BranchRef; state: WorldState }>;
  deleteRepo(repoId: string): Promise<void>;
  createAudioUploadIntent(input: CreateAudioUploadIntentInput): Promise<AudioUploadIntent>;
  getAudioUploadIntent(repoId: string, uploadId: string): Promise<AudioUploadIntent | null>;
  listAudioUploadIntents(repoId: string, branchId?: string): Promise<AudioUploadIntent[]>;
  completeAudioUploadIntent(input: CompleteAudioUploadIntentInput): Promise<AudioAsset>;
  saveAudioAsset(input: RegisterAudioAssetInput): Promise<AudioAsset>;
  getAudioAsset(repoId: string, assetId: string): Promise<AudioAsset | null>;
  listAudioAssets(repoId: string, branchId?: string): Promise<AudioAsset[]>;
  getTurn(turnId: string): Promise<TurnCommit | null>;
  linkAudioAssetToTurn(input: LinkAudioAssetToTurnInput): Promise<TurnCommit>;
  acquireBranchMutationLease(input: BranchMutationLeaseInput): Promise<BranchMutationLease>;
  releaseBranchMutationLease(lease: BranchMutationLease): Promise<void>;
  commitTurn(input: CommitTurnInput): Promise<TurnCommit>;
  getTimeline(branchId: string): Promise<TurnCommit[]>;
  getState(branchId: string): Promise<WorldState | null>;
  applyCanonPatch(input: ApplyCanonPatchInput): Promise<void>;
  close?(): Promise<void>;
}

export class StoreError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'conflict' | 'invalid' | 'unavailable' = 'invalid'
  ) {
    super(message);
    this.name = 'StoreError';
  }
}
