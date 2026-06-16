# Ariadne Engine

**Ariadne Engine** is a Firebase-ready, pay-per-usage, voice-first story product where every adventure is saved as a branchable timeline.

> A story is a repo. A timeline is a branch. A spoken turn is a commit. The AI performs; the event ledger remembers.

The hosted release supports Firebase sign-in with prepaid Ariadne credits and still accepts user-supplied Gemini keys for people who do not want to pay Ariadne. BYOK users still sign in so their story repos stay private, but their Gemini calls use their own key and do not consume Ariadne credits. BYOK keys are not persisted. Paid requests use server Gemini keys with rotation, model enforcement, Firestore usage accounting, and Stripe credit grants. After sign-in or key setup, the UI intentionally hides everything except user/model/system transcript lines.

## What is included

- Runnable Fastify API with health, config, repo, branch, turn, streaming turn, Live-turn commit, provider-validation, billing, Stripe webhook, and Gemini Live-token routes.
- BYOK Gemini provider adapter using `@google/genai`.
- Firebase Auth verification, Firestore story store, Firebase Hosting rewrites, and secure Firestore rules.
- Paid usage ledger for prepaid credits, normal model token usage, and fixed 30-second Gemini Live sessions with one active paid Live session per user.
- Server-side Gemini key rotation with per-key concurrency, minute/day limits, and cooldowns.
- Streaming actor route: `POST /v1/story/turn/stream` emits NDJSON assistant deltas before the turn is canonized.
- Transcript-only Gemini Live browser loop: browser STT only detects speech start, the app sends PCM pre-roll/tail audio to Gemini Live, Gemini Live supplies user/model transcripts and model audio, then Ariadne commits the Live turn for branch replay.
- Short-lived Gemini Live ephemeral-token endpoint locked to backend-selected Live settings.
- Server-side provider-key guardrails: keys are accepted only in provider/story headers, rejected from query/body fields, redacted from logs, and never saved.
- Production config safety checks: `NODE_ENV=production` requires Firestore, Firebase auth, paid usage, strict CORS, server Gemini keys, and no mock provider unless explicitly overridden for an isolated smoke test.
- In-memory local dev store plus PostgreSQL store baseline.
- PostgreSQL schema for branch current states, snapshots, model invocation hashes, continuity warnings, audit log, durable turn commits, audio metadata, and future semantic indexes.
- Deterministic reducer, context-budget / closure-mode logic, tests, Dockerfile, docker-compose, CI, Dependabot, security/privacy docs, threat model, release checklist, and operations docs.

## Why this can be long-term strong

Ariadne does **not** depend on the model remembering a long story perfectly. The provider generates narration, then a canonizer extracts structured events and facts. The reducer applies those patches to the canonical state. The next turn receives a compact context capsule rebuilt from the event ledger and current branch state.

That means you can migrate models later without losing the story library. Gemini, OpenAI, Claude, local models, or future providers are replaceable adapters; the story repo format is the product moat.

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

Open the Vite URL, paste a Google AI Studio / Gemini API key or sign in with Firebase, allow microphone access when the browser asks, and speak. The app auto-creates a repo and branch. After setup, the browser shows only transcript lines. For a single-process production-style smoke test, run `npm run build && npm run start` and open `http://localhost:3000/`; the API serves `web/dist` from `/` and `/assets/*`.

For local provider-free testing, set this in `.env`:

```bash
ARIADNE_ALLOW_MOCK_PROVIDER=true
```

Then paste this fake key in the frontend:

```text
mock-local-dev-key
```

The frontend API base defaults to `http://localhost:3000` when served by Vite on port 5173. Override it with either `VITE_ARIADNE_API_BASE` or a one-time query string, for example:

```text
http://localhost:5173/?api=http://localhost:3000
```

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

Continue a branch with a normal JSON response:

```bash
curl -X POST http://localhost:3000/v1/story/turn \
  -H 'content-type: application/json' \
  -H 'x-ariadne-provider-key: YOUR_GOOGLE_AI_STUDIO_KEY' \
  -d '{"repoId":"REPO_ID","branchId":"BRANCH_ID","userTranscript":"I open the silver door."}'
```

Continue a branch with realtime NDJSON model deltas:

