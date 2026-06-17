# API

Provider-backed routes accept a user's BYOK provider key in this header:

```http
x-ariadne-provider-key: <GOOGLE_AI_STUDIO_API_KEY>
```

The key is used only for the current provider request. It is not persisted. Ariadne rejects provider-key-shaped fields in query strings and JSON bodies, and provider key headers are accepted only on provider routes plus story turn routes. In hosted paid mode, `Authorization: Bearer` is reserved for Firebase ID tokens.

## Browser shell, health, and config

### `GET /`

Serves the built transcript-only browser shell from `web/dist/index.html` when `npm run build:web` has been run. Assets are served from `/assets/*`.


### `GET /health`

Returns deployment metadata.

```json
{
  "ok": true,
  "name": "ariadne-engine",
  "version": "1.0.0",
  "storage": "memory",
  "provider": "google-ai-studio"
}
```

### `GET /v1/config`

Returns frontend-safe public configuration. It never returns provider keys or server secrets.

```json
{
  "defaultProvider": "google-ai-studio",
  "actorModel": "gemini-flash-lite-latest",
  "canonizerModel": "gemini-flash-lite-latest",
  "liveModel": "gemini-3.1-flash-live-preview",
  "defaultStoryTitle": "Ariadne Voice Session",
  "defaultStoryStyle": "voice-first interactive fiction...",
  "webSpeechLanguage": "en-US",
  "maxTranscriptChars": 12000,
  "paidUsageEnabled": true,
  "firebaseAuthRequired": true,
  "billingCurrency": "usd",
  "liveBillableSeconds": 30,
  "audioStorageEnabled": true,
  "audioMaxBytes": 52428800,
  "audioDefaultQualityProfile": "voice-hifi",
  "audioAllowedQualityProfiles": ["voice-balanced", "voice-hifi", "music-hifi", "aac-hifi"],
  "audioQualityProfiles": {
    "voice-hifi": {
      "codec": "opus",
      "targetBitrateKbps": 96,
      "maxBitrateKbps": 128,
      "maxSampleRate": 48000,
      "maxChannelCount": 1
    }
  }
}
```

## Provider

### `POST /v1/provider/gemini/validate-key`

Validates the supplied key with the configured actor model.

Request body:

```json
{}
```

Response:

```json
{
  "ok": true,
  "provider": "google-ai-studio",
  "model": "gemini-flash-lite-latest",
  "keyFingerprint": "sha256-prefix",
  "message": "Gemini API key accepted."
}
```

### `POST /v1/provider/gemini/live-token`

Creates a short-lived token for Gemini Live client-to-server WebSocket sessions.

Request:

```json
{
  "repoId": "...",
  "branchId": "...",
  "responseModalities": ["AUDIO"]
}
```

Response:

```json
{
  "provider": "google-ai-studio",
  "token": "auth-token-name",
  "model": "gemini-3.1-flash-live-preview",
  "responseModalities": ["AUDIO"],
  "branchHeadTurnId": null,
  "sessionId": "...",
  "billingMode": "paid",
  "expiresAt": "2026-06-15T12:30:00.000Z",
  "newSessionExpiresAt": "2026-06-15T12:01:00.000Z"
}
```

### `POST /v1/provider/gemini/live-session/end`

Clears the active paid Live session lock early. The fixed 30-second session charge is not refunded.

```json
{ "sessionId": "..." }
```

## Billing

Billing routes require a Firebase ID token:

