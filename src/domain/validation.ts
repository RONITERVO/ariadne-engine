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
  assistantTranscript: z.string().trim().min(1)
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
