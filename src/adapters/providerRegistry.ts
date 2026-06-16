import type { StoryReasoningProvider } from './storyProvider.js';
import { ProviderError } from './storyProvider.js';
import { GeminiStoryProvider } from './geminiProvider.js';
import { MockStoryProvider } from './mockProvider.js';

export class ProviderRegistry {
  private readonly gemini = new GeminiStoryProvider();
  private readonly mock = new MockStoryProvider();

  constructor(private readonly allowMockProvider: boolean) {}

  forApiKey(apiKey: string): StoryReasoningProvider {
    if (apiKey.startsWith('mock')) {
      if (!this.allowMockProvider) {
        throw new ProviderError('Mock provider is disabled for this deployment.', 'unauthorized');
      }
      return this.mock;
    }
    return this.gemini;
  }
}
