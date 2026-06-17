import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_ID,
  ACTION_TOKEN,
  evaluateActionGate
} from '../src/domain/actionTokens.js';

test('action gate can report multiple token blockers', () => {
  const decision = evaluateActionGate(
    ACTION_ID.STORY_TURN,
    [ACTION_TOKEN.AUTH_FIREBASE_REQUIRED],
    [
      {
        id: 'provider-execution',
        anyOf: [ACTION_TOKEN.PROVIDER_BYOK_KEY, ACTION_TOKEN.PROVIDER_PAID_SERVER_KEY],
        blockerToken: ACTION_TOKEN.PROVIDER_KEY_MISSING,
        message: 'A provider execution token is required.'
      },
      {
        id: 'story-target',
        allOf: [ACTION_TOKEN.STORY_REPO_FOUND, ACTION_TOKEN.STORY_BRANCH_FOUND],
        blockerToken: ACTION_TOKEN.STORY_REPO_MISSING,
        message: 'A valid story target is required.'
      }
    ]
  );

  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.blockerTokens, [
    ACTION_TOKEN.PROVIDER_KEY_MISSING,
    ACTION_TOKEN.STORY_REPO_MISSING
  ]);
  assert.deepEqual(decision.missingRequirements.map(requirement => requirement.id), [
    'provider-execution',
    'story-target'
  ]);
});
