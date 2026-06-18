# Architecture

## Principle

Never make the LLM the database.

The model is a performer and interpreter. The event ledger is the authority. A branch state can be rebuilt from immutable turns and canon patches; snapshots are caches.

## Default release path

Ariadne ships with a Firebase paid path plus BYOK fallback:

```text
Transcript-only browser
  -> user signs in for credits or pastes Google AI Studio key
  -> local browser Whisper detects speech turn boundaries only
  -> Ariadne mints a locked Gemini Live token
  -> browser sends pre-roll/tail PCM to Gemini Live
  -> Gemini Live returns user/model transcripts and model audio
  -> browser persists per-turn audio through a signed GCS upload intent
  -> Ariadne verifies the object and commits the Live turn with audio asset links
  -> Ariadne calls canonizer
```

Paid usage uses server Gemini keys and Firestore credits. BYOK sends the user key only on provider-bearing requests and bypasses Ariadne billing.

```text
Firebase Hosting
  -> /v1/** rewrite to Cloud Run ariadne-api
  -> Firestore for user-rooted story DAGs, billing accounts, usage, and billing events
  -> Stripe webhook grants prepaid credits
```

## Components

### 1. Browser shell

The browser app is intentionally small. It collects Firebase sign-in or a BYOK key once, hides the setup gate, auto-creates or continues a repo/branch, and then shows only user/model/system transcript lines. A local in-browser Whisper worker is only a speech turn-boundary detector. Gemini Live is the transcript/audio source.

### 2. API gateway

Responsibilities:

- validate request bodies
- require provider key on provider-backed routes
- redact provider keys from logs
- enforce rate limits
- verify Firebase ID tokens for paid usage
- reserve/settle prepaid credits
- lease server Gemini keys
- build context capsules
- call model-provider adapters
- commit turns and compiled state

### 3. Provider adapters

Provider adapters implement:

```ts
interface StoryReasoningProvider {
  validateKey(apiKey: string, model: string): Promise<ProviderValidationResult>;
  generateActorTurn(input: ActorTurnInput): Promise<ActorTurnResult>;
  generateActorTurnStream?(input: ActorTurnInput): AsyncIterable<ActorTurnStreamEvent>;
  canonizeTurn(input: CanonizeTurnInput): Promise<CanonizeTurnResult>;
  createLiveToken(input: LiveTokenInput): Promise<LiveTokenResult>;
}
```

The included adapters are:

- `GeminiStoryProvider`: Google AI Studio / Gemini BYOK adapter.
- `MockStoryProvider`: development-only adapter for tests and demos.

### 4. Turn orchestrator

The `StoryService` coordinates each story turn:

1. Acquire a branch mutation lease so only one turn can mutate the branch at a time.
2. Load repo, branch, current state, and recent timeline.
3. Estimate context budget and set the budget mode token if needed.
4. Build a compact context capsule.
5. Ask the actor model for narration or stream actor deltas.
6. Commit the immutable turn only if the branch head is still the prepared head.
7. Ask the canonizer model for structured changes.
8. Apply the deterministic reducer only while the committed turn is still the branch head.
9. Save current state, warnings, and actor/canonizer invocation metadata.

### 5. Actor model

The actor model produces the spoken response. It receives only the current capsule and recent turns, not an unbounded transcript.

Rules:

- first line is in-world narration/dialogue/action
- canon facts are hard constraints
- user agency is protected
- closure mode resolves instead of expanding

### 6. Canonizer model

After a turn is committed, the canonizer extracts structured events, facts, thread updates, and warnings. Its JSON output is schema-validated before reducer application.

### 7. Reducer

The reducer is deterministic. It applies event patches to canonical state and tracks contradictions as warnings. This is the core reason Ariadne can survive provider/model changes.

### 8. Billing and key rotation

Paid usage is metered in credit micros. Gemini Live token issuance is fixed-billed as a 30 second session and Firestore enforces one active paid Live session per user. Normal model calls reserve credits before the call and settle from Gemini usage metadata.

The server key pool rotates configured `GEMINI_API_KEYS` by stable user hash, limits per-key concurrency and request windows, and cools keys down on auth, quota, or transient failures.

### 9. Stores

- `InMemoryStoryStore`: local development and tests.
- `FirestoreStoryStore`: Firebase production storage.

## Persistence model

```text
StoryRepo
  BranchRef -> TurnCommit
  TurnCommit
    parent_turn_id
    user_transcript
    assistant_transcript
    user_audio_asset_id
    assistant_audio_asset_id
    event_patch[]
    state_snapshot_id?
    model_invocation[]
```

The canonical world state is derived from committed event patches. Summaries, embeddings, and snapshots are caches. The event ledger is the truth. Raw audio is not part of the Firestore ledger; Firestore stores upload intents and verified manifests that point at private GCS objects.
