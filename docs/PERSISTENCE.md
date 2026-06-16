# Persistence Model

## Non-Negotiable Rule

Do not store only chat history. Store immutable turns, structured event patches, model metadata, and audio metadata.

## Data Hierarchy

```text
User
  StoryRepo
    BranchRef
      TurnCommit DAG
        AudioAsset
        TranscriptSpan
        EventPatch
        ModelInvocation
    Snapshot
    SemanticIndex
```

## Firestore Collections

The production store maps the hierarchy to Firestore collections:

```text
storyRepos/{repoId}
branches/{branchId}
turns/{turnId}
branchStates/{branchId}
branchSnapshots/{turnId}
eventPatches/{patchId}
continuityWarnings/{warningId}
branchMutationLocks/{branchId}
users/{uid}
entitlements/{uid}
usage/{uid}/storyTurns/{usageId}
usage/{uid}/liveSessions/{sessionId}
billingEvents/{eventId}
```

`branchStates/{branchId}` is a cache of the current reduced world state. The branch timeline remains recoverable by following `branches/{branchId}.headTurnId` through each turn's `parentTurnId`, so older turns remain reachable like a time machine after new turns move the branch head.

`branchMutationLocks/{branchId}` is a short-lived server-only lease. It prevents two requests from generating and applying turns to the same branch at the same time. The lock is not the source of truth; it is a concurrency guard around the immutable turn chain and branch head update.

## Branching

A branch is a named mutable ref pointing to a turn commit.

```text
main:          A -- B -- C
                    \
darker-ending:       D -- E
```

Forking from B creates a new branch ref whose head is B. The next committed turn creates D.

Commits are accepted only when the branch head still equals the head used to prepare the context capsule. Canon patches are accepted only for the current branch head. Those two checks keep stale model output from overwriting newer branch state.

## Why Event Sourcing

An append-only log gives you:

- replay
- branch/fork
- auditability
- repair after canonizer bugs
- provider/model changes
- re-indexing
- deterministic memory rebuilding

## Audio Storage

Audio assets are content-addressed:

```text
sha256:<hash>.opus
sha256:<hash>.wav
```

Recommended fields:

- codec
- container
- sample rate
- duration
- byte length
- sha256
- storage URI
- encryption key reference
- transcript alignment reference

## Transcript Storage

Store final transcript and optional timestamped spans.

This allows future features:

- jump to the exact spoken line
- branch by spoken phrase
- generate audiobooks from branches
- compare what was heard against what was saved

## Model Invocation Storage

Every AI call should store:

- provider
- model
- prompt version
- parameter hash
- context capsule hash
- request timestamp
- response timestamp
- token/audio usage if available
- tool calls
- safety/continuity flags

This makes branches reproducible and debuggable.
