# Memory engine

## Goal

Keep perfect track of events up to the limits of the available model context, while allowing arbitrarily long story libraries.

## Important distinction

Perfect tracking is not achieved by asking a model to remember. It is achieved by converting the story into structured state after every turn.

## Memory layers

### 1. Hot context

The most recent turns, verbatim. This preserves rhythm, emotion, and local continuity.

### 2. Scene capsule

A short, always-included description of the active situation:

- where we are
- who is present
- what is happening now
- immediate danger or goal
- current tone

### 3. Canon state

Structured facts:

- characters
- relationships
- inventory
- injuries
- powers
- secrets known by each character
- locations
- factions
- promises
- unresolved plot threads

### 4. Event ledger

Append-only history of meaningful changes:

- arrival
- departure
- discovery
- betrayal
- combat outcome
- promise made
- promise fulfilled
- item gained/lost
- secret revealed
- relationship changed

### 5. Semantic retrieval

Embeddings over turns, events, and summaries. Used for finding relevant old details, not for canon authority.

### 6. Snapshots

Compiled state at a turn. Used to avoid replaying the whole ledger every time.

## Context budget governor

Each model adapter declares:

```ts
contextWindowTokens: number;
safeInputBudgetTokens: number;
targetCapsuleTokens: number;
closureTriggerRatio: number; // e.g. 0.78
hardStopRatio: number;       // e.g. 0.90
```

When projected context crosses a threshold, the branch records a context budget mode: `stable`, `closure`, or `hard-stop`.

## Closure and hard-stop modes

When the mode is `closure` or `hard-stop`, the actor receives these constraints:

- do not introduce major new factions, villains, prophecies, or locations
- resolve one unresolved thread per turn when possible
- collapse side plots into consequences
- make character choices matter
- move toward an ending within the remaining turn budget
- preserve branch forkability after the ending

## Anti-hallucination strategy

1. The actor receives only canonical facts as hard facts.
2. The actor may invent flavor, but irreversible changes must be extractable as events.
3. The canonizer extracts proposed changes.
4. The reducer validates changes.
5. The auditor flags contradictions before the next turn.
6. If a contradiction slipped into speech, the next response repairs it diegetically when possible.
