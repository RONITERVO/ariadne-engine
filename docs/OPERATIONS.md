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
STRIPE_PRODUCT_ID=prod_...
APP_URL=https://your-app.example
ARIADNE_AUDIO_GCS_BUCKET=your-private-audio-bucket
ARIADNE_AUDIO_GCS_PREFIX=live-audio
ARIADNE_AUDIO_MAX_BYTES=52428800
ARIADNE_AUDIO_DEFAULT_QUALITY_PROFILE=voice-hifi
ARIADNE_AUDIO_ALLOWED_QUALITY_PROFILES=voice-balanced,voice-hifi,music-hifi,aac-hifi
```

`NODE_ENV=production` rejects unsafe public defaults: non-Firestore storage, `CORS_ORIGINS=*`, mock provider, disabled paid usage/auth, missing server Gemini keys, missing Stripe config, and missing `ARIADNE_AUDIO_GCS_BUCKET`. The default per-object audio cap is 50 MiB, and GCS uploads are also bounded by the selected compressed quality profile and declared duration. Raise `ARIADNE_AUDIO_MAX_BYTES` only when Cloud Run timeout, memory, storage, and billing limits are also adjusted.

## Firebase Release Shape

Firebase Hosting serves `web/dist`. Same-origin `/health` and `/v1/**` requests are rewritten to the Cloud Run service `ariadne-api` in `europe-west1` by `firebase.json`.

The public deployment currently uses Firebase project `ariadne-engine-rt` and launch URL `https://ariadne-engine-rt.firebaseapp.com`. The paired `https://ariadne-engine-rt.web.app` host serves the same Firebase Hosting site, but Google sign-in redirects are registered for the Firebase Auth domain. Anonymous Firebase Auth must stay disabled for production.

For beginner-admin links and console-only commands, use `docs/ADMIN_RUNBOOK.md`.

Deploy the API to Cloud Run through Cloud Build:

```bash
gcloud builds submit --config cloudbuild.api.yaml \
  --substitutions=_APP_URL=https://your-app.web.app,_CORS_ORIGINS=https://your-app.web.app
```

Deploy Hosting and Firestore rules. This command fetches the Firebase Web App config and builds `web/dist` with the required `VITE_FIREBASE_*` values before deploying:

```bash
npm run deploy:firebase
```

Create these Secret Manager secrets before deploying `cloudbuild.api.yaml`:

- `gemini-api-keys`
- `stripe-secret-key`
- `stripe-webhook-secret`

## GCS Audio Storage

GCS is the production audio source store. Ariadne uses a server-issued upload intent rather than trusting client-supplied manifests: Cloud Run creates a one-time upload ticket, signs a short-lived browser `PUT` URL, signs the required GCS headers, and persists a pending `audioUploads/{uploadId}` document. The browser computes SHA-256 and CRC32C, uploads directly to GCS with the returned headers, then completes the ticket. The API verifies bucket, prefix, signed metadata, exact byte length, MIME type, CRC32C, selected quality profile, server-streamed SHA-256, generation, metageneration, ETag, and KMS key reference before saving the durable `audioAssets/{assetId}` manifest.

The public deployment uses `gs://ariadne-engine-rt-audio` with the `live-audio/` prefix:

```bash
gcloud storage buckets create gs://ariadne-engine-rt-audio \
  --project ariadne-engine-rt \
  --location=europe-west1 \
  --uniform-bucket-level-access
gcloud storage buckets update gs://ariadne-engine-rt-audio --public-access-prevention
```

Set CORS so Firebase Hosting can upload signed `PUT` requests. The checked-in `gcs.audio.cors.json` includes the cache-control, exact-size, one-write, checksum, duration, and quality-profile headers used by signed uploads:

```bash
gcloud storage buckets update gs://ariadne-engine-rt-audio --cors-file=gcs.audio.cors.json
```

```json
[
  {
    "origin": [
      "https://ariadne-engine-rt.firebaseapp.com",
      "https://ariadne-engine-rt.web.app"
    ],
    "method": ["PUT", "OPTIONS"],
    "responseHeader": [
      "content-type",
      "cache-control",
      "x-goog-hash",
      "x-goog-content-length-range",
      "x-goog-if-generation-match",
      "x-goog-meta-ariadne-upload-id",
      "x-goog-meta-ariadne-repo-id",
      "x-goog-meta-ariadne-branch-id",
      "x-goog-meta-ariadne-role",
      "x-goog-meta-ariadne-sha256",
      "x-goog-meta-ariadne-crc32c",
      "x-goog-meta-ariadne-codec",
      "x-goog-meta-ariadne-container",
      "x-goog-meta-ariadne-quality-profile",
      "x-goog-meta-ariadne-bitrate-kbps",
      "x-goog-meta-ariadne-channel-count",
      "x-goog-meta-ariadne-byte-length",
      "x-goog-meta-ariadne-content-type",
      "x-goog-meta-ariadne-sample-rate",
      "x-goog-meta-ariadne-duration-ms"
    ],
    "maxAgeSeconds": 3600
  }
]
```

Cloud Run signs upload intents with its service account and verifies objects before registering manifests. The runtime service account needs object access to the bucket and URL-signing permission:

```bash
gcloud storage buckets add-iam-policy-binding gs://ariadne-engine-rt-audio \
  --member=serviceAccount:234362703129-compute@developer.gserviceaccount.com \
  --role=roles/storage.objectAdmin
gcloud iam service-accounts add-iam-policy-binding \
  234362703129-compute@developer.gserviceaccount.com \
  --project ariadne-engine-rt \
  --member=serviceAccount:234362703129-compute@developer.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator
```

Use lifecycle rules to manage retention and cost. The checked-in `gcs.audio.lifecycle.json` keeps current repo audio in Standard storage, moves objects under `live-audio/repos/` to Nearline after 30 days, then to Coldline after 180 days:

```bash
gcloud storage buckets update gs://ariadne-engine-rt-audio --lifecycle-file=gcs.audio.lifecycle.json
```

The default upload profile is `voice-hifi`: Opus in WebM/Ogg, mono, target 96 kbps, capped at 128 kbps plus mux overhead. `music-hifi` and `aac-hifi` are allowed for stereo/music and browser fallback; `lossless-master` exists in code but is not enabled by default. Pending upload tickets expire after the signed URL TTL and should be inspected in `audioUploads` during operations. Repo deletion calls the object store before removing Firestore documents, deleting all GCS objects under the repo prefix so private raw audio is not left behind after a user deletes a story world. If Ariadne later needs global low-latency playback, streaming derivatives, or transcription alignment, add a media pipeline on top of GCS while keeping GCS as the durable source.

Firestore stores durable state in the v2 user-rooted, repo-centered schema:

- `users/{uid}/storyRepos/{repoId}`
- `users/{uid}/storyRepos/{repoId}/branches/{branchId}`
- `users/{uid}/storyRepos/{repoId}/turns/{turnId}`
- `users/{uid}/storyRepos/{repoId}/branchState/{branchId}`
- `users/{uid}/storyRepos/{repoId}/mutationLocks/{branchId}`
- `users/{uid}/storyRepos/{repoId}/stateSnapshots/{turnId}`
- `users/{uid}/storyRepos/{repoId}/canonPatches/{patchId}`
- `users/{uid}/storyRepos/{repoId}/continuityWarnings/{warningId}`
- `users/{uid}/storyRepos/{repoId}/audioAssets/{assetId}`
- `users/{uid}/storyRepos/{repoId}/audioUploads/{uploadId}`
- `users/{uid}/billingAccounts/default`
- `users/{uid}/billingAccounts/default/storyTurns/{id}`
- `users/{uid}/billingAccounts/default/liveSessions/{id}`
- `users/{uid}/billingAccounts/default/billingEvents/{eventId}`
- `storyRepoIndex/{repoId}`, `storyBranchIndex/{branchId}`, `storyTurnIndex/{turnId}`, and `billingEventIndex/{eventId}`

Client Firestore rules allow users to read only their own profile, credit entitlement, and usage documents. Story data and billing events are accessed through the API/admin dashboard so branch authorization, future sharing, and raw transcript/world-state privacy stay server-side.

## Billing

Paid users buy prepaid Ariadne credits through Stripe Checkout. `STRIPE_PRODUCT_ID` points Checkout at the dashboard-managed Stripe product for Ariadne credits, and Checkout allows Stripe promotion codes. Internally, usage is tracked in credit micros, where `1_000_000` credit micros equals one major unit of `BILLING_CURRENCY`.

For launch discounts, create Stripe coupons/promotion codes in the Stripe Dashboard. Use percentage-off coupons for public campaigns, such as 10% off for new users. For friends, 100% off promotion codes work too; the webhook grants the full requested Ariadne credits from Checkout metadata when Stripe completes a fully-discounted zero-dollar session.

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

When `audioStorageEnabled` is true in `/v1/config`, the hosted frontend archives the per-turn microphone audio sent to Gemini Live and assistant audio returned by Gemini. It encodes PCM chunks with `MediaRecorder` into the configured compressed profile, preferring Opus WebM/Ogg and falling back to AAC MP4 when available. If the browser cannot produce a cost-safe compressed archive, it skips the audio archive instead of uploading WAV/PCM. The frontend then computes SHA-256 and CRC32C, requests signed GCS upload intents from `/v1/audio-assets/upload-url`, uploads directly to GCS with the exact signed headers returned by the API, completes each ticket through `/v1/audio-assets`, and sends the returned asset IDs with `/v1/story/live-turn`.

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
