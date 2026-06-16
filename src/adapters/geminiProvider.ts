import {
  ACTOR_PROMPT_VERSION,
  ACTOR_SYSTEM_PROMPT,
  CANONIZER_PROMPT_VERSION,
  CANONIZER_SYSTEM_PROMPT
} from '../prompts.js';
import { estimateTokensRoughly } from '../domain/contextBudget.js';
import { StoryEventPatchSchema } from '../domain/validation.js';
import { canonicalJson, sha256Text } from '../domain/stateHash.js';
import type { ModelInvocationMetadata, StoryEventPatch } from '../domain/types.js';
import type {
  ActorTurnInput,
  ActorTurnResult,
  ActorTurnStreamEvent,
  CanonizeTurnInput,
  CanonizeTurnResult,
  LiveTokenInput,
  LiveTokenResult,
  ProviderValidationResult,
  StoryReasoningProvider
} from './storyProvider.js';
import { ProviderError } from './storyProvider.js';

type GoogleGenAIClient = {
  models: {
    generateContent(params: Record<string, unknown>): Promise<unknown>;
    generateContentStream(params: Record<string, unknown>): Promise<AsyncIterable<unknown>>;
  };
  authTokens?: {
    create(params: Record<string, unknown>): Promise<unknown>;
  };
};

type GoogleGenAIConstructor = new (config: Record<string, unknown>) => GoogleGenAIClient;

export class GeminiStoryProvider implements StoryReasoningProvider {
  readonly name = 'google-ai-studio' as const;

  async validateKey(apiKey: string, model: string): Promise<ProviderValidationResult> {
    const startedAt = new Date().toISOString();
    try {
      const ai = await this.client(apiKey);
      const response = await ai.models.generateContent({
        model,
        contents: 'Reply with exactly: ok',
        config: { temperature: 0, maxOutputTokens: 8 }
      });
      const text = readText(response).trim().toLowerCase();
      return {
        ok: text.includes('ok'),
        provider: this.name,
        model,
        message: text.includes('ok') ? 'Gemini API key accepted.' : 'Gemini answered, but not with the expected validation text.'
      };
    } catch (error) {
      throw mapProviderError(error, `Gemini key validation failed after ${elapsedMs(startedAt)}ms`);
    }
  }

