import { z } from 'zod';
import { AUDIO_QUALITY_PROFILE_NAMES } from './audioQuality.js';

function hasNoHeaderControlChars(value: string): boolean {
  return !/[\r\n\0]/.test(value);
}

function headerSafeString(max: number) {
  return z.string().trim().max(max).refine(hasNoHeaderControlChars, {
    message: 'value must not contain control characters'
  });
}

function audioMetadataString(max: number) {
  return z.string().trim().min(1).max(max).refine(hasNoHeaderControlChars, {
    message: 'value must not contain control characters'
  });
}

const AudioContentTypeSchema = z.string().trim().min(3).max(120).refine(hasNoHeaderControlChars, {
  message: 'value must not contain control characters'
}).refine(value => /^audio\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*$/.test(value), {
  message: 'contentType must be an audio MIME type'
});

const AudioMetadataStringSchema = audioMetadataString(160);
const AudioCodecSchema = audioMetadataString(80);
const AudioQualityProfileSchema = z.enum(AUDIO_QUALITY_PROFILE_NAMES);
const AudioSha256Schema = z.string().trim().regex(/^[a-f0-9]{64}$/i).transform(value => value.toLowerCase());
const GcsStorageUriSchema = z.string().trim().min(8).max(2048).regex(/^gs:\/\/[^/]+\/.+$/, {
  message: 'storageUri must be a gs://bucket/object URI'
}).refine(hasNoHeaderControlChars, {
  message: 'value must not contain control characters'
});

export const EventTypeSchema = z.enum([
  'PLAYER_MOVED',
  'CHARACTER_APPEARED',
  'CHARACTER_LEFT',
  'ITEM_GAINED',
  'ITEM_LOST',
  'SECRET_REVEALED',
  'PROMISE_MADE',
  'PROMISE_FULFILLED',
  'PROMISE_BROKEN',
  'RELATIONSHIP_CHANGED',
  'COMBAT_STARTED',
  'COMBAT_ENDED',
  'INJURY_APPLIED',
  'THREAD_OPENED',
  'THREAD_RESOLVED',
  'WORLD_RULE_ESTABLISHED',
  'OTHER'
]);

export const CertaintySchema = z.enum(['canon', 'rumored', 'unknown']);

export const StoryEventSchema = z.object({
  eventType: EventTypeSchema,
  summary: z.string().min(1).max(2000),
  participants: z.array(z.string().min(1)).default([]),
  locationId: z.string().nullable().optional(),
  certainty: CertaintySchema.default('canon'),
  metadata: z.record(z.unknown()).optional()
});

export const FactPatchSchema = z.object({
  subjectId: z.string().min(1),
  predicate: z.string().min(1).max(120),
  value: z.any(),
  certainty: CertaintySchema.default('canon'),
  knownBy: z.array(z.string()).optional()
});

export const ThreadPatchSchema = z.object({
  threadId: z.string().min(1),
  status: z.enum(['open', 'advanced', 'resolved', 'abandoned']),
  summary: z.string().min(1).max(2000),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional()
});

export const ContinuityWarningSchema = z.object({
  severity: z.enum(['low', 'medium', 'high']),
  type: z.string().min(1).max(120),
  message: z.string().min(1).max(2000),
  repairStrategy: z.string().max(1000).optional()
});

export const StoryEventPatchSchema = z.object({
  turnId: z.string().min(1),
  events: z.array(StoryEventSchema).default([]),
  facts: z.array(FactPatchSchema).default([]),
  threads: z.array(ThreadPatchSchema).default([]),
  warnings: z.array(ContinuityWarningSchema).default([])
});

export const CreateRepoBodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  style: z.string().trim().max(1000).optional(),
  defaultStyle: z.string().trim().max(1000).optional(),
  safetyProfile: z.string().trim().max(80).optional()
});

export const StoryTurnBodySchema = z.object({
  repoId: z.string().min(1),
  branchId: z.string().min(1),
  expectedHeadTurnId: z.string().min(1).nullable(),
  userTranscript: z.string().trim().min(1),
  actorModel: z.string().trim().min(1).max(120).optional(),
  canonizerModel: z.string().trim().min(1).max(120).optional()
});

