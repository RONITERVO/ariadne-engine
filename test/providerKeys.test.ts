import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractProviderKey,
  keyFingerprint,
  ProviderKeyError,
  redactKey,
  rejectProviderSecretsInBody,
  rejectProviderSecretsInQuery
} from '../src/security/providerKeys.js';

test('extracts provider key from custom header', () => {
  assert.equal(extractProviderKey({ 'x-ariadne-provider-key': 'mock-local-dev-key' }), 'mock-local-dev-key');
});

test('extracts provider key from bearer auth', () => {
  assert.equal(extractProviderKey({ authorization: 'Bearer mock-local-dev-key' }), 'mock-local-dev-key');
});

test('rejects missing provider key', () => {
  assert.throws(() => extractProviderKey({}), ProviderKeyError);
});

test('rejects provider keys with whitespace', () => {
  assert.throws(() => extractProviderKey({ 'x-ariadne-provider-key': ' mock-local-dev-key' }), ProviderKeyError);
  assert.throws(() => extractProviderKey({ authorization: 'Bearer mock-local-dev-key ' }), ProviderKeyError);
});

test('rejects provider secrets outside headers', () => {
  assert.throws(() => rejectProviderSecretsInBody({ apiKey: 'mock-local-dev-key' }), ProviderKeyError);
  assert.throws(() => rejectProviderSecretsInBody({ nested: { provider_key: 'mock-local-dev-key' } }), ProviderKeyError);
  assert.throws(() => rejectProviderSecretsInQuery({ key: 'mock-local-dev-key' }), ProviderKeyError);
});

test('fingerprint and redaction do not expose full key', () => {
  const key = 'mock-local-dev-key';
  assert.equal(keyFingerprint(key).length, 16);
  assert.equal(redactKey(key), 'mock…-key');
});
