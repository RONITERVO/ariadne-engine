import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_BUDGET_MODE, decideContextBudget } from '../src/domain/contextBudget.js';

const config = {
  contextWindowTokens: 1000,
  safeInputBudgetTokens: 800,
  closureTriggerRatio: 0.75,
  hardStopRatio: 0.9,
  targetEndingTurns: 12
};

test('context budget stays normal below closure trigger', () => {
  const decision = decideContextBudget(400, config);
  assert.equal(decision.mode, CONTEXT_BUDGET_MODE.STABLE);
  assert.equal(decision.remainingTurnBudget, 12);
});

test('context budget enters closure before hard stop', () => {
  const decision = decideContextBudget(640, config);
  assert.equal(decision.mode, CONTEXT_BUDGET_MODE.CLOSURE);
  assert.ok(decision.remainingTurnBudget < 12);
});

test('context budget detects hard stop', () => {
  const decision = decideContextBudget(760, config);
  assert.equal(decision.mode, CONTEXT_BUDGET_MODE.HARD_STOP);
});
