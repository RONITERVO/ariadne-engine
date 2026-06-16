import { DEFAULT_MODEL_BUDGET, type ModelBudgetConfig } from './domain/contextBudget.js';
import { parseSecretList, type GeminiKeyPoolConfig } from './billing/geminiKeyPool.js';
import {
  calculateTextReservationCreditMicros,
  loadModelCatalog,
  requireCatalogModel,
  type ModelCatalog
} from './billing/modelCatalog.js';
import type { BillingConfig } from './billing/usageBilling.js';

export interface AppConfig {
  env: string;
  port: number;
  host: string;
  logLevel: string;
  corsOrigins: string[] | true;
  storage: 'memory' | 'firestore';
  allowMockProvider: boolean;
  defaultProvider: 'google-ai-studio';
  actorModel: string;
  canonizerModel: string;
  liveModel: string;
  defaultStoryTitle: string;
  defaultStoryStyle: string;
  webSpeechLanguage?: string;
  rateLimitMax: number;
  rateLimitWindow: string;
  maxTranscriptChars: number;
  bodyLimitBytes: number;
  budget: ModelBudgetConfig;
  modelCatalog: ModelCatalog;
  paidUsageEnabled: boolean;
  firebaseAuthRequired: boolean;
  geminiServerKeys: string[];
  geminiKeyPool: GeminiKeyPoolConfig;
  turnReservationCreditMicros: number;
  billing: BillingConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const storage = readEnum(env.ARIADNE_STORAGE, ['memory', 'firestore'] as const, 'memory');
  const appEnv = env.NODE_ENV ?? 'development';
  const corsOrigins = parseCorsOrigins(env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173');
  const allowMockProvider = readBool(env.ARIADNE_ALLOW_MOCK_PROVIDER, false);
  const modelCatalog = loadModelCatalog(env.ARIADNE_MODEL_CATALOG_JSON);
  const actorModel = env.ARIADNE_ACTOR_MODEL ?? 'gemini-flash-lite-latest';
  const canonizerModel = env.ARIADNE_CANONIZER_MODEL ?? actorModel;
  const liveModel = env.ARIADNE_LIVE_MODEL ?? 'gemini-3.1-flash-live-preview';
  requireCatalogModel(modelCatalog, actorModel, 'text');
  requireCatalogModel(modelCatalog, canonizerModel, 'text');
  requireCatalogModel(modelCatalog, liveModel, 'live');

  const turnReservationInputTokens = readInt(env.ARIADNE_TURN_RESERVE_INPUT_TOKENS, 32_000, { min: 1, max: 10_000_000 });
  const turnReservationOutputTokens = readInt(env.ARIADNE_TURN_RESERVE_OUTPUT_TOKENS, 4_000, { min: 1, max: 1_000_000 });
  const turnReservationCreditMicros = readInt(
    env.ARIADNE_TURN_RESERVE_CREDIT_MICROS,
    calculateTextReservationCreditMicros(modelCatalog, [actorModel, canonizerModel], turnReservationInputTokens, turnReservationOutputTokens),
    { min: 0 }
  );
  const geminiServerKeys = parseSecretList(env.GEMINI_API_KEYS ?? env.ARIADNE_GEMINI_API_KEYS);
  const paidUsageEnabled = readBool(env.ARIADNE_PAID_USAGE_ENABLED, appEnv === 'production' || geminiServerKeys.length > 0);
  const firebaseAuthRequired = readBool(env.ARIADNE_FIREBASE_AUTH_REQUIRED, paidUsageEnabled);
  const billing: BillingConfig = {
    enabled: paidUsageEnabled,
    currency: (env.BILLING_CURRENCY ?? 'usd').toLowerCase(),
    appUrl: env.APP_URL,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    minCheckoutAmountCents: readInt(env.ARIADNE_MIN_CHECKOUT_AMOUNT_CENTS, 500, { min: 50, max: 1_000_000 }),
    defaultCheckoutAmountCents: readInt(env.ARIADNE_DEFAULT_CHECKOUT_AMOUNT_CENTS, 1_000, { min: 50, max: 1_000_000 }),
    liveSessionTtlSeconds: readInt(env.ARIADNE_LIVE_SESSION_TTL_SECONDS, 75, { min: 30, max: 600 })
  };

  if (appEnv === 'production') {
    assertProductionSafe({ storage, corsOrigins, allowMockProvider, paidUsageEnabled, firebaseAuthRequired, geminiServerKeys });
  }

  return {
    env: appEnv,
    port: readInt(env.PORT, 3000, { min: 1, max: 65535 }),
    host: env.HOST ?? '0.0.0.0',
    logLevel: env.LOG_LEVEL ?? 'info',
    corsOrigins,
    storage,
    allowMockProvider,
    defaultProvider: 'google-ai-studio',
    actorModel,
    canonizerModel,
    liveModel,
    defaultStoryTitle: env.ARIADNE_DEFAULT_STORY_TITLE ?? 'Ariadne Voice Session',
    defaultStoryStyle:
      env.ARIADNE_DEFAULT_STORY_STYLE ??
      'voice-first interactive fiction: vivid, concise, emotionally responsive, no UI instructions',
    webSpeechLanguage: env.ARIADNE_WEB_SPEECH_LANGUAGE,
    rateLimitMax: readInt(env.ARIADNE_RATE_LIMIT_MAX, 120, { min: 1, max: 10_000 }),
    rateLimitWindow: env.ARIADNE_RATE_LIMIT_WINDOW ?? '1 minute',
    maxTranscriptChars: readInt(env.ARIADNE_MAX_TRANSCRIPT_CHARS, 12_000, { min: 1, max: 200_000 }),
    bodyLimitBytes: readInt(env.ARIADNE_BODY_LIMIT_BYTES, 2 * 1024 * 1024, { min: 1024, max: 25 * 1024 * 1024 }),
    budget: {
      ...DEFAULT_MODEL_BUDGET,
      contextWindowTokens: readInt(env.ARIADNE_CONTEXT_WINDOW_TOKENS, DEFAULT_MODEL_BUDGET.contextWindowTokens, { min: 1 }),
      safeInputBudgetTokens: readInt(env.ARIADNE_SAFE_INPUT_BUDGET_TOKENS, DEFAULT_MODEL_BUDGET.safeInputBudgetTokens, { min: 1 })
    },
    modelCatalog,
    paidUsageEnabled,
    firebaseAuthRequired,
    geminiServerKeys,
    geminiKeyPool: {
      maxConcurrency: readInt(env.GEMINI_KEY_MAX_CONCURRENCY, 1, { min: 1, max: 20 }),
      requestsPerMinute: readInt(env.GEMINI_KEY_REQUESTS_PER_MINUTE, 12, { min: 0, max: 1000 }),
      requestsPerDay: readInt(env.GEMINI_KEY_REQUESTS_PER_DAY, 0, { min: 0, max: 100_000 }),
      quotaCooldownMs: readInt(env.GEMINI_KEY_QUOTA_COOLDOWN_SECONDS, 75, { min: 5, max: 3600 }) * 1000,
      transientCooldownMs: readInt(env.GEMINI_KEY_TRANSIENT_COOLDOWN_SECONDS, 12, { min: 1, max: 600 }) * 1000,
      authCooldownMs: readInt(env.GEMINI_KEY_AUTH_COOLDOWN_SECONDS, 1800, { min: 60, max: 86_400 }) * 1000
    },
    turnReservationCreditMicros,
    billing
  };
}

function assertProductionSafe(input: {
  storage: 'memory' | 'firestore';
  corsOrigins: string[] | true;
  allowMockProvider: boolean;
  paidUsageEnabled: boolean;
  firebaseAuthRequired: boolean;
  geminiServerKeys: string[];
}): void {
  const errors: string[] = [];
  if (input.storage !== 'firestore') errors.push('ARIADNE_STORAGE=firestore is required in production');
  if (input.corsOrigins === true) errors.push('CORS_ORIGINS=* is not allowed in production');
  if (input.allowMockProvider) errors.push('ARIADNE_ALLOW_MOCK_PROVIDER=true is not allowed in production');
  if (!input.paidUsageEnabled) errors.push('ARIADNE_PAID_USAGE_ENABLED=true is required in production');
  if (!input.firebaseAuthRequired) errors.push('ARIADNE_FIREBASE_AUTH_REQUIRED=true is required in production');
  if (!input.geminiServerKeys.length) errors.push('GEMINI_API_KEYS is required in production');
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
}

function parseCorsOrigins(value: string): string[] | true {
  if (value.trim() === '*') return true;
  return value
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readInt(value: string | undefined, fallback: number, bounds: { min?: number; max?: number } = {}): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (bounds.min !== undefined && parsed < bounds.min) return fallback;
  if (bounds.max !== undefined && parsed > bounds.max) return fallback;
  return parsed;
}

function readEnum<const T extends readonly string[]>(value: string | undefined, allowed: T, fallback: T[number]): T[number] {
  if (!value) return fallback;
  if (!allowed.includes(value)) {
    throw new Error(`Invalid value "${value}". Expected one of: ${allowed.join(', ')}`);
  }
  return value as T[number];
}
