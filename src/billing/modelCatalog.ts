import type { ModelInvocationMetadata } from '../domain/types.js';

export type ModelCatalogKind = 'text' | 'live';

export interface ModelCatalogEntry {
  id: string;
  kind: ModelCatalogKind;
  inputCreditMicrosPerMillionTokens?: number;
  outputCreditMicrosPerMillionTokens?: number;
  liveBillableSeconds?: number;
  liveInputTokensPerSecond?: number;
  liveOutputTokensPerSecond?: number;
  liveInputCreditMicrosPerMillionTokens?: number;
  liveOutputCreditMicrosPerMillionTokens?: number;
}

export interface ModelCatalog {
  models: Record<string, ModelCatalogEntry>;
}

export interface UsageChargeLineItem {
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  creditMicros: number;
}

export interface UsageCharge {
  creditMicros: number;
  lineItems: UsageChargeLineItem[];
}

export interface LiveSessionCharge {
  model: string;
  billableSeconds: number;
  inputTokens: number;
  outputTokens: number;
  creditMicros: number;
}

const CREDIT_MICROS = 1_000_000;

export const DEFAULT_MODEL_CATALOG: ModelCatalog = {
  models: {
    'gemini-flash-lite-latest': {
      id: 'gemini-flash-lite-latest',
      kind: 'text',
      inputCreditMicrosPerMillionTokens: 100_000,
      outputCreditMicrosPerMillionTokens: 400_000
    },
    'gemini-3.1-flash-lite': {
      id: 'gemini-3.1-flash-lite',
      kind: 'text',
      inputCreditMicrosPerMillionTokens: 250_000,
      outputCreditMicrosPerMillionTokens: 1_500_000
    },
    'gemini-3.1-flash-live-preview': {
      id: 'gemini-3.1-flash-live-preview',
      kind: 'live',
      liveBillableSeconds: 30,
      liveInputTokensPerSecond: 25,
      liveOutputTokensPerSecond: 25,
      liveInputCreditMicrosPerMillionTokens: 250_000,
      liveOutputCreditMicrosPerMillionTokens: 1_500_000
    }
  }
};

export function loadModelCatalog(rawJson: string | undefined): ModelCatalog {
  if (!rawJson?.trim()) return DEFAULT_MODEL_CATALOG;

  const parsed = JSON.parse(rawJson) as unknown;
  const incoming = Array.isArray(parsed)
    ? Object.fromEntries(parsed.map(entry => [String((entry as { id?: unknown }).id ?? ''), entry]))
    : parsed && typeof parsed === 'object' && 'models' in parsed
      ? (parsed as { models?: unknown }).models
      : parsed;

  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new Error('ARIADNE_MODEL_CATALOG_JSON must be an object keyed by model id, or { "models": { ... } }.');
  }

  const models: Record<string, ModelCatalogEntry> = {};
  for (const [id, value] of Object.entries(incoming as Record<string, unknown>)) {
    if (!id.trim() || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const source = value as Partial<ModelCatalogEntry>;
    const kind = source.kind === 'live' ? 'live' : 'text';
    models[id] = {
      id,
      kind,
      inputCreditMicrosPerMillionTokens: readNonNegative(source.inputCreditMicrosPerMillionTokens),
      outputCreditMicrosPerMillionTokens: readNonNegative(source.outputCreditMicrosPerMillionTokens),
      liveBillableSeconds: readNonNegative(source.liveBillableSeconds),
      liveInputTokensPerSecond: readNonNegative(source.liveInputTokensPerSecond),
      liveOutputTokensPerSecond: readNonNegative(source.liveOutputTokensPerSecond),
      liveInputCreditMicrosPerMillionTokens: readNonNegative(source.liveInputCreditMicrosPerMillionTokens),
      liveOutputCreditMicrosPerMillionTokens: readNonNegative(source.liveOutputCreditMicrosPerMillionTokens)
    };
  }

  return { models: { ...DEFAULT_MODEL_CATALOG.models, ...models } };
}

