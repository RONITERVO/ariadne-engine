# Ariadne Engine

**Ariadne Engine** is a Firebase-first, pay-per-usage, voice story product where every adventure is saved as a branchable timeline.

> A story is a repo. A timeline is a branch. A spoken turn is a commit. The AI performs; the event ledger remembers.

The hosted release supports Firebase Google sign-in with prepaid Ariadne credits and still accepts user-supplied Gemini keys for people who do not want to pay Ariadne. BYOK users still sign in so their story repos stay private, but their Gemini calls use their own key and do not consume Ariadne credits. BYOK keys are not persisted.

## What is included

- Fastify API with health, config, repo, branch, turn, streaming turn, Live-turn commit, provider-validation, billing, Stripe webhook, Gemini Live-token, player story-map, semantic rewind, archive export, branch compare, canon debug, audio-manifest, and deletion routes.
- Gemini provider adapter using `@google/genai`, plus a development-only mock adapter.
- Firebase Auth verification, Firestore story store, Firebase Hosting rewrites, and secure Firestore rules.
- Paid usage ledger for prepaid credits, normal model token usage, and fixed 30-second Gemini Live sessions with one active paid Live session per user.
- Server-side Gemini key rotation with per-key concurrency, minute/day limits, and cooldowns.
- Per-branch mutation leases and expected-head checks so overlapping turns cannot corrupt branch history.
- Transcript-only Gemini Live browser loop. Browser STT only detects speech start; Gemini Live supplies user/model transcripts and model audio. Live commits upload preserved user/model audio to GCS through one-time upload intents and link verified audio asset manifests to turn commits.
- Player-facing **Ariadne Atlas** at `/map`: a Google Galaxy-style story universe where repos are galaxies, branches are orbits, turns are stars, canon state becomes landmarks, and users can search, rewind, fork, replay, compare, export, or delete from the map.
- Server-side provider-key guardrails. BYOK keys are accepted only in `x-ariadne-provider-key`, rejected from query/body fields, redacted from logs, and never saved.
- Production config safety checks. `NODE_ENV=production` requires Firestore, Firebase auth, paid usage, strict CORS, server Gemini keys, and no mock provider.
- In-memory local dev/test store plus Firestore production store.
- Deterministic reducer, context-budget logic, tests, Dockerfile, CI, Dependabot, security/privacy docs, threat model, release checklist, and operations docs.

## Why this can be long-term strong

Ariadne does not depend on the model remembering a long story perfectly. The provider generates narration, then a canonizer extracts structured events and facts. The reducer applies those patches to the canonical state. The next turn receives a compact context capsule rebuilt from the event ledger and current branch state.

That means models can change later without losing the story library. Gemini is the supported provider now; the story repo format is the product moat.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

In another terminal:

```bash
npm run dev:web
```

Open the Vite URL, paste a Google AI Studio / Gemini API key or sign in with Firebase Google Auth, allow microphone access when the browser asks, and speak. The app auto-creates a repo and branch. After setup, the browser shows only transcript lines. Open `/map?demo=1` for the cinematic galaxy demo, or `/map` for saved story data.

For local provider-free testing, set this in `.env`:

```bash
ARIADNE_ALLOW_MOCK_PROVIDER=true
```

Then paste this fake key in the frontend:

```text
mock-local-dev-key
```

For a single-process production-style smoke test, run:

```bash
npm run build
npm run start
```

Then open `http://localhost:3000/`. The API serves `web/dist` from `/` and `/assets/*`.

## API examples

Validate a user-supplied Gemini key:

```bash
curl -X POST http://localhost:3000/v1/provider/gemini/validate-key \
  -H 'content-type: application/json' \
  -H 'x-ariadne-provider-key: YOUR_GOOGLE_AI_STUDIO_KEY' \
  -d '{}'
```

Create a story repo:

```bash
curl -X POST http://localhost:3000/v1/repos \
  -H 'content-type: application/json' \
  -d '{"title":"The Glass Forest","defaultStyle":"dark fairy-tale adventure"}'
```

Continue a branch with realtime NDJSON model deltas:

```bash
curl -N -X POST http://localhost:3000/v1/story/turn/stream \
  -H 'content-type: application/json' \
  -H 'x-ariadne-provider-key: YOUR_GOOGLE_AI_STUDIO_KEY' \
  -d '{"repoId":"REPO_ID","branchId":"BRANCH_ID","expectedHeadTurnId":null,"userTranscript":"I open the silver door."}'
```

Create a Gemini Live ephemeral token:

```bash
curl -X POST http://localhost:3000/v1/provider/gemini/live-token \
  -H 'content-type: application/json' \
  -H 'x-ariadne-provider-key: YOUR_GOOGLE_AI_STUDIO_KEY' \
  -d '{"repoId":"REPO_ID","branchId":"BRANCH_ID","responseModalities":["AUDIO"]}'
```

Commit a Gemini Live turn after the browser receives Gemini Live transcripts:

```bash
curl -X POST http://localhost:3000/v1/story/live-turn \
  -H 'content-type: application/json' \
  -H 'x-ariadne-provider-key: YOUR_GOOGLE_AI_STUDIO_KEY' \
  -d '{"repoId":"REPO_ID","branchId":"BRANCH_ID","expectedHeadTurnId":null,"userTranscript":"I open the silver door.","assistantTranscript":"The silver door exhales moonlit dust."}'
```

