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
        CanonPatch
        ModelInvocation
        ContinuityWarning
      CurrentBranchState cache
      BranchMutationLock lease
  Billing entitlement
  Usage ledger
  Billing event ledger
```

## Firestore Collections

The production Firestore schema is user-rooted and repo-centered. Story data is owned by a user document first, then grouped under the repo so the admin dashboard can show one coherent tree. Small top-level lookup documents let API routes jump from public IDs to canonical paths without scanning collection groups.

```text
users/{uid}
users/{uid}/billingAccounts/default
users/{uid}/billingAccounts/default/storyTurns/{usageId}
users/{uid}/billingAccounts/default/liveSessions/{sessionId}
users/{uid}/billingAccounts/default/billingEvents/{eventId}
users/{uid}/storyRepos/{repoId}
users/{uid}/storyRepos/{repoId}/branches/{branchId}
users/{uid}/storyRepos/{repoId}/turns/{turnId}
users/{uid}/storyRepos/{repoId}/branchState/{branchId}
users/{uid}/storyRepos/{repoId}/mutationLocks/{branchId}
users/{uid}/storyRepos/{repoId}/stateSnapshots/{turnId}
users/{uid}/storyRepos/{repoId}/canonPatches/{patchId}
users/{uid}/storyRepos/{repoId}/continuityWarnings/{warningId}
users/{uid}/storyRepos/{repoId}/audioAssets/{assetId}
users/{uid}/storyRepos/{repoId}/audioUploads/{uploadId}
storyRepoIndex/{repoId}
storyBranchIndex/{branchId}
storyTurnIndex/{turnId}
billingEventIndex/{eventId}
```

Turns are repo-level commits rather than branch-owned documents. That is deliberate: once a branch forks, old turns can be ancestors of more than one branch, so the branch points at `headTurnId` and the timeline is reconstructed by following each turn's `parentTurnId`.

`branchState/{branchId}` is a cache of the current reduced world state for that branch. Older compiled snapshots live in `stateSnapshots/{turnId}`. They are caches/audit material, not the canonical history.

`mutationLocks/{branchId}` is a short-lived server-only lease. It prevents two requests from generating and applying turns to the same branch at the same time. The lock is not the source of truth; it is a concurrency guard around the immutable turn chain and branch head update.

`canonPatches/{patchId}` stores the structured canon patch that changed the state, and `continuityWarnings/{warningId}` stores warnings in a repo-level warning stream that is easy for admin tooling to scan.

`storyRepoIndex`, `storyBranchIndex`, and `storyTurnIndex` are lookup/index documents, not canon. They exist so API routes that receive only `repoId`, `branchId`, or `turnId` can jump to the canonical user-rooted path. They must be updated in the same transaction as the canonical write.

`billingAccounts/default` is the user credit entitlement. Its `storyTurns` and `liveSessions` subcollections are immutable-ish usage ledgers; `billingEvents` is the per-user billing event history. `billingEventIndex` is a global idempotency ledger for Stripe webhook events, so retries cannot grant credits twice.

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

Production audio is a two-document contract:

```text
audioUploads/{uploadId}   pending one-time GCS upload intent
audioAssets/{assetId}     verified durable audio manifest linked from turns
```

`audioUploads` records are server-issued tickets. They capture repo, branch, role, storage URI, content type, SHA-256, CRC32C, codec, container, sample rate, duration, byte length, owner, expiry, and status. The browser must upload to the signed URL with the exact returned headers, including the CRC32C `x-goog-hash` and `x-goog-if-generation-match: 0` precondition.

`audioAssets` records are written only after the API verifies the uploaded GCS object, including a server-streamed SHA-256 check against the upload intent. They store the original intent fields plus object verification metadata: GCS generation, metageneration, object CRC32C, MD5 when available, upload timestamp, and verification timestamp. Turns link to these manifests through `userAudioAssetId` and `assistantAudioAssetId`; raw audio bytes stay in the private GCS bucket.

Recommended future fields:

- transcript alignment reference
- playback derivative URI
- waveform/level summary
- retention class or legal-hold marker

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


## Reset Instead Of Migrate

The v2 schema is a clean break from the earlier flat collections. Because there are no real users yet, clear launch-test Firestore data before deploying this schema instead of trying to run a lossy migration. The repository includes `npm run admin:clear-firestore-data` as a dry run; use `node scripts/clear-firestore-data.mjs ariadne-engine-rt --yes` only when the team intentionally wants an empty production Firestore.
