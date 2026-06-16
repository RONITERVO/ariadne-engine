import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialWorldState } from '../src/domain/initialState.js';
import { reducePatch } from '../src/domain/reducer.js';

test('reducer applies movement, facts, threads, and presence deterministically', () => {
  const initial = createInitialWorldState('branch_1');
  const result = reducePatch(initial, {
    turnId: 'turn_1',
    events: [
      {
        eventType: 'PLAYER_MOVED',
        summary: 'The player entered the silver hall.',
        participants: ['player'],
        locationId: 'location:silver_hall',
        certainty: 'canon',
        metadata: { toLocationId: 'location:silver_hall', sceneSummary: 'The player stands in the silver hall.' }
      },
      {
        eventType: 'CHARACTER_APPEARED',
        summary: 'Mara appeared.',
        participants: ['character:mara'],
        certainty: 'canon'
      }
    ],
    facts: [
      { subjectId: 'character:mara', predicate: 'allegiance', value: 'Ash Court', certainty: 'canon', knownBy: ['player'] }
    ],
    threads: [
      { threadId: 'thread:mara_betrayal', status: 'open', summary: 'Decide whether Mara can be trusted.', priority: 5 }
    ],
    warnings: []
  });

  assert.equal(result.state.headTurnId, 'turn_1');
  assert.equal(result.state.scene.locationId, 'location:silver_hall');
  assert.equal(result.state.scene.summary, 'The player stands in the silver hall.');
  assert.ok(result.state.scene.presentEntityIds.includes('character:mara'));
  assert.equal(result.state.facts[0].subjectId, 'character:mara');
  assert.equal(result.state.threads[0].threadId, 'thread:mara_betrayal');
  assert.deepEqual(result.warnings, []);
});
