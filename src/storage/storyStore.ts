import type {
  BranchRef,
  CreateRepoInput,
  ForkBranchInput,
  ModelInvocationMetadata,
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
  userTranscript: string;
  assistantTranscript: string;
  userAudioAssetId?: string | null;
  assistantAudioAssetId?: string | null;
  modelMetadata?: ModelInvocationMetadata[];
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
