import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStoryStore } from '../src/storage/inMemoryStoryStore.js';

test('in-memory store creates repos, commits turns, stores metadata, and forks from snapshots', async () => {
  const store = new InMemoryStoryStore();
  const { repo, branch, state } = await store.createRepo({ title: 'Test', defaultStyle: 'mythic', ownerUserId: 'user-123' });
  assert.equal(repo.title, 'Test');
  assert.equal(branch.name, 'main');
  assert.equal(branch.ownerUserId, 'user-123');
  assert.equal(state.branchId, branch.id);

  const turn = await store.commitTurn({
    repoId: repo.id,
    branchId: branch.id,
    expectedHeadTurnId: null,
    userTranscript: 'I open the door.',
    assistantTranscript: 'The door opens.',
    modelMetadata: [
      {
        provider: 'mock',
        model: 'mock-actor',
        purpose: 'actor',
        requestHash: 'actor-hash'
      }
    ]
  });
  assert.equal(turn.ownerUserId, 'user-123');

  await store.applyCanonPatch({
    repoId: repo.id,
    branchId: branch.id,
    turnId: turn.id,
    patch: { turnId: turn.id, events: [], facts: [], threads: [], warnings: [] },
    state: { ...state, headTurnId: turn.id },
    modelMetadata: [
      {
        provider: 'mock',
        model: 'mock-canonizer',
        purpose: 'canonizer',
        requestHash: 'canonizer-hash'
      }
    ]
  });

  const timeline = await store.getTimeline(branch.id);
  assert.equal(timeline[0].modelMetadata?.length, 2);
  assert.equal(timeline[0].modelMetadata?.[1]?.purpose, 'canonizer');

  const fork = await store.forkBranch({ repoId: repo.id, sourceTurnId: turn.id, name: 'darker-ending' });
  assert.equal(fork.branch.forkedFromTurnId, turn.id);
  assert.equal(fork.branch.ownerUserId, 'user-123');
  assert.equal(fork.state.headTurnId, turn.id);
});

test('in-memory store serializes branch mutations', async () => {
  const store = new InMemoryStoryStore();
  const { repo, branch, state } = await store.createRepo({ title: 'Locks' });

  const lease = await store.acquireBranchMutationLease({
    repoId: repo.id,
    branchId: branch.id,
    ttlMs: 30_000
  });
  await assert.rejects(
    () =>
      store.acquireBranchMutationLease({
        repoId: repo.id,
        branchId: branch.id,
        ttlMs: 30_000
      }),
    /story turn in progress/
  );
  await store.releaseBranchMutationLease(lease);

  const first = await store.commitTurn({
    repoId: repo.id,
    branchId: branch.id,
    expectedHeadTurnId: null,
    userTranscript: 'First.',
    assistantTranscript: 'First response.'
  });

  await assert.rejects(
    () =>
      store.commitTurn({
        repoId: repo.id,
        branchId: branch.id,
        expectedHeadTurnId: null,
        userTranscript: 'Stale.',
        assistantTranscript: 'Stale response.'
      }),
    /branch head moved/
  );

  const second = await store.commitTurn({
    repoId: repo.id,
    branchId: branch.id,
    expectedHeadTurnId: first.id,
    userTranscript: 'Second.',
    assistantTranscript: 'Second response.'
  });

  await assert.rejects(
    () =>
      store.applyCanonPatch({
        repoId: repo.id,
        branchId: branch.id,
        turnId: first.id,
        patch: { turnId: first.id, events: [], facts: [], threads: [], warnings: [] },
        state: { ...state, headTurnId: first.id }
      }),
    /no longer the branch head/
  );

  await store.applyCanonPatch({
    repoId: repo.id,
    branchId: branch.id,
    turnId: second.id,
    patch: { turnId: second.id, events: [], facts: [], threads: [], warnings: [] },
    state: { ...state, headTurnId: second.id }
  });
});

test('in-memory store verifies audio upload size before linking turn audio', async () => {
  const store = new InMemoryStoryStore();
  const { repo, branch } = await store.createRepo({ title: 'Audio Links', ownerUserId: 'user-123' });
  const turn = await store.commitTurn({
    repoId: repo.id,
    branchId: branch.id,
    expectedHeadTurnId: null,
    userTranscript: 'Record this turn.',
    assistantTranscript: 'The turn is ready for archive.'
  });

  await store.createAudioUploadIntent({
    uploadId: 'upload-1',
    repoId: repo.id,
    branchId: branch.id,
    turnId: turn.id,
    ownerUserId: 'user-123',
    role: 'user',
    storageProvider: 'gcs',
    storageUri: 'gs://audio/repo/user.webm',
    contentType: 'audio/webm;codecs=opus',
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    crc32c: 'AAAAAA==',
    codec: 'opus',
    container: 'webm',
    qualityProfile: 'voice-hifi',
    bitrateKbps: 96,
    channelCount: 1,
    sampleRate: 48000,
    durationMs: 250,
    byteLength: 12000,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });

  await assert.rejects(
    () =>
      store.completeAudioUploadIntent({
        repoId: repo.id,
        uploadId: 'upload-1',
        verification: {
          byteLength: 11999,
          contentType: 'audio/webm;codecs=opus',
          crc32c: 'AAAAAA=='
        }
      }),
    /byte length/
  );
  assert.equal((await store.listAudioAssets(repo.id)).length, 0);
  assert.equal((await store.getTimeline(branch.id))[0].userAudioAssetId, null);

  const asset = await store.completeAudioUploadIntent({
    repoId: repo.id,
    uploadId: 'upload-1',
    verification: {
      byteLength: 12000,
      contentType: 'audio/webm;codecs=opus',
      crc32c: 'AAAAAA==',
      generation: '1',
      metageneration: '1',
      etag: 'etag'
    }
  });

  assert.equal(asset.turnId, turn.id);
  assert.equal(asset.branchId, branch.id);
  const linkedTurn = (await store.getTimeline(branch.id))[0];
  assert.equal(linkedTurn.userAudioAssetId, asset.id);
  assert.ok(linkedTurn.updatedAt);
  const uploads = await store.listAudioUploadIntents(repo.id, branch.id);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].status, 'verified');
  assert.equal(uploads[0].audioAssetId, asset.id);
});

test('in-memory store rejects canon patches with mismatched repo ids', async () => {
  const store = new InMemoryStoryStore();
  const first = await store.createRepo({ title: 'First' });
  const second = await store.createRepo({ title: 'Second' });
  const turn = await store.commitTurn({
    repoId: first.repo.id,
    branchId: first.branch.id,
    expectedHeadTurnId: null,
    userTranscript: 'First.',
    assistantTranscript: 'First response.'
  });

  await assert.rejects(
    () =>
      store.applyCanonPatch({
        repoId: second.repo.id,
        branchId: first.branch.id,
        turnId: turn.id,
        patch: { turnId: turn.id, events: [], facts: [], threads: [], warnings: [] },
        state: { ...first.state, headTurnId: turn.id }
      }),
    /turn does not belong to repo/
  );
});
