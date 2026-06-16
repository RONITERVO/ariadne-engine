import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export const PROVIDER_KEY_HEADER = 'x-ariadne-provider-key';

const FORBIDDEN_BODY_SECRET_FIELDS = new Set([
  'apikey',
  'api_key',
  'providerkey',
  'provider_key',
  'geminiapikey',
  'gemini_api_key',
  'googleapikey',
  'google_api_key'
]);

const FORBIDDEN_QUERY_SECRET_FIELDS = new Set([...FORBIDDEN_BODY_SECRET_FIELDS, 'key', 'token', 'access_token']);

export class ProviderKeyError extends Error {
  constructor(message: string, public readonly code: 'missing' | 'invalid' | 'unexpected' = 'invalid') {
    super(message);
    this.name = 'ProviderKeyError';
  }
}

export function extractProviderKey(headers: IncomingHttpHeaders): string {
  const key = extractOptionalProviderKey(headers);
  if (!key) {
    throw new ProviderKeyError(
      `Missing provider API key. Send it in the ${PROVIDER_KEY_HEADER} header.`,
      'missing'
    );
  }
  return key;
}

export function hasExplicitProviderKeyHeader(headers: IncomingHttpHeaders): boolean {
  return Boolean(firstHeader(headers[PROVIDER_KEY_HEADER]));
}

export function extractOptionalProviderKey(headers: IncomingHttpHeaders): string | undefined {
  const headerValue = firstHeader(headers[PROVIDER_KEY_HEADER]);
  if (!headerValue) return undefined;
  assertProviderKeyShape(headerValue);
  return headerValue;
}

export function assertProviderKeyShape(key: string): void {
  if (key.length < 8 || key.length > 4096) {
    throw new ProviderKeyError('Provider key has an invalid length.');
  }
  if (key !== key.trim()) {
    throw new ProviderKeyError('Provider key must not include leading or trailing whitespace.');
  }
  if (/[\r\n\t\0]/.test(key)) {
    throw new ProviderKeyError('Provider key contains illegal control characters.');
  }
  if (/\s/.test(key)) {
    throw new ProviderKeyError('Provider key must not contain whitespace.');
  }
}

export function rejectProviderSecretsInQuery(query: unknown): void {
  const path = findForbiddenSecretField(query, '$', FORBIDDEN_QUERY_SECRET_FIELDS);
  if (path) {
    throw new ProviderKeyError(`Provider keys must be sent only in headers; forbidden query secret field at ${path}.`, 'unexpected');
  }
}

export function rejectProviderSecretsInBody(body: unknown): void {
  const path = findForbiddenSecretField(body, '$', FORBIDDEN_BODY_SECRET_FIELDS);
  if (path) {
    throw new ProviderKeyError(`Provider keys must be sent only in headers; forbidden body secret field at ${path}.`, 'unexpected');
  }
}

export function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function redactKey(key: string): string {
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function findForbiddenSecretField(value: unknown, path: string, forbiddenNames: Set<string>): string | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nested = findForbiddenSecretField(value[i], `${path}[${i}]`, forbiddenNames);
      if (nested) return nested;
    }
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenNames.has(normalizeFieldName(key))) return `${path}.${key}`;
    const nested = findForbiddenSecretField(nestedValue, `${path}.${key}`, forbiddenNames);
    if (nested) return nested;
  }
  return null;
}

function normalizeFieldName(key: string): string {
  return key.replace(/[\s-]/g, '').toLowerCase();
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
