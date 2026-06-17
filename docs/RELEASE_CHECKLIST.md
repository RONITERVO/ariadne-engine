# Release checklist

## 1.0 product-surface checks

- [x] Branchable repos and immutable turns are implemented.
- [x] Expected-head checks and branch mutation leases prevent competing branch heads.
- [x] Gemini BYOK keys are accepted only in `x-ariadne-provider-key`, redacted, and not persisted.
- [x] Hosted paid usage, Firebase Auth, credit ledger, Stripe Checkout, and Stripe webhook routes are present.
- [x] Gemini Live token flow is present.
- [x] Live transcript commits support optional user/model audio asset IDs.
- [x] `/map` provides the Google Galaxy story navigation surface.
- [x] `/map` supports visual branch checkout, fork, timeline replay, branch compare, canon debug, export, delete, and semantic rewind.
- [x] `/v1/story-search` supports time-machine search over transcripts and canon landmarks.
- [x] `/v1/repos/:repoId/export` supports JSON and Markdown archives.
- [x] `/v1/repos/:repoId` deletion removes the repo and related local/Firestore story records.
- [x] `/v1/audio-assets` and `/v1/repos/:repoId/audio-assets` support preserved-audio manifests.
- [x] Tests cover search/export/audio/canon/compare/delete release routes.
- [x] Voice-native branch commands are explicitly marked as v1.1.

## Before public deployment

- [ ] Deploy behind HTTPS.
- [ ] Set `NODE_ENV=production`.
- [ ] Set `ARIADNE_STORAGE=firestore`.
- [ ] Deploy `firebase.json`, `firestore.rules`, and `firestore.indexes.json`.
- [ ] Set a strict `CORS_ORIGINS` allow-list.
- [ ] Keep `ARIADNE_ALLOW_MOCK_PROVIDER=false`.
- [ ] Set `ARIADNE_PAID_USAGE_ENABLED=true` and `ARIADNE_FIREBASE_AUTH_REQUIRED=true`.
- [ ] Configure Firebase Google Auth for the hosted frontend and confirm anonymous Auth is disabled.
- [ ] Set `GEMINI_API_KEYS` and server-key rotation limits.
- [ ] Configure Stripe Checkout, `STRIPE_WEBHOOK_SECRET`, and dashboard-managed `STRIPE_PRODUCT_ID`.
- [ ] Confirm `/v1/webhooks/stripe` subscribes to `payment_intent.succeeded` and `checkout.session.completed`, then grants credits idempotently.
- [ ] Confirm overlapping turn requests on the same branch return conflict instead of creating competing heads.
- [ ] Confirm Live turns include `expectedHeadTurnId` and stale Live commits are rejected.
- [ ] Add a user-facing cost warning for BYOK Gemini usage if you expose anything beyond the transcript-only developer surface.
- [ ] Disable request-body logging and third-party analytics on provider-key flows.
- [ ] Add backup/restore for Firestore exports and object storage.
- [ ] Encrypt audio assets at rest and register only manifests/checksums/key refs in Ariadne.
- [ ] Verify export and delete UX with an account that owns multiple story repos.
- [ ] Add abuse reporting and content moderation policy appropriate to your target audience.
- [ ] Add observability: streaming latency, provider errors, canonizer schema failures, continuity warnings, branch-fork success rate, export/delete success rate.
- [ ] Add export/backfill tooling before changing Firestore document shapes after production launch.

## v1.1 readiness

- [ ] Voice branch commands: list, fork, checkout, replay, summarize, finish.
- [ ] Voice confirmation before semantic rewind forks.
- [ ] Direct browser-to-object-storage audio upload UX.
- [ ] Transcript spans and audio alignment.
- [ ] Timeline audio replay and audible branch recaps.

## Legal/security review

- [ ] Confirm privacy policy covers private transcripts, audio metadata, billing data, and deletion/export behavior.
- [ ] Confirm terms cover user-generated roleplay content and provider-key BYOK usage.
- [ ] Run red-team tests for provider-key leakage.
- [ ] Review Firestore rules and service-account permissions.
- [ ] Review retention policy for object-storage audio.
