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
    /ARIADNE_STORAGE=firestore.*CORS_ORIGINS=\*.*ARIADNE_ALLOW_MOCK_PROVIDER=true.*ARIADNE_PAID_USAGE_ENABLED=true.*ARIADNE_FIREBASE_AUTH_REQUIRED=true.*GEMINI_API_KEYS.*APP_URL.*STRIPE_SECRET_KEY.*STRIPE_WEBHOOK_SECRET.*STRIPE_PRODUCT_ID/
  );
});

test('production config accepts firestore plus strict CORS, server keys, and Stripe config', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    ARIADNE_STORAGE: 'firestore',
    CORS_ORIGINS: 'https://app.example',
    GEMINI_API_KEYS: 'server-key-one',
    APP_URL: 'https://app.example',
    STRIPE_SECRET_KEY: 'sk_test_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
    STRIPE_PRODUCT_ID: 'prod_example'
  } as NodeJS.ProcessEnv);

  assert.equal(config.storage, 'firestore');
  assert.deepEqual(config.corsOrigins, ['https://app.example']);
  assert.equal(config.allowMockProvider, false);
  assert.equal(config.paidUsageEnabled, true);
  assert.equal(config.firebaseAuthRequired, true);
  assert.equal(config.billing.stripeProductId, 'prod_example');
});

test('production config rejects whitespace-only required secrets and URLs', () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        ARIADNE_STORAGE: 'firestore',
        CORS_ORIGINS: 'https://app.example',
        GEMINI_API_KEYS: 'server-key-one',
        APP_URL: ' ',
        STRIPE_SECRET_KEY: '\t',
        STRIPE_WEBHOOK_SECRET: '  ',
        STRIPE_PRODUCT_ID: '\n'
      } as NodeJS.ProcessEnv),
    /APP_URL.*STRIPE_SECRET_KEY.*STRIPE_WEBHOOK_SECRET.*STRIPE_PRODUCT_ID/
  );
});

test('config rejects removed storage modes', () => {
  assert.throws(
    () =>
      loadConfig({
        ARIADNE_STORAGE: 'postgres'
      } as NodeJS.ProcessEnv),
    /Invalid value "postgres".*memory, firestore/
  );
});
