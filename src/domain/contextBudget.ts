export interface ModelBudgetConfig {
  contextWindowTokens: number;
  safeInputBudgetTokens: number;
  closureTriggerRatio: number;
  hardStopRatio: number;
  targetEndingTurns: number;
}

export interface BudgetDecision {
  estimatedTokens: number;
  safeBudgetTokens: number;
  closureMode: boolean;
  hardStop: boolean;
  remainingTurnBudget: number;
}

export const DEFAULT_MODEL_BUDGET: ModelBudgetConfig = {
  contextWindowTokens: 1_048_576,
  safeInputBudgetTokens: 900_000,
  closureTriggerRatio: 0.78,
  hardStopRatio: 0.9,
  targetEndingTurns: 12
};

export function decideContextBudget(
  estimatedTokens: number,
  config: ModelBudgetConfig = DEFAULT_MODEL_BUDGET
): BudgetDecision {
  if (!Number.isFinite(estimatedTokens) || estimatedTokens < 0) {
    throw new Error('estimatedTokens must be a non-negative finite number');
  }
  if (config.safeInputBudgetTokens <= 0) {
    throw new Error('safeInputBudgetTokens must be positive');
  }
  if (config.hardStopRatio <= config.closureTriggerRatio) {
    throw new Error('hardStopRatio must be greater than closureTriggerRatio');
  }

  const ratio = estimatedTokens / config.safeInputBudgetTokens;
  const closureMode = ratio >= config.closureTriggerRatio;
  const hardStop = ratio >= config.hardStopRatio;

  const remainingRatio = Math.max(0, 1 - ratio);
  const remainingTurnBudget = closureMode
    ? Math.max(
        2,
        Math.ceil(
          (config.targetEndingTurns * remainingRatio) /
            Math.max(0.01, 1 - config.closureTriggerRatio)
        )
      )
    : config.targetEndingTurns;

  return {
    estimatedTokens: Math.ceil(estimatedTokens),
    safeBudgetTokens: config.safeInputBudgetTokens,
    closureMode,
    hardStop,
    remainingTurnBudget
  };
}

export function estimateTokensRoughly(input: unknown): number {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  // Rough but stable enough for a budget governor; providers still enforce actual limits.
  return Math.ceil(text.length / 4);
}
