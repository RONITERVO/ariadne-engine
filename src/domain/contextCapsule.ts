import { normalizeContextBudgetMode, type ContextBudgetMode } from './contextBudget.js';
import type { WorldState, TurnCommit } from './types.js';

export interface ContextCapsule {
  branchId: string;
  headTurnId: string;
  scene: WorldState['scene'];
  hardFacts: string[];
  activeThreads: string[];
  recentTurns: Array<Pick<TurnCommit, 'userTranscript' | 'assistantTranscript' | 'turnIndex'>>;
  contextBudgetMode: ContextBudgetMode;
  remainingTurnBudget: number;
}

export function buildContextCapsule(state: WorldState, recentTurns: TurnCommit[]): ContextCapsule {
  return {
    branchId: state.branchId,
    headTurnId: state.headTurnId,
    scene: state.scene,
    hardFacts: state.facts
      .filter(f => f.certainty === 'canon')
      .map(f => `${f.subjectId}.${f.predicate} = ${JSON.stringify(f.value)}`),
    activeThreads: state.threads
      .filter(t => t.status === 'open' || t.status === 'advanced')
      .sort((a, b) => (b.priority ?? 3) - (a.priority ?? 3))
      .map(t => `${t.threadId}: ${t.summary}`),
    recentTurns: recentTurns.slice(-8).map(t => ({
      turnIndex: t.turnIndex,
      userTranscript: t.userTranscript,
      assistantTranscript: t.assistantTranscript
    })),
    contextBudgetMode: normalizeContextBudgetMode(state.contextBudget),
    remainingTurnBudget: state.contextBudget?.remainingTurnBudget ?? 12
  };
}