  async generateActorTurn(input: ActorTurnInput): Promise<ActorTurnResult> {
    const startedAt = new Date().toISOString();
    const prompt = buildActorPrompt(input);
    const contextHash = sha256Text(canonicalJson(input.capsule));

    try {
      const ai = await this.client(input.apiKey);
      const response = await ai.models.generateContent({
        model: input.model,
        contents: prompt,
        config: actorGenerationConfig(input)
      });
      const text = readText(response).trim();
      if (!text) throw new ProviderError('Gemini returned an empty actor response.', 'bad_response');
      return {
        text,
        metadata: actorMetadata({ input, prompt, contextHash, startedAt, usage: readUsageOrEstimate(response, prompt, text) })
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw mapProviderError(error, 'Gemini actor generation failed');
    }
  }

  async *generateActorTurnStream(input: ActorTurnInput): AsyncIterable<ActorTurnStreamEvent> {
    const startedAt = new Date().toISOString();
    const prompt = buildActorPrompt(input);
    const contextHash = sha256Text(canonicalJson(input.capsule));
    let text = '';
    let usage: Record<string, unknown> | null = null;

    try {
      const ai = await this.client(input.apiKey);
      const stream = await ai.models.generateContentStream({
        model: input.model,
        contents: prompt,
        config: actorGenerationConfig(input)
      });

      for await (const chunk of stream) {
        usage = readUsage(chunk) ?? usage;
        const delta = readText(chunk);
        if (!delta) continue;
        text += delta;
        yield { type: 'delta', text: delta };
      }

      const trimmed = text.trim();
      if (!trimmed) throw new ProviderError('Gemini returned an empty actor stream.', 'bad_response');
      yield {
        type: 'complete',
        result: {
          text: trimmed,
          metadata: actorMetadata({ input, prompt, contextHash, startedAt, usage: usageWithEstimate(usage, prompt, trimmed) })
        }
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw mapProviderError(error, 'Gemini actor streaming failed');
    }
  }

  async canonizeTurn(input: CanonizeTurnInput): Promise<CanonizeTurnResult> {
    const startedAt = new Date().toISOString();
    const prompt = buildCanonizerPrompt(input);
    const contextHash = sha256Text(canonicalJson(input.priorState));
    let usage: Record<string, unknown> | null = null;

    const metadata = (usage: Record<string, unknown> | null = null): ModelInvocationMetadata => ({
      provider: this.name,
      model: input.model,
      purpose: 'canonizer',
      promptVersion: CANONIZER_PROMPT_VERSION,
      contextHash,
      requestHash: sha256Text(prompt),
      usage,
      startedAt,
      completedAt: new Date().toISOString()
    });

    try {
      const ai = await this.client(input.apiKey);
      const response = await ai.models.generateContent({
        model: input.model,
        contents: prompt,
        config: {
          systemInstruction: CANONIZER_SYSTEM_PROMPT,
          temperature: 0.15,
          responseMimeType: 'application/json',
          maxOutputTokens: 2200
        }
      });
      const responseText = readText(response);
      usage = readUsageOrEstimate(response, prompt, responseText);
      const json = parseJsonObject(responseText);
      const parsed = StoryEventPatchSchema.safeParse({ ...json, turnId: input.turnId });
      if (!parsed.success) {
        return {
          patch: fallbackPatch(input.turnId, input.assistantTranscript, [
            {
              severity: 'medium',
              type: 'canonizer_schema_error',
              message: parsed.error.message,
              repairStrategy: 'retry_canonizer_or_review_turn'
            }
          ]),
          metadata: metadata(usage)
        };
      }
      return { patch: parsed.data as StoryEventPatch, metadata: metadata(usage) };
    } catch (error) {
      if (error instanceof ProviderError) {
        return {
          patch: fallbackPatch(input.turnId, input.assistantTranscript, [
            {
              severity: 'medium',
              type: 'canonizer_provider_error',
              message: error.message,
              repairStrategy: 'retry_canonizer_or_review_turn'
            }
          ]),
          metadata: metadata(usage)
        };
      }
      return {
        patch: fallbackPatch(input.turnId, input.assistantTranscript, [
          {
            severity: 'medium',
            type: 'canonizer_unknown_error',
            message: `Canonizer failed after ${elapsedMs(startedAt)}ms.`,
            repairStrategy: 'retry_canonizer_or_review_turn'
          }
        ]),
        metadata: metadata()
      };
    }
  }

  async createLiveToken(input: LiveTokenInput): Promise<LiveTokenResult> {
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();
    const liveConfig: Record<string, unknown> = {
      sessionResumption: {},
      responseModalities: input.responseModalities,
      inputAudioTranscription: input.languageCodes?.length ? { languageCodes: input.languageCodes } : {},
      outputAudioTranscription: input.languageCodes?.length ? { languageCodes: input.languageCodes } : {},
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: true },
        turnCoverage: 'TURN_INCLUDES_ALL_INPUT'
      },
      temperature: 0.75
    };
    if (input.systemInstruction) liveConfig.systemInstruction = input.systemInstruction;
    if (input.voiceName) {
      liveConfig.speechConfig = {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voiceName } }
      };
    }

    try {
      const ai = await this.client(input.apiKey, 'v1alpha');
      if (!ai.authTokens?.create) {
        throw new ProviderError('Installed @google/genai SDK does not expose authTokens.create.', 'unavailable');
      }
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: {
            model: input.model,
            config: liveConfig
          },
          httpOptions: { apiVersion: 'v1alpha' }
        }
      });

      const name = readNestedString(token, ['name']);
      if (!name) throw new ProviderError('Gemini did not return a live ephemeral token name.', 'bad_response');

      return {
        provider: this.name,
        token: name,
        model: input.model,
        responseModalities: input.responseModalities,
        expiresAt: readNestedString(token, ['expireTime']) ?? expireTime,
        newSessionExpiresAt: readNestedString(token, ['newSessionExpireTime']) ?? newSessionExpireTime
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw mapProviderError(error, 'Gemini live token creation failed');
    }
  }

  private async client(apiKey: string, apiVersion = 'v1'): Promise<GoogleGenAIClient> {
    const module = (await import('@google/genai')) as unknown as { GoogleGenAI: GoogleGenAIConstructor };
    return new module.GoogleGenAI({ apiKey, apiVersion });
  }
}

function actorGenerationConfig(input: ActorTurnInput): Record<string, unknown> {
  return {
    systemInstruction: ACTOR_SYSTEM_PROMPT,
    temperature: input.capsule.closureMode ? 0.65 : 0.85,
    maxOutputTokens: input.capsule.hardStop ? 650 : 1100
  };
}

function actorMetadata(input: {
  input: ActorTurnInput;
  prompt: string;
  contextHash: string;
  startedAt: string;
  usage: Record<string, unknown> | null;
}): ModelInvocationMetadata {
  return {
    provider: 'google-ai-studio',
    model: input.input.model,
    purpose: 'actor',
    promptVersion: ACTOR_PROMPT_VERSION,
    contextHash: input.contextHash,
    requestHash: sha256Text(input.prompt),
    usage: input.usage,
    startedAt: input.startedAt,
    completedAt: new Date().toISOString()
  };
}

