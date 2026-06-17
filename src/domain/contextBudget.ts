export interface ModelBudgetConfig {
  contextWindowTokens: number;
  safeInputBudgetTokens: number;
  closureTriggerRatio: number;
  hardStopRatio: number;
  targetEndingTurns: number;
}

export const CONTEXT_BUDGET_MODE = {
  STABLE: 'stable',
  CLOSURE: 'closure',
  HARD_STOP: 'hard-stop'
} as const;

export type ContextBudgetMode = typeof CONTEXT_BUDGET_MODE[keyof typeof CONTEXT_BUDGET_MODE];

export interface BudgetDecision {
  estimatedTokens: number;
  safeBudgetTokens: number;
  mode: ContextBudgetMode;
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
  const mode = contextBudgetModeFromRatio(ratio, config);

  const remainingRatio = Math.max(0, 1 - ratio);
  const remainingTurnBudget = isContextBudgetClosureMode(mode)
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
    mode,
    remainingTurnBudget
  };
}

export function contextBudgetModeFromRatio(ratio: number, config: ModelBudgetConfig = DEFAULT_MODEL_BUDGET): ContextBudgetMode {
  if (ratio >= config.hardStopRatio) return CONTEXT_BUDGET_MODE.HARD_STOP;
  if (ratio >= config.closureTriggerRatio) return CONTEXT_BUDGET_MODE.CLOSURE;
  return CONTEXT_BUDGET_MODE.STABLE;
}

export function isContextBudgetMode(value: unknown): value is ContextBudgetMode {
  return typeof value === 'string' && Object.values(CONTEXT_BUDGET_MODE).includes(value as ContextBudgetMode);
}

export function isContextBudgetClosureMode(mode: ContextBudgetMode): boolean {
  return mode === CONTEXT_BUDGET_MODE.CLOSURE || mode === CONTEXT_BUDGET_MODE.HARD_STOP;
}

export function isContextBudgetHardStop(mode: ContextBudgetMode): boolean {
  return mode === CONTEXT_BUDGET_MODE.HARD_STOP;
}

export function normalizeContextBudgetMode(input: unknown): ContextBudgetMode {
  if (!input || typeof input !== 'object') return CONTEXT_BUDGET_MODE.STABLE;
  const value = input as { mode?: unknown; hardStop?: unknown; closureMode?: unknown };
  if (isContextBudgetMode(value.mode)) return value.mode;
  if (value.hardStop === true) return CONTEXT_BUDGET_MODE.HARD_STOP;
  if (value.closureMode === true) return CONTEXT_BUDGET_MODE.CLOSURE;
  return CONTEXT_BUDGET_MODE.STABLE;
}

export function estimateTokensRoughly(input: unknown): number {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  // Rough but stable enough for a budget governor; providers still enforce actual limits.
  return Math.ceil(text.length / 4);
}
