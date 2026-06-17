import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { ACTION_TOKEN } from '../src/domain/actionTokens.js';
import { buildApp } from '../src/server/app.js';

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    ARIADNE_STORAGE: 'memory',
    ARIADNE_ALLOW_MOCK_PROVIDER: 'true',
    CORS_ORIGINS: 'http://localhost:5173'
  } as NodeJS.ProcessEnv);
}

test('server rejects provider keys on non-provider routes', async t => {
  const app = await buildApp(testConfig());
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/repos',
    headers: { 'x-ariadne-provider-key': 'mock-local-dev-key' },
    payload: { title: 'Should not accept a provider key here' }
  });

  assert.equal(response.statusCode, 400);
  const payload = response.json();
  assert.match(payload.error, /provider_key_unexpected/);
  assert.ok(payload.tokens.blockerTokens.includes(ACTION_TOKEN.PROVIDER_KEY_UNEXPECTED));
});

test('server rejects provider secrets in request bodies and query strings', async t => {
  const app = await buildApp(testConfig());
  t.after(() => app.close());

  const bodyResponse = await app.inject({
    method: 'POST',
    url: '/v1/repos',
    payload: { title: 'Bad body', apiKey: 'mock-local-dev-key' }
  });
  assert.equal(bodyResponse.statusCode, 400);
  assert.match(bodyResponse.json().message, /forbidden body secret field/);

  const queryResponse = await app.inject({ method: 'GET', url: '/health?apiKey=mock-local-dev-key' });
  assert.equal(queryResponse.statusCode, 400);
  assert.match(queryResponse.json().message, /forbidden query secret field/);
});

test('admin users route is not public', async t => {
  const app = await buildApp(testConfig());
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/v1/admin/users'
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, 'firebase_auth_required');
});



test('story map route exposes a player-facing graph without a migration', async t => {
  const app = await buildApp(testConfig());
  t.after(() => app.close());

  const created = await app.inject({
    method: 'POST',
    url: '/v1/repos',
    payload: { title: 'Atlas Test', defaultStyle: 'mythic atlas' }
  });
  assert.equal(created.statusCode, 201);

  const response = await app.inject({ method: 'GET', url: '/v1/story-map' });
  assert.equal(response.statusCode, 200);
  const payload = response.json() as {
    rootId: string;
    nodes: Array<{ kind: string; label: string }>;
    links: Array<{ kind: string }>;
    stats: { repos: number; branches: number; nodes: number; links: number };
    tokens: { action: string };
  };

  assert.equal(payload.tokens.action, 'story.get-map');
  assert.ok(payload.rootId);
  assert.ok(payload.nodes.some(node => node.kind === 'repo' && node.label === 'Atlas Test'));
  assert.ok(payload.nodes.some(node => node.kind === 'branch' && node.label === 'main'));
  assert.ok(payload.links.some(link => link.kind === 'contains'));
  assert.equal(payload.stats.repos, 1);
  assert.equal(payload.stats.branches, 1);
  assert.ok(payload.stats.nodes >= 3);
  assert.ok(payload.stats.links >= 2);
});

test('streaming story route emits realtime deltas and final canonized state', async t => {
  const app = await buildApp(testConfig());
  t.after(() => app.close());

  const created = await app.inject({
    method: 'POST',
    url: '/v1/repos',
    payload: { title: 'Stream Test', defaultStyle: 'test style' }
  });
  assert.equal(created.statusCode, 201);
  const repo = created.json();

  const streamed = await app.inject({
    method: 'POST',
    url: '/v1/story/turn/stream',
    headers: { 'x-ariadne-provider-key': 'mock-local-dev-key' },
    payload: {
      repoId: repo.repo.id,
      branchId: repo.branch.id,
      expectedHeadTurnId: null,
      userTranscript: 'I test the stream.'
    }
  });

  assert.equal(streamed.statusCode, 200);
  assert.match(String(streamed.headers['content-type']), /application\/x-ndjson/);
  const events = streamed.body
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as { type: string; text?: string; assistantTranscript?: string; tokens?: { activeTokens?: string[] } });

  assert.ok(events.some(event => event.type === 'assistant_delta' && event.text));
  assert.ok(events.some(event => event.type === 'turn_committed'));
  assert.ok(events.some(event => event.type === 'canonized'));
  assert.ok(events.some(event => event.type === 'done' && event.assistantTranscript));
  const done = events.find(event => event.type === 'done');
  assert.ok(done?.tokens?.activeTokens?.includes(ACTION_TOKEN.PROVIDER_BYOK_KEY));
  assert.ok(done?.tokens?.activeTokens?.includes(ACTION_TOKEN.MUTATION_BRANCH_LEASE_ACQUIRED));
});

test('story turn routes require the prepared branch head', async t => {
  const app = await buildApp(testConfig());
  t.after(() => app.close());

  const created = await app.inject({
    method: 'POST',
    url: '/v1/repos',
    payload: { title: 'Expected Head Test' }
  });
  assert.equal(created.statusCode, 201);
  const repo = created.json();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/story/turn',
    headers: { 'x-ariadne-provider-key': 'mock-local-dev-key' },
    payload: {
      repoId: repo.repo.id,
      branchId: repo.branch.id,
      userTranscript: 'This should not run.'
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /validation_error/);
  assert.match(response.body, /expectedHeadTurnId/);
});
