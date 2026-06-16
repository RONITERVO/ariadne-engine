# Operations

## Configuration

Use `.env.example` as the source of required variables. Important production variables:

```bash
NODE_ENV=production
ARIADNE_STORAGE=firestore
CORS_ORIGINS=https://your-app.example
ARIADNE_ALLOW_MOCK_PROVIDER=false
ARIADNE_PAID_USAGE_ENABLED=true
ARIADNE_FIREBASE_AUTH_REQUIRED=true
GEMINI_API_KEYS=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
APP_URL=https://your-app.example
```

`NODE_ENV=production` rejects unsafe public defaults: non-Firestore storage, `CORS_ORIGINS=*`, mock provider, disabled paid usage/auth, and missing server Gemini keys.

## Firebase Release Shape

Firebase Hosting serves `web/dist`. Same-origin `/health` and `/v1/**` requests are rewritten to the Cloud Run service `ariadne-api` in `europe-west1` by `firebase.json`.

Deploy the API to Cloud Run through Cloud Build:

```bash
gcloud builds submit --config cloudbuild.api.yaml \
  --substitutions=_APP_URL=https://your-app.web.app,_CORS_ORIGINS=https://your-app.web.app
```

Deploy Hosting and Firestore rules:

```bash
npm run deploy:firebase
```

Create these Secret Manager secrets before deploying `cloudbuild.api.yaml`:

- `gemini-api-keys`
- `stripe-secret-key`
- `stripe-webhook-secret`

Firestore stores durable state:

- `storyRepos`, `branches`, `turns`, `branchStates`, `branchSnapshots`, `eventPatches`, `continuityWarnings`
- `branchMutationLocks`
- `users/{uid}`
- `entitlements/{uid}`
- `usage/{uid}/storyTurns/{id}`
- `usage/{uid}/liveSessions/{id}`
- `billingEvents/{eventId}`

Client Firestore rules allow users to read only their own user, entitlement, and usage documents. Story data is accessed through the API so branch authorization and future sharing rules stay server-side.

## Billing

Paid users buy prepaid Ariadne credits through Stripe Checkout. Internally, usage is tracked in credit micros, where `1_000_000` credit micros equals one major unit of `BILLING_CURRENCY`.

Gemini Live token issuance reserves and then settles one fixed session charge. The default Live catalog bills every Live session as 30 seconds and the entitlement document enforces at most one active paid Live session per Firebase user.

Normal Gemini model calls reserve credits before the call and settle from Gemini `usageMetadata` after completion. BYOK requests bypass Ariadne billing and use the caller's provider key. On hosted Firebase deployments, BYOK users still sign in so story repos are owned and private; BYOK means no Ariadne credits are consumed.

Model ids and prices live in `ARIADNE_MODEL_CATALOG_JSON`; the defaults enforce:

- Live: `gemini-3.1-flash-live-preview`
- Text: `gemini-flash-lite-latest`
- Optional text catalog entry: `gemini-3.1-flash-lite`

## Frontend

The web app is intentionally transcript-only after sign-in/key setup. In development, run:

```bash
npm run dev:web
```

The frontend API base defaults to `http://localhost:3000` when Vite serves on port 5173. Override with `VITE_ARIADNE_API_BASE`, `VITE_API_BASE_URL`, or `?api=https://your-api.example`.

For a production-style single-process deployment, run `npm run build`; the Fastify API serves the built transcript shell from `/` and immutable Vite assets from `/assets/*`. The Docker image copies `web/dist` for this path.

## Persistence

Production persistence is Firestore through Firebase Admin credentials or Cloud Run's service account. Local development and tests use the in-memory store.

Each story turn holds a per-branch mutation lease for up to `ARIADNE_BRANCH_TURN_LOCK_TTL_SECONDS`. Keep this at least as high as the Cloud Run request timeout so a slow model turn cannot let another paid turn start on the same branch. If a branch already has a turn in progress, the API returns a conflict instead of letting two model calls produce competing branch heads. Commits also check the prepared branch head, and canonization is rejected if the committed turn is no longer the branch head.

## Logging

The API redacts provider key headers and fields named `apiKey`, `api_key`, `providerKey`, `provider_key`, `geminiApiKey`, and `googleApiKey`. Do not enable raw request-body logging in production.

Recommended log events:

- provider validation success/failure by key fingerprint prefix only
- streaming turn time-to-first-delta and total latency
- provider error class
- canonizer schema-failure rate
- continuity warning severity
- fork success/failure

## Backups

Back up:

- Firestore exports
- object storage bucket containing audio
- deployment environment variables

Do not back up raw provider keys because the backend should never store them.
