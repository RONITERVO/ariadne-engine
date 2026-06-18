import type { ContextBudgetMode } from './contextBudget.js';
import type { AudioQualityProfile } from './audioQuality.js';

export type ID = string;

export type ProviderName = 'google-ai-studio' | 'mock';
export type AudioRole = 'user' | 'assistant' | 'system';
export type AudioUploadStatus = 'pending' | 'verified' | 'expired' | 'failed';

export interface AudioObjectVerification {
  byteLength: number;
  contentType?: string | null;
  crc32c?: string | null;
  md5Hash?: string | null;
  generation?: string | null;
  metageneration?: string | null;
  etag?: string | null;
  encryptionKeyRef?: string | null;
  updatedAt?: string | null;
}

export interface AudioUploadIntent {
  id: ID;
  repoId: ID;
  branchId?: ID | null;
  turnId?: ID | null;
  ownerUserId?: ID | null;
  role: AudioRole;
  storageProvider: 'gcs';
  storageUri: string;
  contentType: string;
  sha256: string;
  crc32c?: string | null;
  codec: string;
  container: string;
  qualityProfile?: AudioQualityProfile | null;
  bitrateKbps?: number;
  channelCount?: number;
  sampleRate?: number;
  durationMs?: number;
  byteLength: number;
  encryptionKeyRef?: string | null;
  status: AudioUploadStatus;
  audioAssetId?: ID | null;
  createdAt: string;
  expiresAt: string;
  verifiedAt?: string | null;
}

export interface AudioAsset {
  id: ID;
  repoId: ID;
  branchId?: ID | null;
  turnId?: ID | null;
  uploadId?: ID | null;
  role: AudioRole;
  storageProvider?: 'gcs' | 'external' | null;
  storageUri: string;
  contentType?: string | null;
  sha256: string;
  crc32c?: string | null;
  md5Hash?: string | null;
  gcsGeneration?: string | null;
  gcsMetageneration?: string | null;
  gcsEtag?: string | null;
  codec: string;
  container: string;
  qualityProfile?: AudioQualityProfile | null;
  bitrateKbps?: number;
  channelCount?: number;
  sampleRate?: number;
  durationMs?: number;
  byteLength?: number;
  encryptionKeyRef?: string | null;
  uploadedAt?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
}

export interface StoryRepo {
  id: ID;
  ownerUserId?: ID | null;
  title: string;
  description?: string | null;
  defaultStyle?: string | null;
  safetyProfile?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BranchRef {
  id: ID;
  repoId: ID;
  ownerUserId?: ID | null;
  name: string;
  headTurnId?: ID | null;
  forkedFromTurnId?: ID | null;
  createdAt: string;
  updatedAt: string;
}

export type TurnStateStatus = 'pending' | 'canonized' | 'needs_review' | 'failed';

export interface ModelInvocationMetadata {
  provider: ProviderName | string;
  model: string;
  purpose: 'actor' | 'canonizer' | 'auditor' | 'summarizer' | 'embedding' | 'live-token' | 'validation';
  promptVersion?: string;
  contextHash?: string;
  requestHash?: string;
  usage?: Record<string, unknown> | null;
  startedAt?: string;
  completedAt?: string;
}

export interface TurnCommit {
  id: ID;
  repoId: ID;
  branchId: ID;
  ownerUserId?: ID | null;
  parentTurnId?: ID | null;
  turnIndex: number;
  userAudioAssetId?: ID | null;
  assistantAudioAssetId?: ID | null;
  userTranscript: string;
  assistantTranscript: string;
  stateStatus: TurnStateStatus;
  modelMetadata?: ModelInvocationMetadata[];
  createdAt: string;
  updatedAt?: string | null;
  committedAt?: string | null;
}

export type EventType =
  | 'PLAYER_MOVED'
  | 'CHARACTER_APPEARED'
  | 'CHARACTER_LEFT'
  | 'ITEM_GAINED'
  | 'ITEM_LOST'
  | 'SECRET_REVEALED'
  | 'PROMISE_MADE'
  | 'PROMISE_FULFILLED'
  | 'PROMISE_BROKEN'
  | 'RELATIONSHIP_CHANGED'
  | 'COMBAT_STARTED'
  | 'COMBAT_ENDED'
  | 'INJURY_APPLIED'
  | 'THREAD_OPENED'
  | 'THREAD_RESOLVED'
  | 'WORLD_RULE_ESTABLISHED'
  | 'OTHER';

export interface StoryEvent {
  eventType: EventType;
  summary: string;
  participants: ID[];
  locationId?: ID | null;
  certainty: 'canon' | 'rumored' | 'unknown';
  metadata?: Record<string, unknown>;
}

export interface FactPatch {
  subjectId: ID;
  predicate: string;
  value: unknown;
  certainty: 'canon' | 'rumored' | 'unknown';
  knownBy?: ID[];
}

export interface ThreadPatch {
  threadId: ID;
  status: 'open' | 'advanced' | 'resolved' | 'abandoned';
  summary: string;
  priority?: 1 | 2 | 3 | 4 | 5;
}

export interface StoryEventPatch {
  turnId: ID;
  events: StoryEvent[];
  facts: FactPatch[];
  threads: ThreadPatch[];
  warnings: ContinuityWarning[];
}

export interface ContinuityWarning {
  severity: 'low' | 'medium' | 'high';
  type: string;
  message: string;
  repairStrategy?: string;
}

export interface EntityState {
  id: ID;
  kind: 'player' | 'character' | 'item' | 'location' | 'faction' | 'concept';
  name: string;
  status: string;
  attributes: Record<string, unknown>;
}

export interface WorldState {
  branchId: ID;
  headTurnId: ID;
  scene: {
    locationId: ID;
    summary: string;
    presentEntityIds: ID[];
    tone?: string;
  };
  entities: Record<ID, EntityState>;
  facts: FactPatch[];
  threads: ThreadPatch[];
  contextBudget?: ContextBudgetState;
}

export interface ContextBudgetState {
  estimatedTokens: number;
  safeBudgetTokens: number;
  mode: ContextBudgetMode;
  remainingTurnBudget: number;
}

export interface CreateRepoInput {
  title: string;
  description?: string;
  defaultStyle?: string;
  safetyProfile?: string;
  ownerUserId?: string;
}

export interface ForkBranchInput {
  repoId: ID;
  sourceTurnId?: ID | null;
  name: string;
  forkReason?: string;
}

export interface RegisterAudioAssetInput {
  uploadId?: ID | null;
  repoId: ID;
  branchId?: ID | null;
  turnId?: ID | null;
  role: AudioRole;
  storageProvider?: 'gcs' | 'external' | null;
  storageUri: string;
  contentType?: string | null;
  sha256: string;
  crc32c?: string | null;
  md5Hash?: string | null;
  gcsGeneration?: string | null;
  gcsMetageneration?: string | null;
  gcsEtag?: string | null;
  codec: string;
  container: string;
  qualityProfile?: AudioQualityProfile | null;
  bitrateKbps?: number;
  channelCount?: number;
  sampleRate?: number;
  durationMs?: number;
  byteLength?: number;
  encryptionKeyRef?: string | null;
  uploadedAt?: string | null;
  verifiedAt?: string | null;
}
