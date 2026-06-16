import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { StoryService } from '../src/application/storyService.js';
import type {
  ActorTurnInput,
  ActorTurnResult,
  CanonizeTurnInput,
  CanonizeTurnResult,
  LiveTokenInput,
  LiveTokenResult,
  ProviderValidationResult,
  StoryReasoningProvider
} from '../src/adapters/storyProvider.js';
import { InMemoryStoryStore } from '../src/storage/inMemoryStoryStore.js';

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    ARIADNE_STORAGE: 'memory',
    ARIADNE_ALLOW_MOCK_PROVIDER: 'true',
    CORS_ORIGINS: 'http://localhost:5173',
    ARIADNE_BRANCH_TURN_LOCK_TTL_SECONDS: '30'
  } as NodeJS.ProcessEnv);
}

test('story service rejects overlapping turns before provider work', async () => {
  const store = new InMemoryStoryStore();
  const service = new StoryService(store, testConfig());
  const { repo, branch } = await store.createRepo({ title: 'Concurrent story' });
  const provider = new BlockingProvider();

  const first = service.continueStory({
    repoId: repo.id,
    branchId: branch.id,
    providerKey: 'mock-local-dev-key',
    provider,
    userTranscript: 'First turn.'
  });
  await provider.actorStarted;

  await assert.rejects(
    () =>
      service.continueStory({
        repoId: repo.id,
        branchId: branch.id,
        providerKey: 'mock-local-dev-key',
        provider,
        userTranscript: 'Overlapping turn.'
      }),
    /story turn in progress/
  );
  assert.equal(provider.actorCalls, 1);

  provider.resolveActor('The first turn completes.');
  const result = await first;
  assert.equal(result.assistantTranscript, 'The first turn completes.');

  await assert.rejects(
    () =>
      service.commitLiveTurn({
        repoId: repo.id,
        branchId: branch.id,
        providerKey: 'mock-local-dev-key',
        provider,
        expectedHeadTurnId: null,
        userTranscript: 'Stale live user transcript.',
        assistantTranscript: 'Stale live assistant transcript.'
      }),
    /branch head moved since this turn started/
  );
});

class BlockingProvider implements StoryReasoningProvider {
  readonly name = 'mock';
  actorCalls = 0;
  readonly actorStarted: Promise<void>;
  private markActorStarted!: () => void;
  private finishActor?: (result: ActorTurnResult) => void;

  constructor() {
    this.actorStarted = new Promise(resolve => {
      this.markActorStarted = resolve;
    });
  }

  async validateKey(_apiKey: string, model: string): Promise<ProviderValidationResult> {
    return { ok: true, provider: this.name, model };
  }

  async generateActorTurn(_input: ActorTurnInput): Promise<ActorTurnResult> {
    this.actorCalls += 1;
    this.markActorStarted();
    return new Promise(resolve => {
      this.finishActor = resolve;
    });
  }

  resolveActor(text: string): void {
    this.finishActor?.({
      text,
      metadata: {
        provider: this.name,
        model: 'mock-actor',
        purpose: 'actor'
      }
    });
  }

  async canonizeTurn(input: CanonizeTurnInput): Promise<CanonizeTurnResult> {
    return {
      patch: {
        turnId: input.turnId,
        events: [],
        facts: [],
        threads: [],
        warnings: []
      },
      metadata: {
        provider: this.name,
        model: 'mock-canonizer',
        purpose: 'canonizer'
      }
    };
  }

  async createLiveToken(input: LiveTokenInput): Promise<LiveTokenResult> {
    return {
      provider: this.name,
      token: 'mock-live-token',
      model: input.model,
      responseModalities: input.responseModalities
    };
  }
}