```bash
curl -N -X POST http://localhost:3000/v1/story/turn/stream \
  -H 'content-type: application/json' \
  -H 'x-ariadne-provider-key: YOUR_GOOGLE_AI_STUDIO_KEY' \
  -d '{"repoId":"REPO_ID","branchId":"BRANCH_ID","userTranscript":"I open the silver door."}'
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
  -d '{"repoId":"REPO_ID","branchId":"BRANCH_ID","userTranscript":"I open the silver door.","assistantTranscript":"The silver door exhales moonlit dust."}'
```

## Production posture

For any public deployment:

1. Use HTTPS only.
2. Set `NODE_ENV=production`.
3. Set `ARIADNE_STORAGE=firestore` and deploy with Firebase Admin credentials or the Cloud Run service account.
4. Set a strict `CORS_ORIGINS` allow-list. Do not use `*` for production BYOK.
5. Keep `ARIADNE_ALLOW_MOCK_PROVIDER=false`.
6. Set `ARIADNE_PAID_USAGE_ENABLED=true`, `ARIADNE_FIREBASE_AUTH_REQUIRED=true`, `GEMINI_API_KEYS`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `APP_URL`.
7. Do not log request bodies containing transcripts unless users have explicitly opted in.
8. Store audio in encrypted object storage and save only object metadata in Firestore or the selected self-hosted store.
9. Keep provider keys in `x-ariadne-provider-key`; `Authorization: Bearer` is reserved for Firebase ID tokens in hosted mode.
10. Update `ARIADNE_MODEL_CATALOG_JSON` whenever enforced Gemini models or prices change.

Deploy helpers:

```bash
npm run deploy:api
npm run deploy:firebase
```

## Architecture

```text
Transcript-only browser
  ├─ asks once for a Google AI Studio key
  ├─ validates key through Ariadne backend
  ├─ auto-creates/continues a branch
  ├─ streams user speech transcript and model text
  └─ sends the key only on provider-bearing requests over HTTPS

Ariadne API
  ├─ rejects provider keys from query/body/non-provider routes
  ├─ redacts provider keys from logs
  ├─ validates request shape
  ├─ builds context capsule from branch state
  ├─ streams Gemini actor deltas
  ├─ commits immutable turn
  ├─ calls Gemini canonizer model
  ├─ reduces patch into canonical state
  └─ stores snapshots / warnings / model metadata

Firestore or self-hosted store + object storage
  ├─ event ledger is source of truth
  ├─ branch heads are mutable refs
  ├─ snapshots are caches
  └─ audio is first-class artifact metadata
```

## Key routes

| Route | Purpose |
|---|---|
| `GET /` | serves the built transcript-only browser shell when `web/dist` exists |
| `GET /health` | health and deployment metadata |
| `GET /v1/config` | frontend-safe public config |
| `POST /v1/provider/gemini/validate-key` | validates a BYOK Gemini key without storing it |
| `POST /v1/provider/gemini/live-token` | mints a locked Gemini Live ephemeral token from BYOK or paid server keys |
| `POST /v1/story/live-turn` | commits Gemini Live transcripts, canonizes, and reduces state |
| `POST /v1/repos` | creates a story repo with a `main` branch |
| `POST /v1/story/turn` | generates narration, commits a turn, canonizes, reduces state |
| `POST /v1/story/turn/stream` | streams narration deltas, then commits/canonizes the turn |
| `POST /v1/branches/fork` | creates a named branch ref from an existing turn snapshot |
| `GET /v1/branches/:branchId/timeline` | returns branch timeline and current state |

See [`docs/API.md`](docs/API.md) for details.

## Repository layout

```text
src/
  adapters/       provider interfaces, Gemini BYOK adapter, mock adapter
  application/    story orchestration service and streaming turn pipeline
  domain/         reducer, context budget, state schemas, types
  security/       provider-key extraction, validation, redaction helpers
  server/         Fastify app and routes
  storage/        in-memory and PostgreSQL story stores
web/              transcript-only browser frontend
db/               PostgreSQL schema
docs/             architecture, BYOK, security, release docs
```

## Current limits

This is now a hardened developer/self-hosted release candidate, not a finished global consumer SaaS. Browser speech recognition and speech synthesis are used for the minimal web voice loop; production Gemini Live audio is still exposed as an ephemeral-token backend path, not a completed in-browser Live voice client. Hosted user accounts, payments, object-storage audio upload, semantic rewind embeddings, mature observability, deletion/export UX, and abuse tooling remain product decisions.

## License

MIT.