## Production posture

For any public deployment:

1. Use HTTPS only.
2. Set `NODE_ENV=production`.
3. Set `ARIADNE_STORAGE=firestore` and deploy with Firebase Admin credentials or the Cloud Run service account.
4. Set a strict `CORS_ORIGINS` allow-list. Do not use `*` for production BYOK.
5. Keep `ARIADNE_ALLOW_MOCK_PROVIDER=false`.
6. Set `ARIADNE_PAID_USAGE_ENABLED=true`, `ARIADNE_FIREBASE_AUTH_REQUIRED=true`, `GEMINI_API_KEYS`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRODUCT_ID`, and `APP_URL`.
7. Do not log request bodies containing transcripts unless users have explicitly opted in.
8. Store audio in a private GCS bucket through one-time signed browser upload intents with CRC32C and server-side SHA-256 verification, then save only verified object metadata in Firestore.
9. Keep provider keys in `x-ariadne-provider-key`; `Authorization: Bearer` is reserved for Firebase ID tokens.
10. Update `ARIADNE_MODEL_CATALOG_JSON` whenever enforced Gemini models or prices change.

Deploy helpers:

```bash
npm run deploy:api
npm run deploy:firebase
```

For public project administration, service links, and console-only commands, see `docs/ADMIN_RUNBOOK.md`. For contribution guardrails, see `CONTRIBUTING.md`.

## Runtime shape

```text
Transcript-only browser
  |-- signs in for credits or accepts a Google AI Studio key
  |-- validates BYOK keys through Ariadne backend
  |-- auto-creates/continues a branch
  |-- sends Live audio to Gemini after speech is detected
  |-- uploads preserved turn audio directly to GCS through short-lived one-time signed upload intents
  `-- renders Gemini user/model transcripts

Ariadne API
  |-- rejects provider keys from query/body/non-provider routes
  |-- redacts provider keys from logs
  |-- verifies Firebase users for hosted stories
  |-- reserves/settles credit usage
  |-- builds context capsules from branch state
  |-- commits immutable turns
  |-- calls Gemini canonizer model
  `-- reduces patches into canonical state

Firestore + object storage
  |-- event ledger is source of truth
  |-- branch heads are mutable refs
  |-- branch mutation locks reject overlapping turns
  |-- snapshots are caches
  `-- audio metadata is attached to turns and export manifests
```

## Key routes

| Route | Purpose |
|---|---|
| `GET /` | serves the built transcript-only browser shell when `web/dist` exists |
| `GET /health` | health and deployment metadata |
| `GET /v1/config` | frontend-safe public config |
| `GET /map` | player-facing Ariadne Atlas story galaxy |
| `GET /v1/story-map` | compact graph payload for the Atlas; derived from existing repos, branches, timelines, and world state |
| `GET /v1/story-search` | lexical/semantic rewind search across transcripts and canon landmarks |
| `GET /v1/repos/:repoId/export` | downloadable JSON or Markdown story archive |
| `DELETE /v1/repos/:repoId` | user data deletion for a story world |
| `POST /v1/audio-assets/upload-url` | creates a short-lived one-time signed GCS upload intent for preserved turn audio |
| `POST /v1/audio-assets` | completes an upload intent and registers verified preserved audio object metadata for a repo/branch |
| `GET /v1/repos/:repoId/audio-assets` | lists preserved audio manifests |
| `GET /v1/branches/compare` | compares two branches and state divergence |
| `GET /v1/branches/:branchId/canon` | canon debugger payload with compiled branch state |
| `POST /v1/provider/gemini/validate-key` | validates a BYOK Gemini key without storing it |
| `POST /v1/provider/gemini/live-token` | mints a locked Gemini Live ephemeral token from BYOK or paid server keys |
| `POST /v1/story/live-turn` | commits Gemini Live transcripts, canonizes, and reduces state |
| `POST /v1/repos` | creates a story repo with a `main` branch |
| `POST /v1/story/turn` | generates narration, commits a turn, canonizes, reduces state |
| `POST /v1/story/turn/stream` | streams narration deltas, then commits/canonizes the turn |
| `POST /v1/branches/fork` | creates a named branch ref from an existing turn snapshot |
| `GET /v1/branches/:branchId/timeline` | returns branch timeline and current state |

See `docs/API.md` for details.

## Repository layout

```text
src/
  adapters/       Gemini provider adapter and development mock adapter
  application/    story orchestration service and streaming turn pipeline
  billing/        model catalog, Gemini key rotation, prepaid usage ledger
  domain/         reducer, context budget, state schemas, types
  firebase/       Firebase Admin bootstrap
  security/       provider-key extraction, validation, redaction helpers
  server/         Fastify app and routes
  storage/        in-memory local store and Firestore production store
web/              transcript-only browser frontend
docs/             architecture, BYOK, story atlas, security, release docs
```

## 1.0 boundary

This release is a complete non-voice-control 1.0: branchable story commits, the Google Galaxy map, visual fork/rewind/compare/replay controls, user export/delete workflows, canon debugger routes, billing hooks, Gemini Live token flow, signed GCS audio upload intents with CRC32C and server-side SHA-256 verification, object cleanup on repo deletion, and audio asset manifests are implemented. BYOK keys are not persisted. Voice-native branch commands are intentionally marked as v1.1. Timeline audio replay and transcript/audio timestamp alignment remain v1.1 work.

## License

MIT.
