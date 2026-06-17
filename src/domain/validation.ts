import { z } from 'zod';

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


export const AudioAssetBodySchema = z.object({
  repoId: z.string().min(1),
  branchId: z.string().min(1).nullable().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  storageUri: z.string().trim().min(3).max(2048),
  sha256: z.string().trim().min(16).max(128),
  codec: z.string().trim().min(1).max(80),
  container: z.string().trim().min(1).max(80),
  sampleRate: z.number().int().min(1).max(384000).optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  byteLength: z.number().int().min(0).max(10 * 1024 * 1024 * 1024).optional(),
  encryptionKeyRef: z.string().trim().max(512).nullable().optional()
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
