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
  "version": "0.3.0",
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
  "liveBillableSeconds": 30
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

Creates a Stripe Checkout session for Ariadne prepaid credits.

```json
{ "amountCents": 1000 }
```

### `POST /v1/webhooks/stripe`

Stripe webhook route. It verifies the raw request body and grants credits idempotently for `payment_intent.succeeded`.

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
  "assistantTranscript": "The silver door exhales moonlit dust."
}
```

Use the `branchHeadTurnId` returned by `/v1/provider/gemini/live-token` as `expectedHeadTurnId`. If the branch moves before the Live turn commits, the backend rejects the stale commit.

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