export function requireCatalogModel(catalog: ModelCatalog, model: string, kind: ModelCatalogKind): ModelCatalogEntry {
  const entry = catalog.models[model];
  if (!entry) throw new Error(`Model ${model} is not present in the Ariadne model catalog.`);
  if (entry.kind !== kind) throw new Error(`Model ${model} is configured as ${entry.kind}, expected ${kind}.`);
  return entry;
}

export function calculateTextUsageCharge(catalog: ModelCatalog, metadata: ModelInvocationMetadata[]): UsageCharge {
  const lineItems = metadata
    .filter(item => item.purpose !== 'live-token')
    .map(item => calculateTextInvocationCharge(catalog, item))
    .filter((item): item is UsageChargeLineItem => Boolean(item));

  return {
    creditMicros: lineItems.reduce((sum, item) => sum + item.creditMicros, 0),
    lineItems
  };
}

export function calculateTextReservationCreditMicros(
  catalog: ModelCatalog,
  models: string[],
  inputTokens: number,
  outputTokens: number
): number {
  return models.reduce((sum, model) => {
    const entry = requireCatalogModel(catalog, model, 'text');
    return sum + calculateTokenCost(
      Math.max(0, inputTokens),
      Math.max(0, outputTokens),
      entry.inputCreditMicrosPerMillionTokens ?? 0,
      entry.outputCreditMicrosPerMillionTokens ?? 0
    );
  }, 0);
}

export function calculateLiveSessionCharge(catalog: ModelCatalog, model: string): LiveSessionCharge {
  const entry = requireCatalogModel(catalog, model, 'live');
  const billableSeconds = Math.max(1, Math.floor(entry.liveBillableSeconds ?? 30));
  const inputTokens = Math.ceil(billableSeconds * Math.max(0, entry.liveInputTokensPerSecond ?? 0));
  const outputTokens = Math.ceil(billableSeconds * Math.max(0, entry.liveOutputTokensPerSecond ?? 0));
  const creditMicros = calculateTokenCost(
    inputTokens,
    outputTokens,
    entry.liveInputCreditMicrosPerMillionTokens ?? entry.inputCreditMicrosPerMillionTokens ?? 0,
    entry.liveOutputCreditMicrosPerMillionTokens ?? entry.outputCreditMicrosPerMillionTokens ?? 0
  );

  return { model, billableSeconds, inputTokens, outputTokens, creditMicros };
}

function calculateTextInvocationCharge(catalog: ModelCatalog, metadata: ModelInvocationMetadata): UsageChargeLineItem | null {
  const entry = catalog.models[metadata.model];
  if (!entry || entry.kind !== 'text') return null;

  const usage = metadata.usage ?? {};
  const inputTokens = readUsageNumber(usage, ['promptTokenCount', 'inputTokenCount']);
  const outputTokens = readUsageNumber(usage, ['candidatesTokenCount', 'outputTokenCount'])
    || Math.max(0, readUsageNumber(usage, ['totalTokenCount']) - inputTokens);
  const creditMicros = calculateTokenCost(
    inputTokens,
    outputTokens,
    entry.inputCreditMicrosPerMillionTokens ?? 0,
    entry.outputCreditMicrosPerMillionTokens ?? 0
  );

  return {
    model: metadata.model,
    purpose: metadata.purpose,
    inputTokens,
    outputTokens,
    creditMicros
  };
}

function calculateTokenCost(
  inputTokens: number,
  outputTokens: number,
  inputMicrosPerMillion: number,
  outputMicrosPerMillion: number
): number {
  const micros = ((inputTokens * inputMicrosPerMillion) + (outputTokens * outputMicrosPerMillion)) / CREDIT_MICROS;
  return Math.max(0, Math.ceil(micros));
}

function readUsageNumber(usage: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = Number(usage[key]);
    if (Number.isFinite(value) && value > 0) return Math.floor(value);
  }
  return 0;
}

function readNonNegative(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}
