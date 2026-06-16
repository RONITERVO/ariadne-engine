import { ACTOR_PROMPT_VERSION, CANONIZER_PROMPT_VERSION } from '../prompts.js';
import { canonicalJson, sha256Text } from '../domain/stateHash.js';
import type { StoryEventPatch } from '../domain/types.js';
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

export class MockStoryProvider implements StoryReasoningProvider {
  readonly name = 'mock' as const;

  async validateKey(apiKey: string, model: string): Promise<ProviderValidationResult> {
    return {
      ok: apiKey.startsWith('mock'),
      provider: this.name,
      model,
      message: apiKey.startsWith('mock') ? 'Mock provider enabled.' : 'Mock provider requires a key starting with mock.'
    };
  }

  async generateActorTurn(input: ActorTurnInput): Promise<ActorTurnResult> {
    const startedAt = new Date().toISOString();
    const closure = input.capsule.closureMode
      ? ' The loose threads begin drawing inward, as if the branch itself wants an ending.'
      : '';
    return {
      text: `The air answers before anyone else does: ${input.userTranscript} The world shifts around that choice, saving it like a mark cut into old wood.${closure} What do you do next?`,
      metadata: {
        provider: this.name,
        model: input.model,
        purpose: 'actor',
        promptVersion: ACTOR_PROMPT_VERSION,
        contextHash: sha256Text(canonicalJson(input.capsule)),
        requestHash: sha256Text(input.userTranscript),
        usage: { mock: true },
        startedAt,
        completedAt: new Date().toISOString()
      }
    };
  }

  async *generateActorTurnStream(input: ActorTurnInput): AsyncIterable<ActorTurnStreamEvent> {
    const result = await this.generateActorTurn(input);
    const chunks = result.text.match(/.{1,28}(?:\s|$)/g) ?? [result.text];
    for (const chunk of chunks) {
      yield { type: 'delta', text: chunk };
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    yield { type: 'complete', result };
  }

  async canonizeTurn(input: CanonizeTurnInput): Promise<CanonizeTurnResult> {
    const startedAt = new Date().toISOString();
    const patch: StoryEventPatch = {
      turnId: input.turnId,
      events: [
        {
          eventType: 'OTHER',
          summary: `The player acted: ${input.userTranscript}`.slice(0, 500),
          participants: ['player'],
          certainty: 'canon',
          metadata: { provider: 'mock' }
        }
      ],
      facts: [],
      threads: [
        {
          threadId: 'thread:opening_mystery',
          status: 'advanced',
          summary: 'The opening mystery continues to respond to the player\'s choices.',
          priority: 3
        }
      ],
      warnings: []
    };

    return {
      patch,
      metadata: {
        provider: this.name,
        model: input.model,
        purpose: 'canonizer',
        promptVersion: CANONIZER_PROMPT_VERSION,
        contextHash: sha256Text(canonicalJson(input.priorState)),
        requestHash: sha256Text(`${input.userTranscript}\n${input.assistantTranscript}`),
        usage: { mock: true },
        startedAt,
        completedAt: new Date().toISOString()
      }
    };
  }

  async createLiveToken(input: LiveTokenInput): Promise<LiveTokenResult> {
    return {
      provider: this.name,
      token: `mock-live-token-${Date.now()}`,
      model: input.model,
      responseModalities: input.responseModalities,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      newSessionExpiresAt: new Date(Date.now() + 60 * 1000).toISOString()
    };
  }
}