export const LiveTurnBodySchema = z.object({
  repoId: z.string().min(1),
  branchId: z.string().min(1),
  liveSessionId: z.string().trim().min(1).max(160).optional(),
  expectedHeadTurnId: z.string().min(1).nullable(),
  userTranscript: z.string().trim().min(1),
  assistantTranscript: z.string().trim().min(1),
  userAudioAssetId: z.string().trim().min(1).max(160).nullable().optional(),
  assistantAudioAssetId: z.string().trim().min(1).max(160).nullable().optional()
});

export const ForkBranchBodySchema = z.object({
  repoId: z.string().min(1),
  sourceTurnId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  forkReason: z.string().trim().max(500).optional()
});

export const LiveTokenBodySchema = z.object({
  repoId: z.string().min(1),
  branchId: z.string().min(1),
  model: z.string().trim().min(1).max(160).optional(),
  responseModalities: z.array(z.enum(['AUDIO', 'TEXT'])).min(1).max(2).optional(),
  voiceName: z.string().trim().min(1).max(120).optional()
});


const Crc32cSchema = z.string().trim().regex(/^[A-Za-z0-9+/]{6}==$/, {
  message: 'crc32c must be base64-encoded big-endian CRC32C'
});

const AudioManifestBodySchema = z.object({
  uploadId: z.string().trim().min(1).max(160).nullable().optional(),
  repoId: AudioMetadataStringSchema,
  branchId: AudioMetadataStringSchema.nullable().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  storageProvider: z.enum(['gcs', 'external']).nullable().optional(),
  storageUri: GcsStorageUriSchema,
  contentType: AudioContentTypeSchema.nullable().optional(),
  sha256: AudioSha256Schema,
  crc32c: Crc32cSchema.nullable().optional(),
  md5Hash: headerSafeString(64).nullable().optional(),
  gcsGeneration: headerSafeString(80).nullable().optional(),
  gcsMetageneration: headerSafeString(80).nullable().optional(),
  gcsEtag: headerSafeString(256).nullable().optional(),
  codec: AudioCodecSchema,
  container: AudioCodecSchema,
  qualityProfile: AudioQualityProfileSchema.nullable().optional(),
  bitrateKbps: z.number().int().min(1).max(2000).optional(),
  channelCount: z.number().int().min(1).max(8).optional(),
  sampleRate: z.number().int().min(1).max(384000).optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  byteLength: z.number().int().min(0).max(10 * 1024 * 1024 * 1024).optional(),
  encryptionKeyRef: headerSafeString(512).nullable().optional(),
  uploadedAt: headerSafeString(80).nullable().optional(),
  verifiedAt: headerSafeString(80).nullable().optional()
});

const AudioUploadRegistrationBodySchema = z.object({
  uploadId: z.string().trim().min(1).max(160),
  repoId: z.string().min(1)
});

export const AudioAssetBodySchema = z.union([AudioUploadRegistrationBodySchema, AudioManifestBodySchema]);

export const AudioUploadUrlBodySchema = z.object({
  repoId: AudioMetadataStringSchema,
  branchId: AudioMetadataStringSchema.nullable().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  contentType: AudioContentTypeSchema,
  sha256: AudioSha256Schema,
  crc32c: Crc32cSchema,
  codec: AudioCodecSchema,
  container: AudioCodecSchema,
  qualityProfile: AudioQualityProfileSchema.optional(),
  bitrateKbps: z.number().int().min(1).max(2000).optional(),
  channelCount: z.number().int().min(1).max(8).optional(),
  sampleRate: z.number().int().min(1).max(384000).optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  byteLength: z.number().int().min(1).max(10 * 1024 * 1024 * 1024)
});

export const StorySearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  repoId: z.string().trim().min(1).optional(),
  branchId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export const BranchCompareQuerySchema = z.object({
  leftBranchId: z.string().trim().min(1),
  rightBranchId: z.string().trim().min(1)
});

export const RepoExportQuerySchema = z.object({
  format: z.enum(['json', 'markdown']).optional()
});
