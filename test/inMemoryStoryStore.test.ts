import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStoryStore } from '../src/storage/inMemoryStoryStore.js';

test('in-memory store creates repos, commits turns, stores metadata, and forks from snapshots', async () => {
  const store = new InMemoryStoryStore();
  const { repo, branch, state } = await store.createRepo({ title: 'Test', defaultStyle: 'mythic' });
  assert.equal(repo.title, 'Test');
  assert.equal(branch.name, 'main');
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
