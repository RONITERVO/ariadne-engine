import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTextUsageCharge, DEFAULT_MODEL_CATALOG } from '../src/billing/modelCatalog.js';
import type { ModelInvocationMetadata } from '../src/domain/types.js';

test('text usage charge bills estimated token metadata', () => {
  const metadata: ModelInvocationMetadata[] = [
    {
      provider: 'google-ai-studio',
      model: 'gemini-flash-lite-latest',
      purpose: 'canonizer',
      usage: {
        promptTokenCount: 1000,
        candidatesTokenCount: 500,
        estimated: true,
        estimateReason: 'missing_provider_usage_metadata'
      },
      startedAt: '2026-06-16T00:00:00.000Z',
      completedAt: '2026-06-16T00:00:01.000Z'
    }
  ];

  const charge = calculateTextUsageCharge(DEFAULT_MODEL_CATALOG, metadata);

  assert.deepEqual(charge.lineItems, [
    {
      model: 'gemini-flash-lite-latest',
      purpose: 'canonizer',
      inputTokens: 1000,
      outputTokens: 500,
      creditMicros: 300
    }
  ]);
  assert.equal(charge.creditMicros, 300);
});
