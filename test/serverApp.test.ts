import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { ACTION_TOKEN } from '../src/domain/actionTokens.js';
import type { RegisterAudioAssetInput } from '../src/domain/types.js';
import { buildApp } from '../src/server/app.js';
import type { AudioObjectStore, PreparedAudioUpload, PrepareAudioUploadInput } from '../src/storage/audioObjectStore.js';

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

test('audio upload URLs register verified GCS manifests and link live turns', async t => {
  const audioObjects = new FakeAudioObjectStore();
  const app = await buildApp(testConfig(), { audioObjects });
  t.after(() => app.close());

  const config = await app.inject({ method: 'GET', url: '/v1/config' });
  assert.equal(config.statusCode, 200);
  assert.equal(config.json().audioStorageEnabled, true);

  const created = await app.inject({
    method: 'POST',
    url: '/v1/repos',
    payload: { title: 'Audio Upload Test' }
  });
  assert.equal(created.statusCode, 201);
  const repo = created.json() as { repo: { id: string }; branch: { id: string } };

  const upload = await app.inject({
    method: 'POST',
    url: '/v1/audio-assets/upload-url',
    payload: {
      repoId: repo.repo.id,
      branchId: repo.branch.id,
      role: 'user',
      contentType: 'audio/wav',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      codec: 'pcm_s16le',
      container: 'wav',
      sampleRate: 48000,
      durationMs: 250,
      byteLength: 24000
    }
  });
  assert.equal(upload.statusCode, 201);
  const uploadPayload = upload.json() as { audioUpload: PreparedAudioUpload; tokens: { activeTokens: string[] } };
  assert.equal(uploadPayload.audioUpload.method, 'PUT');
  assert.equal(uploadPayload.audioUpload.asset.storageUri, `gs://fake-audio/${repo.repo.id}/user.wav`);
  assert.equal(uploadPayload.audioUpload.headers['content-type'], 'audio/wav');
  assert.ok(uploadPayload.tokens.activeTokens.includes(ACTION_TOKEN.AUDIO_UPLOAD_URL_CREATED));

  const registered = await app.inject({
    method: 'POST',
    url: '/v1/audio-assets',
    payload: uploadPayload.audioUpload.asset
  });
  assert.equal(registered.statusCode, 201);
  assert.equal(audioObjects.verified.length, 1);
  const audioAsset = (registered.json() as { audioAsset: { id: string; storageUri: string }; tokens: { activeTokens: string[] } }).audioAsset;
  assert.equal(audioAsset.storageUri, uploadPayload.audioUpload.asset.storageUri);

  const liveTurn = await app.inject({
    method: 'POST',
    url: '/v1/story/live-turn',
    headers: { 'x-ariadne-provider-key': 'mock-local-dev-key' },
    payload: {
      repoId: repo.repo.id,
      branchId: repo.branch.id,
      expectedHeadTurnId: null,
      userTranscript: 'Archive this user audio.',
      assistantTranscript: 'The audio is now part of the branch.',
      userAudioAssetId: audioAsset.id
    }
  });
  assert.equal(liveTurn.statusCode, 201);
  assert.equal((liveTurn.json() as { turn: { userAudioAssetId: string } }).turn.userAudioAssetId, audioAsset.id);
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

test('1.0 release routes support search, archive export, audio manifests, canon debug, compare, and deletion', async t => {
  const app = await buildApp(testConfig());
  t.after(() => app.close());

  const created = await app.inject({
    method: 'POST',
    url: '/v1/repos',
    payload: { title: 'Release 1.0 Test', defaultStyle: 'cinematic mystery' }
  });
  assert.equal(created.statusCode, 201);
  const repo = created.json() as { repo: { id: string }; branch: { id: string } };

  const audio = await app.inject({
    method: 'POST',
    url: '/v1/audio-assets',
    payload: {
      repoId: repo.repo.id,
      branchId: repo.branch.id,
      role: 'user',
      storageUri: 'gs://ariadne-test/release-1-user.webm',
      sha256: '0123456789abcdef0123456789abcdef',
      codec: 'opus',
      container: 'webm',
      sampleRate: 48000,
      durationMs: 1400,
      byteLength: 4096
    }
  });
  assert.equal(audio.statusCode, 201);
  assert.equal((audio.json() as { audioAsset: { repoId: string; branchId: string } }).audioAsset.branchId, repo.branch.id);

  const turn = await app.inject({
    method: 'POST',
    url: '/v1/story/turn',
    headers: { 'x-ariadne-provider-key': 'mock-local-dev-key' },
    payload: {
      repoId: repo.repo.id,
      branchId: repo.branch.id,
      expectedHeadTurnId: null,
      userTranscript: 'Before the betrayal at the inn, I hide the brass key under the black-glass stair.'
    }
  });
  assert.equal(turn.statusCode, 201);
  const turnPayload = turn.json() as { turn: { id: string; turnIndex: number } };
  assert.equal(turnPayload.turn.turnIndex, 1);

  const search = await app.inject({
    method: 'GET',
    url: `/v1/story-search?repoId=${encodeURIComponent(repo.repo.id)}&q=${encodeURIComponent('before betrayal at the inn')}`
  });
  assert.equal(search.statusCode, 200);
  const searchPayload = search.json() as { results: Array<{ label: string; turnId?: string; forkSourceTurnId?: string | null; rewindMode: string }> };
  assert.ok(searchPayload.results.length > 0);
  assert.ok(searchPayload.results.some(result => result.turnId === turnPayload.turn.id || result.forkSourceTurnId === turnPayload.turn.id));
  assert.ok(searchPayload.results.some(result => result.rewindMode === 'before'));

  const canon = await app.inject({ method: 'GET', url: `/v1/branches/${encodeURIComponent(repo.branch.id)}/canon` });
  assert.equal(canon.statusCode, 200);
  const canonPayload = canon.json() as { latestTurn: { id: string } | null; stats: { turns: number; audioAssets: number } };
  assert.equal(canonPayload.latestTurn?.id, turnPayload.turn.id);
  assert.equal(canonPayload.stats.turns, 1);
  assert.equal(canonPayload.stats.audioAssets, 1);

  const forked = await app.inject({
    method: 'POST',
    url: '/v1/branches/fork',
    payload: { repoId: repo.repo.id, sourceTurnId: turnPayload.turn.id, name: 'what-if no betrayal' }
  });
  assert.equal(forked.statusCode, 201);
  const forkPayload = forked.json() as { branch: { id: string; headTurnId: string } };
  assert.equal(forkPayload.branch.headTurnId, turnPayload.turn.id);

  const compare = await app.inject({
    method: 'GET',
    url: `/v1/branches/compare?leftBranchId=${encodeURIComponent(repo.branch.id)}&rightBranchId=${encodeURIComponent(forkPayload.branch.id)}`
  });
  assert.equal(compare.statusCode, 200);
  const comparePayload = compare.json() as { repoId: string; commonAncestorTurnId: string | null; left: { totalTurns: number }; right: { totalTurns: number } };
  assert.equal(comparePayload.repoId, repo.repo.id);
  assert.equal(comparePayload.commonAncestorTurnId, turnPayload.turn.id);
  assert.equal(comparePayload.left.totalTurns, 1);
  assert.equal(comparePayload.right.totalTurns, 1);

  const audioList = await app.inject({ method: 'GET', url: `/v1/repos/${encodeURIComponent(repo.repo.id)}/audio-assets` });
  assert.equal(audioList.statusCode, 200);
  assert.equal((audioList.json() as { audioAssets: unknown[] }).audioAssets.length, 1);

  const jsonExport = await app.inject({ method: 'GET', url: `/v1/repos/${encodeURIComponent(repo.repo.id)}/export` });
  assert.equal(jsonExport.statusCode, 200);
  assert.match(String(jsonExport.headers['content-disposition']), /ariadne-archive\.json/);
  const archivePayload = jsonExport.json() as { archive: { repo: { id: string }; branches: unknown[]; audioAssets: unknown[] } };
  assert.equal(archivePayload.archive.repo.id, repo.repo.id);
  assert.equal(archivePayload.archive.branches.length, 2);
  assert.equal(archivePayload.archive.audioAssets.length, 1);

  const markdownExport = await app.inject({ method: 'GET', url: `/v1/repos/${encodeURIComponent(repo.repo.id)}/export?format=markdown` });
  assert.equal(markdownExport.statusCode, 200);
  assert.match(String(markdownExport.headers['content-type']), /text\/markdown/);
  assert.match(markdownExport.body, /Release 1\.0 Test/);
  assert.match(markdownExport.body, /Before the betrayal at the inn/);

  const deleted = await app.inject({ method: 'DELETE', url: `/v1/repos/${encodeURIComponent(repo.repo.id)}` });
  assert.equal(deleted.statusCode, 200);
  assert.equal((deleted.json() as { deletedRepoId: string }).deletedRepoId, repo.repo.id);

  const afterDelete = await app.inject({ method: 'GET', url: `/v1/repos/${encodeURIComponent(repo.repo.id)}` });
  assert.equal(afterDelete.statusCode, 404);
});

class FakeAudioObjectStore implements AudioObjectStore {
  readonly verified: RegisterAudioAssetInput[] = [];

  isEnabled(): boolean {
    return true;
  }

  async prepareUpload(input: PrepareAudioUploadInput): Promise<PreparedAudioUpload> {
    const storageUri = `gs://fake-audio/${input.repoId}/${input.role}.${input.container}`;
    return {
      method: 'PUT',
      uploadUrl: `https://storage.example/upload/${input.repoId}/${input.role}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      maxBytes: 10 * 1024 * 1024,
      headers: {
        'content-type': input.contentType,
        'x-goog-meta-ariadne-repo-id': input.repoId,
        'x-goog-meta-ariadne-branch-id': input.branchId ?? '',
        'x-goog-meta-ariadne-role': input.role,
        'x-goog-meta-ariadne-sha256': input.sha256,
        'x-goog-meta-ariadne-codec': input.codec,
        'x-goog-meta-ariadne-container': input.container
      },
      asset: {
        repoId: input.repoId,
        branchId: input.branchId ?? null,
        role: input.role,
        storageUri,
        sha256: input.sha256,
        codec: input.codec,
        container: input.container,
        sampleRate: input.sampleRate,
        durationMs: input.durationMs,
        byteLength: input.byteLength,
        encryptionKeyRef: null
      }
    };
  }

  async verifyUploadedAsset(input: RegisterAudioAssetInput): Promise<void> {
    this.verified.push(input);
  }
}