```http
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### `GET /v1/billing/me`

Returns prepaid, used, reserved, and remaining credit micros.

### `POST /v1/billing/checkout-session`

Creates a Stripe Checkout session for Ariadne prepaid credits. Stripe promotion codes are enabled on the Checkout page.

```json
{ "amountCents": 1000 }
```

### `POST /v1/webhooks/stripe`

Stripe webhook route. It verifies the raw request body and grants credits idempotently for `payment_intent.succeeded`. Fully-discounted coupon checkouts can complete without a PaymentIntent, so `checkout.session.completed` also grants credits when the Checkout total is zero.

## Story repos

Repo and branch-management routes do **not** require or accept provider key headers.

### `GET /v1/repos`

Lists repos in the configured store.

### `POST /v1/repos`

Creates a repo and its `main` branch.

Request:

```json
{
  "title": "The Glass Forest",
  "description": "Optional description",
  "defaultStyle": "dark fairy-tale adventure",
  "safetyProfile": "general"
}
```

Response:

```json
{
  "repo": { "id": "...", "title": "The Glass Forest" },
  "branch": { "id": "...", "name": "main" },
  "state": { "branchId": "...", "headTurnId": "root" }
}
```

### `GET /v1/repos/:repoId`

Returns a repo and its branches.


### `GET /v1/repos/:repoId/export`

Exports the complete story world in a stable offline archive. The default format is JSON; `?format=markdown` returns a readable transcript and canon summary.

```bash
curl http://localhost:3000/v1/repos/REPO_ID/export
curl http://localhost:3000/v1/repos/REPO_ID/export?format=markdown
```

The JSON payload contains `schemaVersion`, `repo`, `branches`, timelines, compiled states, and audio manifests. The response also sets `Content-Disposition` so browsers download it as an archive file.

### `DELETE /v1/repos/:repoId`

Deletes the repo and its branches, turns, snapshots, branch locks, audio manifests, and, when GCS audio storage is enabled, objects under that repo's configured audio prefix.

```json
{ "ok": true, "deletedRepoId": "..." }
```

### `POST /v1/audio-assets/upload-url`

Creates a short-lived, server-issued GCS upload intent and a signed `PUT` URL for one preserved audio object. The browser computes SHA-256 and CRC32C before calling this route, uploads the bytes directly to GCS using **all** returned headers, then completes the ticket through `POST /v1/audio-assets`.

Production defaults are cost-managed. Uncompressed WAV/PCM is rejected by the GCS upload policy; clients should upload Opus WebM/Ogg or AAC MP4 using an allowed quality profile. The default `voice-hifi` profile targets 96 kbps Opus mono and allows up to 128 kbps plus mux overhead.

```json
{
  "repoId": "...",
  "branchId": "...",
  "role": "user",
  "contentType": "audio/webm;codecs=opus",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "crc32c": "AAAAAA==",
  "codec": "opus",
  "container": "webm",
  "qualityProfile": "voice-hifi",
  "bitrateKbps": 96,
  "channelCount": 1,
  "sampleRate": 48000,
  "durationMs": 1800,
  "byteLength": 24000
}
```

Response:

```json
{
  "audioUpload": {
    "method": "PUT",
    "uploadUrl": "https://storage.googleapis.com/...",
    "uploadId": "server-issued-one-time-ticket",
    "expiresAt": "2026-06-17T12:15:00.000Z",
    "maxBytes": 50944,
    "qualityPolicy": {
      "profile": "voice-hifi",
      "codec": "opus",
      "targetBitrateKbps": 96,
      "maxBitrateKbps": 128,
      "maxSampleRate": 48000,
      "maxChannelCount": 1
    },
    "headers": {
      "content-type": "audio/webm;codecs=opus",
      "cache-control": "private, max-age=31536000, immutable",
      "x-goog-content-length-range": "24000,24000",
      "x-goog-if-generation-match": "0",
      "x-goog-hash": "crc32c=AAAAAA==",
      "x-goog-meta-ariadne-upload-id": "server-issued-one-time-ticket",
      "x-goog-meta-ariadne-repo-id": "...",
      "x-goog-meta-ariadne-branch-id": "...",
      "x-goog-meta-ariadne-role": "user",
      "x-goog-meta-ariadne-content-type": "audio/webm;codecs=opus",
      "x-goog-meta-ariadne-sha256": "...",
      "x-goog-meta-ariadne-crc32c": "AAAAAA==",
      "x-goog-meta-ariadne-codec": "opus",
      "x-goog-meta-ariadne-container": "webm",
      "x-goog-meta-ariadne-quality-profile": "voice-hifi",
      "x-goog-meta-ariadne-bitrate-kbps": "96",
      "x-goog-meta-ariadne-channel-count": "1",
      "x-goog-meta-ariadne-byte-length": "24000",
      "x-goog-meta-ariadne-sample-rate": "48000",
      "x-goog-meta-ariadne-duration-ms": "1800"
    },
    "asset": {
      "uploadId": "server-issued-one-time-ticket",
      "repoId": "...",
      "branchId": "...",
      "role": "user",
      "storageProvider": "gcs",
      "storageUri": "gs://bucket/live-audio/repos/.../branches/.../user/voice-hifi/2026-06-17/uploads/object.webm",
      "contentType": "audio/webm;codecs=opus",
      "sha256": "...",
      "crc32c": "AAAAAA==",
      "codec": "opus",
      "container": "webm",
      "qualityProfile": "voice-hifi",
      "bitrateKbps": 96,
      "channelCount": 1,
      "sampleRate": 48000,
      "durationMs": 1800,
      "byteLength": 24000,
      "encryptionKeyRef": null
    }
  }
}
```

### `POST /v1/audio-assets`

Completes an uploaded GCS audio intent. In production, the client sends only the repo ID and upload ID. Ariadne loads the stored upload intent, verifies that the GCS object exists in the configured bucket/prefix, checks the server-signed metadata, byte length, MIME type, CRC32C, quality profile, server-streamed SHA-256, generation, metageneration, ETag, and KMS key reference, then writes the durable audio manifest. The completion call is idempotent after a ticket has already been verified.

```json
{
  "repoId": "...",
  "uploadId": "server-issued-one-time-ticket"
}
```

When GCS audio storage is disabled for local development, this route also accepts a full external manifest so tests and offline demos can save audio metadata without object storage.

```json
{
  "repoId": "...",
  "branchId": "...",
  "role": "user",
  "storageProvider": "external",
  "storageUri": "gs://bucket/path/user-turn-1.webm",
  "contentType": "audio/webm;codecs=opus",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "crc32c": "AAAAAA==",
  "codec": "opus",
  "container": "webm",
  "qualityProfile": "voice-hifi",
  "bitrateKbps": 96,
  "channelCount": 1,
  "sampleRate": 48000,
  "durationMs": 1800,
  "byteLength": 4096,
  "encryptionKeyRef": "kms-key-or-null"
}
```

### `GET /v1/repos/:repoId/audio-assets`

Lists audio manifests for a repo. Add `?branchId=...` to narrow the list to one branch.

### `GET /v1/repos/:repoId/audio-assets/:assetId/playback-url`

Returns a short-lived signed `GET` URL for a stored GCS audio asset after validating repo access. Clients should request this when a transcript line is clicked, then play `audioPlayback.playbackUrl` directly with a browser audio element.

```json
{
  "audioPlayback": {
    "method": "GET",
    "playbackUrl": "https://storage.googleapis.com/...",
    "expiresAt": "2026-06-17T12:15:00.000Z",
    "contentType": "audio/webm;codecs=opus",
    "byteLength": 24000,
    "durationMs": 1800
  }
}
```

## Story turns

### `POST /v1/story/turn`

Generates the next narration, commits the turn, canonizes it, reduces canonical state, and saves the current branch state.

Request:

```json
{
  "repoId": "...",
  "branchId": "...",
  "expectedHeadTurnId": null,
  "userTranscript": "I open the silver door."
}
```

Client-supplied `actorModel` and `canonizerModel` fields are ignored. The backend enforces configured catalog models.
Use the current branch `headTurnId` as `expectedHeadTurnId`; use `null` only when the branch has no committed turns. If the branch moves before commit, the backend rejects the stale request.

Response:

```json
{
  "assistantTranscript": "The silver door opens with a breath of winter...",
  "turn": { "id": "...", "turnIndex": 1, "stateStatus": "canonized" },
  "patch": { "turnId": "...", "events": [], "facts": [], "threads": [], "warnings": [] },
  "state": { "branchId": "...", "headTurnId": "..." },
  "continuityWarnings": []
}
```

### `POST /v1/story/turn/stream`

Streams actor narration as newline-delimited JSON, then commits/canonizes the turn and emits final state events. This is the route used by the transcript-only browser loop.

Request:

```json
{
  "repoId": "...",
  "branchId": "...",
  "expectedHeadTurnId": null,
  "userTranscript": "I open the silver door."
}
```

Response content type:

```http
application/x-ndjson; charset=utf-8
```

Event examples:

```jsonl
{"type":"assistant_delta","text":"The silver door opens"}
{"type":"assistant_delta","text":" with a breath of winter..."}
{"type":"turn_committed","turn":{"id":"...","turnIndex":1,"stateStatus":"pending"}}
{"type":"canonized","patch":{"turnId":"...","events":[],"facts":[],"threads":[],"warnings":[]},"state":{"branchId":"...","headTurnId":"..."},"continuityWarnings":[]}
{"type":"done","assistantTranscript":"The silver door opens with a breath of winter...","modelMetadata":[]}
```

If an error occurs after streaming has started, the stream emits an error event rather than changing the already-sent HTTP status:

```jsonl
{"type":"error","error":"provider_rate_limited","message":"..."}
```

### `POST /v1/story/live-turn`

Commits a Gemini Live turn after the browser receives Gemini Live user and model transcripts. The backend does not regenerate actor narration; it runs the canonizer and saves the turn.

```json
{
  "repoId": "...",
  "branchId": "...",
  "liveSessionId": "...",
  "expectedHeadTurnId": null,
  "userTranscript": "I open the silver door.",
  "assistantTranscript": "The silver door exhales moonlit dust.",
  "userAudioAssetId": "optional-audio-id",
  "assistantAudioAssetId": "optional-audio-id"
}
```

Use the `branchHeadTurnId` returned by `/v1/provider/gemini/live-token` as `expectedHeadTurnId`. If the branch moves before the Live turn commits, the backend rejects the stale commit. Audio asset IDs are optional links to metadata previously registered through `/v1/audio-assets`.

## Branching

### `POST /v1/branches/fork`

Creates a branch ref from a turn with an existing compiled state snapshot.

Request:

```json
{
  "repoId": "...",
  "sourceTurnId": "...",
  "name": "darker-ending",
  "forkReason": "Explore the betrayal differently"
}
```

### `GET /v1/branches/:branchId/timeline`

Returns the timeline reachable from the branch head plus the current branch state.


## Atlas, rewind, compare, and canon inspection

### `GET /map`

Serves the Google Galaxy-style Ariadne Atlas. Use `/map?demo=1` to preview the cinematic simulated galaxy without saved data.

### `GET /v1/story-map`

Returns the compact graph payload used by `/map`. It is derived from repos, branches, committed turns, and compiled branch state.

### `GET /v1/story-search`

Searches transcripts and canon landmarks. This powers time-machine flows such as “before the betrayal at the inn.”

Query params:

| Param | Purpose |
|---|---|
| `q` | required search phrase |
| `repoId` | optional repo scope |
| `branchId` | optional branch scope |
| `limit` | optional result cap, 1-50 |

Response results include `rewindMode`, `turnId`, and `forkSourceTurnId` when Ariadne can safely fork from the matched point.

### `GET /v1/branches/compare`

Compares two branches from the same repo.

```bash
curl "http://localhost:3000/v1/branches/compare?leftBranchId=MAIN&rightBranchId=FORK"
```

The response includes the common ancestor, unique turns on each side, and scene/entity/fact/thread state differences.

### `GET /v1/branches/:branchId/canon`

Returns the canon debugger payload for a branch: compiled world state, latest turn summary, unresolved threads, audio manifests, and state statistics.
