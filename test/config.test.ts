import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('production config rejects unsafe public defaults', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        ARIADNE_STORAGE: 'memory',
        CORS_ORIGINS: '*',
        ARIADNE_ALLOW_MOCK_PROVIDER: 'true',
        ARIADNE_PAID_USAGE_ENABLED: 'false',
        ARIADNE_FIREBASE_AUTH_REQUIRED: 'false'
      } as NodeJS.ProcessEnv),
    /ARIADNE_STORAGE=firestore.*CORS_ORIGINS=\*.*ARIADNE_ALLOW_MOCK_PROVIDER=true.*ARIADNE_PAID_USAGE_ENABLED=true.*ARIADNE_FIREBASE_AUTH_REQUIRED=true.*GEMINI_API_KEYS/
  );
});

test('production config accepts firestore plus strict CORS and server keys', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    ARIADNE_STORAGE: 'firestore',
    CORS_ORIGINS: 'https://app.example',
    GEMINI_API_KEYS: 'server-key-one'
  } as NodeJS.ProcessEnv);

  assert.equal(config.storage, 'firestore');
  assert.deepEqual(config.corsOrigins, ['https://app.example']);
  assert.equal(config.allowMockProvider, false);
  assert.equal(config.paidUsageEnabled, true);
  assert.equal(config.firebaseAuthRequired, true);
});
