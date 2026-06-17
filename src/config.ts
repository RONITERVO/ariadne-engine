import { DEFAULT_MODEL_BUDGET, type ModelBudgetConfig } from './domain/contextBudget.js';
import { parseSecretList, type GeminiKeyPoolConfig } from './billing/geminiKeyPool.js';
import {
  calculateTextReservationCreditMicros,
  loadModelCatalog,
  requireCatalogModel,
  type ModelCatalog
} from './billing/modelCatalog.js';
import type { BillingConfig } from './billing/usageBilling.js';

export interface AudioStorageConfig {
  gcsBucket?: string;
  objectPrefix: string;
  signedUrlTtlSeconds: number;
  maxBytes: number;
}

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
  branchTurnLockTtlMs: number;
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
  adminEmails: string[];
  audioStorage: AudioStorageConfig;
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
    appUrl: readOptionalTrimmed(env.APP_URL),
    stripeSecretKey: readOptionalTrimmed(env.STRIPE_SECRET_KEY),
    stripeWebhookSecret: readOptionalTrimmed(env.STRIPE_WEBHOOK_SECRET),
    stripeProductId: readOptionalTrimmed(env.STRIPE_PRODUCT_ID),
    minCheckoutAmountCents: readInt(env.ARIADNE_MIN_CHECKOUT_AMOUNT_CENTS, 500, { min: 50, max: 1_000_000 }),
    defaultCheckoutAmountCents: readInt(env.ARIADNE_DEFAULT_CHECKOUT_AMOUNT_CENTS, 1_000, { min: 50, max: 1_000_000 }),
    liveSessionTtlSeconds: readInt(env.ARIADNE_LIVE_SESSION_TTL_SECONDS, 75, { min: 30, max: 600 })
  };
  const adminEmails = parseStringList(env.ARIADNE_ADMIN_EMAILS).map(email => email.toLowerCase());
  const audioStorage: AudioStorageConfig = {
    gcsBucket: readOptionalTrimmed(env.ARIADNE_AUDIO_GCS_BUCKET),
    objectPrefix: normalizeObjectPrefix(env.ARIADNE_AUDIO_GCS_PREFIX ?? 'audio'),
    signedUrlTtlSeconds: readInt(env.ARIADNE_AUDIO_UPLOAD_URL_TTL_SECONDS, 15 * 60, { min: 60, max: 60 * 60 }),
    maxBytes: readInt(env.ARIADNE_AUDIO_MAX_BYTES, 100 * 1024 * 1024, { min: 1024, max: 10 * 1024 * 1024 * 1024 })
  };

  if (appEnv === 'production') {
    assertProductionSafe({
      storage,
      corsOrigins,
      allowMockProvider,
      paidUsageEnabled,
      firebaseAuthRequired,
      geminiServerKeys,
      appUrl: billing.appUrl,
      stripeSecretKey: billing.stripeSecretKey,
      stripeWebhookSecret: billing.stripeWebhookSecret,
      stripeProductId: billing.stripeProductId,
      audioGcsBucket: audioStorage.gcsBucket
    });
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
    branchTurnLockTtlMs: readInt(env.ARIADNE_BRANCH_TURN_LOCK_TTL_SECONDS, 300, { min: 10, max: 900 }) * 1000,
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
    billing,
    adminEmails,
    audioStorage
  };
}

function assertProductionSafe(input: {
  storage: 'memory' | 'firestore';
  corsOrigins: string[] | true;
  allowMockProvider: boolean;
  paidUsageEnabled: boolean;
  firebaseAuthRequired: boolean;
  geminiServerKeys: string[];
  appUrl?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripeProductId?: string;
  audioGcsBucket?: string;
}): void {
  const errors: string[] = [];
  if (input.storage !== 'firestore') errors.push('ARIADNE_STORAGE=firestore is required in production');
  if (input.corsOrigins === true) errors.push('CORS_ORIGINS=* is not allowed in production');
  if (input.allowMockProvider) errors.push('ARIADNE_ALLOW_MOCK_PROVIDER=true is not allowed in production');
  if (!input.paidUsageEnabled) errors.push('ARIADNE_PAID_USAGE_ENABLED=true is required in production');
  if (!input.firebaseAuthRequired) errors.push('ARIADNE_FIREBASE_AUTH_REQUIRED=true is required in production');
  if (!input.geminiServerKeys.length) errors.push('GEMINI_API_KEYS is required in production');
  if (!input.appUrl) errors.push('APP_URL is required in production');
  if (!input.stripeSecretKey) errors.push('STRIPE_SECRET_KEY is required in production');
  if (!input.stripeWebhookSecret) errors.push('STRIPE_WEBHOOK_SECRET is required in production');
  if (!input.stripeProductId) errors.push('STRIPE_PRODUCT_ID is required in production');
  if (!input.audioGcsBucket) errors.push('ARIADNE_AUDIO_GCS_BUCKET is required in production');
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
}

function normalizeObjectPrefix(value: string): string {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

function parseCorsOrigins(value: string): string[] | true {
  if (value.trim() === '*') return true;
  return parseStringList(value);
}

function parseStringList(value: string | undefined): string[] {
  if (!value) return [];
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

function readOptionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readEnum<const T extends readonly string[]>(value: string | undefined, allowed: T, fallback: T[number]): T[number] {
  if (!value) return fallback;
  if (!allowed.includes(value)) {
    throw new Error(`Invalid value "${value}". Expected one of: ${allowed.join(', ')}`);
  }
  return value as T[number];
}