function buildActorPrompt(input: ActorTurnInput): string {
  return JSON.stringify(
    {
      task: 'Continue the spoken interactive story from the current branch state.',
      user_transcript: input.userTranscript,
      default_style: input.style ?? undefined,
      closure_mode: input.capsule.closureMode,
      hard_stop: input.capsule.hardStop,
      remaining_turn_budget: input.capsule.remainingTurnBudget,
      context_capsule: input.capsule,
      output_contract:
        'Return only the words the narrator/NPCs should speak. No markdown heading. No meta commentary before the first in-world sentence.'
    },
    null,
    2
  );
}

function buildCanonizerPrompt(input: CanonizeTurnInput): string {
  return JSON.stringify(
    {
      task: 'Extract canon events, facts, thread updates, and continuity warnings from the completed turn.',
      turnId: input.turnId,
      priorState: input.priorState,
      userTranscript: input.userTranscript,
      assistantTranscript: input.assistantTranscript,
      output_contract: 'Return only valid JSON. Do not include markdown fences.',
      promptVersion: CANONIZER_PROMPT_VERSION
    },
    null,
    2
  );
}

function readText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const value = (response as { text?: unknown }).text;
  if (typeof value === 'string') return value;
  if (typeof value === 'function') return String(value.call(response));

  const candidates = (response as { candidates?: unknown }).candidates;
  if (Array.isArray(candidates)) {
    return candidates
      .flatMap(candidate => {
        const parts = (candidate as { content?: { parts?: Array<{ text?: string }> } }).content?.parts;
        return Array.isArray(parts) ? parts.map(part => part.text ?? '') : [];
      })
      .join('');
  }
  return '';
}

function readUsage(response: unknown): Record<string, unknown> | null {
  if (!response || typeof response !== 'object') return null;
  const usage = (response as { usageMetadata?: unknown }).usageMetadata;
  return usage && typeof usage === 'object' ? (usage as Record<string, unknown>) : null;
}

function readUsageOrEstimate(response: unknown, prompt: string, output: string): Record<string, unknown> {
  return usageWithEstimate(readUsage(response), prompt, output);
}

function usageWithEstimate(usage: Record<string, unknown> | null, prompt: string, output: string): Record<string, unknown> {
  if (usageHasTokenCounts(usage)) return usage;
  const promptTokenCount = Math.max(1, estimateTokensRoughly(prompt));
  const candidatesTokenCount = Math.max(1, estimateTokensRoughly(output));
  return {
    ...(usage ?? {}),
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount: promptTokenCount + candidatesTokenCount,
    estimated: true,
    estimateReason: 'missing_provider_usage_metadata'
  };
}

function usageHasTokenCounts(usage: Record<string, unknown> | null): usage is Record<string, unknown> {
  if (!usage) return false;
  return ['promptTokenCount', 'inputTokenCount', 'candidatesTokenCount', 'outputTokenCount', 'totalTokenCount']
    .some(key => Number.isFinite(Number(usage[key])) && Number(usage[key]) > 0);
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const direct = tryParseObject(trimmed);
  if (direct) return direct;

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const recovered = tryParseObject(objectMatch[0]);
    if (recovered) return recovered;
  }

  throw new ProviderError('Gemini returned non-JSON canonizer output.', 'bad_response');
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  return null;
}

function fallbackPatch(turnId: string, assistantTranscript: string, warnings: StoryEventPatch['warnings']): StoryEventPatch {
  return {
    turnId,
    events: [
      {
        eventType: 'OTHER',
        summary: assistantTranscript.slice(0, 500) || 'A story turn occurred.',
        participants: ['player'],
        certainty: 'canon',
        metadata: { fallback: true }
      }
    ],
    facts: [],
    threads: [],
    warnings
  };
}

function mapProviderError(error: unknown, fallbackMessage: string): ProviderError {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const lower = message.toLowerCase();
  if (lower.includes('api key') || lower.includes('permission') || lower.includes('unauthorized') || lower.includes('401')) {
    return new ProviderError(message, 'unauthorized', error);
  }
  if (lower.includes('quota') || lower.includes('rate') || lower.includes('429')) {
    return new ProviderError(message, 'rate_limited', error);
  }
  if (lower.includes('json') || lower.includes('schema')) {
    return new ProviderError(message, 'bad_response', error);
  }
  return new ProviderError(message || fallbackMessage, 'unavailable', error);
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function elapsedMs(startedAtIso: string): number {
  return Date.now() - new Date(startedAtIso).getTime();
}
