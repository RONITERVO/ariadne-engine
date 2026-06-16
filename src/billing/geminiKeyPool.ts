const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface GeminiKeyPoolConfig {
  maxConcurrency: number;
  requestsPerMinute: number;
  requestsPerDay: number;
  quotaCooldownMs: number;
  transientCooldownMs: number;
  authCooldownMs: number;
}

export interface GeminiKeyLease {
  apiKey: string;
  release(error?: unknown): void;
}

type GeminiKeyCooldownReason = '' | 'auth' | 'quota' | 'transient';

type GeminiKeyState = {
  apiKey: string;
  inFlight: number;
  requestTimestamps: number[];
  dayWindowStart: number;
  dayRequestCount: number;
  disabledUntil: number;
  disabledReason: GeminiKeyCooldownReason;
};

export class GeminiKeyPoolError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 503,
    public readonly code = 'gemini_capacity_unavailable',
    public readonly retryAfterSeconds = 1
  ) {
    super(message);
    this.name = 'GeminiKeyPoolError';
  }
}

export class GeminiServerKeyPool {
  private readonly keys: GeminiKeyState[];

  constructor(keys: string[], private readonly config: GeminiKeyPoolConfig) {
    const now = Date.now();
    this.keys = uniqueSecrets(keys).map(apiKey => ({
      apiKey,
      inFlight: 0,
      requestTimestamps: [],
      dayWindowStart: getWindowStart(now, DAY_MS),
      dayRequestCount: 0,
      disabledUntil: 0,
      disabledReason: ''
    }));
  }

  get size(): number {
    return this.keys.length;
  }

  assertConfigured(): void {
    if (!this.keys.length) {
      throw new GeminiKeyPoolError('Gemini server API keys are not configured.', 400, 'gemini_not_configured');
    }
  }

  lease(userIdentity: string): GeminiKeyLease {
    this.assertConfigured();

    const now = Date.now();
    const startIndex = stableHashInt(userIdentity) % this.keys.length;
    let bestRetryMs = Number.POSITIVE_INFINITY;

    for (let offset = 0; offset < this.keys.length; offset += 1) {
      const key = this.keys[(startIndex + offset) % this.keys.length];
      const retryMs = this.getUnavailableRetryMs(key, now);
      if (retryMs <= 0) return this.createLease(key, now);
      bestRetryMs = Math.min(bestRetryMs, retryMs);
    }

    throw this.makeNoCapacityError(bestRetryMs, now);
  }

  private createLease(key: GeminiKeyState, now: number): GeminiKeyLease {
    key.inFlight += 1;
    key.requestTimestamps.push(now);
    key.dayRequestCount += 1;

    let released = false;
    return {
      apiKey: key.apiKey,
      release: (error?: unknown) => {
        if (released) return;
        released = true;
        key.inFlight = Math.max(0, key.inFlight - 1);
        this.recordResult(key, error);
      }
    };
  }

  private pruneKey(key: GeminiKeyState, now: number): void {
    const minuteCutoff = now - MINUTE_MS;
    while (key.requestTimestamps.length && key.requestTimestamps[0] <= minuteCutoff) key.requestTimestamps.shift();

    const dayWindowStart = getWindowStart(now, DAY_MS);
    if (key.dayWindowStart !== dayWindowStart) {
      key.dayWindowStart = dayWindowStart;
      key.dayRequestCount = 0;
    }

    if (key.disabledUntil <= now && key.disabledReason) {
      key.disabledReason = '';
      key.disabledUntil = 0;
    }
  }

  private getUnavailableRetryMs(key: GeminiKeyState, now: number): number {
    this.pruneKey(key, now);

    const waits: number[] = [];
    if (key.disabledUntil > now) waits.push(key.disabledUntil - now);
    if (key.inFlight >= this.config.maxConcurrency) waits.push(1000);
    if (this.config.requestsPerMinute > 0 && key.requestTimestamps.length >= this.config.requestsPerMinute) {
      waits.push((key.requestTimestamps[0] + MINUTE_MS) - now);
    }
    if (this.config.requestsPerDay > 0 && key.dayRequestCount >= this.config.requestsPerDay) {
      waits.push((key.dayWindowStart + DAY_MS) - now);
    }

    return waits.length ? Math.max(1, ...waits) : 0;
  }

  private makeNoCapacityError(retryMs: number, now: number): GeminiKeyPoolError {
    const retryAfterSeconds = Math.max(1, Math.min(3600, Math.ceil((Number.isFinite(retryMs) ? retryMs : MINUTE_MS) / 1000)));
    const allDailyLimited = this.config.requestsPerDay > 0 && this.keys.every(key => key.dayRequestCount >= this.config.requestsPerDay);
    const allAuthDisabled = this.keys.every(key => {
      this.pruneKey(key, now);
      return key.disabledReason === 'auth' && key.disabledUntil > now;
    });
    const allQuotaDisabled = this.keys.every(key => key.disabledReason === 'quota' && key.disabledUntil > now);

    if (allAuthDisabled) {
      return new GeminiKeyPoolError(
        'Gemini server API keys are unavailable. Check server configuration.',
        503,
        'gemini_capacity_unavailable',
        retryAfterSeconds
      );
    }
    if (allQuotaDisabled || allDailyLimited) {
      return new GeminiKeyPoolError(
        'Gemini capacity has been reached. Try again later.',
        429,
        'gemini_capacity_unavailable',
        retryAfterSeconds
      );
    }
    return new GeminiKeyPoolError(
      'Gemini capacity is busy. Try again shortly.',
      429,
      'gemini_capacity_busy',
      retryAfterSeconds
    );
  }

  private recordResult(key: GeminiKeyState, error?: unknown): void {
    if (!error) return;

    const statusCode = readStatusCode(error);
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const now = Date.now();
    if (statusCode === 401 || statusCode === 403 || /api key|permission|forbidden|unauthorized|unauthenticated/.test(message)) {
      key.disabledUntil = Math.max(key.disabledUntil, now + this.config.authCooldownMs);
      key.disabledReason = 'auth';
    } else if (statusCode === 429 || /quota|daily limit|rate|resource[_\s-]?exhausted|too many/.test(message)) {
      key.disabledUntil = Math.max(key.disabledUntil, now + this.config.quotaCooldownMs);
      key.disabledReason = 'quota';
    } else if (statusCode >= 500 || /temporar|unavailable|timeout/.test(message)) {
      key.disabledUntil = Math.max(key.disabledUntil, now + this.config.transientCooldownMs);
      key.disabledReason = 'transient';
    }
  }
}

export function parseSecretList(value: string | undefined): string[] {
  const text = String(value || '').trim();
  if (!text) return [];

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(item => String(item || '').trim()).filter(Boolean);
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  return text
    .split(/[\s,;]+/g)
    .map(item => {
      const token = item.trim().replace(/^["']|["']$/g, '');
      const equalsIndex = token.indexOf('=');
      return equalsIndex > 0 ? token.slice(equalsIndex + 1).trim() : token;
    })
    .filter(Boolean);
}

function uniqueSecrets(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = fingerprintSecret(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fingerprintSecret(value: string): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function stableHashInt(value: string): number {
  const text = value || 'anonymous';
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getWindowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

function readStatusCode(error: unknown): number {
  if (error && typeof error === 'object') {
    const maybe = error as { statusCode?: unknown; status?: unknown };
    const status = Number(maybe.statusCode ?? maybe.status);
    if (Number.isFinite(status)) return status;
  }
  return 0;
}
