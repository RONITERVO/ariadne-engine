import type { ContextCapsule } from '../domain/contextCapsule.js';
import type { ModelInvocationMetadata, ProviderName, StoryEventPatch, WorldState } from '../domain/types.js';

export interface ProviderValidationResult {
  ok: boolean;
  provider: ProviderName | string;
  model?: string;
  keyFingerprint?: string;
  message?: string;
}

export interface ActorTurnInput {
  apiKey: string;
  model: string;
  capsule: ContextCapsule;
  userTranscript: string;
  style?: string | null;
}

export interface ActorTurnResult {
  text: string;
  metadata: ModelInvocationMetadata;
}

export type ActorTurnStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'complete'; result: ActorTurnResult };

export interface CanonizeTurnInput {
  apiKey: string;
  model: string;
  turnId: string;
  priorState: WorldState;
  userTranscript: string;
  assistantTranscript: string;
}

export interface CanonizeTurnResult {
  patch: StoryEventPatch;
  metadata: ModelInvocationMetadata;
}

export interface LiveTokenInput {
  apiKey: string;
  model: string;
  responseModalities: Array<'AUDIO' | 'TEXT'>;
  systemInstruction?: string;
  languageCodes?: string[];
  voiceName?: string;
}

export interface LiveTokenResult {
  provider: ProviderName | string;
  token: string;
  model: string;
  responseModalities: Array<'AUDIO' | 'TEXT'>;
  expiresAt?: string;
  newSessionExpiresAt?: string;
  sessionId?: string;
}

export interface StoryReasoningProvider {
  readonly name: ProviderName | string;
  validateKey(apiKey: string, model: string): Promise<ProviderValidationResult>;
  generateActorTurn(input: ActorTurnInput): Promise<ActorTurnResult>;
  generateActorTurnStream?(input: ActorTurnInput): AsyncIterable<ActorTurnStreamEvent>;
  canonizeTurn(input: CanonizeTurnInput): Promise<CanonizeTurnResult>;
  createLiveToken(input: LiveTokenInput): Promise<LiveTokenResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: 'unauthorized' | 'rate_limited' | 'bad_response' | 'unavailable' | 'invalid' = 'unavailable',
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
