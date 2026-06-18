# Product spec: Ariadne Engine 1.0

## One-sentence product

A no-UI voice roleplay engine where every story is a branchable, replayable, exportable timeline, with preserved transcript state and audio-asset manifests.

## 1.0 promise boundary

Ariadne 1.0 is the complete non-voice-control release. The product supports the story flows through the browser player, the `/map` Google Galaxy interface, and API controls. Voice-native branch commands are deliberately reserved for v1.1 so the 1.0 promise stays honest.

Implemented in 1.0:

- Branchable story repos and immutable turn commits.
- Visual branch checkout, fork, replay, compare, semantic rewind, export, delete, and canon inspection from `/map`.
- Gemini Live token flow and Live transcript commits.
- Context capsules, canonization, deterministic state reduction, and closure-budget tracking.
- User-data export/delete workflows.
- Server-issued GCS audio upload intents, CRC32C and server-side SHA-256 verification, pending/verified audio asset registration, and turn-level audio metadata links after verification.

Reserved for v1.1:

- Voice-native branch commands such as “fork here,” “show my branches,” and “take me back before the betrayal.”
- Transcript/audio timestamp alignment.
- Fully audible branch recaps and timeline audio replay.

## User experience

The default experience has a short setup gate: sign in for prepaid credits or paste a Gemini API key. After that, the browser shows only the realtime transcript.

1. User signs in or pastes a key.
2. Ariadne opens or creates a branch.
3. User speaks a line or action.
4. Local in-browser Whisper detects speech turn boundaries; it is not the transcript authority.
5. Gemini Live receives the user's audio and returns user transcript, model transcript, and model audio.
6. Ariadne commits the Live transcripts, canonizes the turn, and resumes listening. Audio preservation starts after that as a background asset pipeline: compressed per-turn user/model audio gets a pending signed upload intent, uploads to GCS, is verified for exact size, CRC32C, quality profile, and server-side SHA-256, then links the verified manifest back to the turn.
7. The user can open `/map` to navigate the story galaxy, search memory, fork timelines, replay branches, compare branches, export archives, or delete a story world.

## Story-control flows

### Story mode

The model stays in character and responds as narrator / NPCs / scene director.

### Library mode

The `/map` galaxy is the release library surface. It shows story worlds, branches, turns, scenes, entities, facts, and open threads as zoomable cosmic objects.

### Time-machine mode

The app searches transcripts and canon landmarks, finds a candidate past event, shows the matching turn/landmark, and offers a fork action. In 1.0 this is visual/API-driven. Voice confirmation is v1.1.

### Compare mode

The app can compare two branches from the same repo, show the common ancestor, unique turns, and scene/entity/fact/thread divergence.

### Closure mode

The app tracks context budget and can stop opening new arcs before the budget is exhausted. Closing narration itself remains a story-model behavior directed by the context capsule.

## Differentiators

### Branches are first-class

Each branch is a pointer to a turn commit. Forking does not copy the full transcript. It creates a new branch ref pointing at an existing turn.

### Memory is structured, not model hope

The AI proposes a patch. The deterministic state compiler applies only valid state changes. Future models can change without losing the story library because the event ledger and compiled state remain the source of truth.

### Audio has a release-safe storage contract

1.0 supports direct browser-to-GCS uploads through server-issued upload intents, one-time ticket completion through `/v1/audio-assets`, and turn-level `userAudioAssetId` / `assistantAudioAssetId` links. This is explicitly off the main interaction path: transcript commit/canonization is the gameplay path, while audio preservation and preprocessing are background work with pending upload intents and verified manifests. Ariadne stores only verified metadata, checksums, GCS URIs, object generation/metageneration, quality profile, codec/container data, and key references in Firestore; raw audio remains in the private bucket and is deleted when the repo is deleted.

### Export and deletion are product features

Users can download JSON archives, readable Markdown archives, and delete a story world. These controls matter because Ariadne stores private transcripts and branch state.

### Atlas is the moat surface

The `/map` release is not just a visualization. It is the product control plane for story memory: rewind, fork, checkout, replay, compare, canon inspection, export, and deletion.
