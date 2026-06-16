# Release checklist

## Before public alpha

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
- [ ] Encrypt audio assets at rest.
- [ ] Add deletion/export workflows for user data.
- [ ] Add abuse reporting and content moderation policy appropriate to your target audience.
- [ ] Add observability: streaming latency, provider errors, canonizer schema failures, continuity warnings, branch-fork success rate.
- [ ] Add export/backfill tooling before changing Firestore document shapes after production launch.

## Before beta

- [ ] Store user and assistant audio in S3-compatible object storage.
- [ ] Add semantic rewind with embeddings.
- [ ] Add voice branch commands: list, fork, checkout, replay, summarize, finish.
- [ ] Add branch diff and timeline replay.
- [ ] Add model-provider plugin boundaries and compatibility tests.
- [ ] Run load tests with realistic story lengths.
- [ ] Run red-team tests for provider-key leakage.

## Before 1.0

- [ ] Publish a stable story archive/export format.
- [ ] Add admin tools for stuck canonization jobs and continuity repair.
- [ ] Add privacy review, security review, and legal review.
- [ ] Provide public docs for self-hosting and key handling.
