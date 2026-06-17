# Roadmap

## 1.0 complete: non-voice-control release

- [x] BYOK Google AI Studio / Gemini key flow
- [x] provider-key redaction
- [x] provider-key rejection from query/body/non-provider routes
- [x] Firebase Auth support for hosted paid usage
- [x] prepaid credit billing ledger and Stripe checkout/webhook routes
- [x] Gemini server key rotation
- [x] Gemini Live browser integration using `/v1/provider/gemini/live-token`
- [x] transcript-only browser voice loop after sign-in/key setup
- [x] repo + branch creation
- [x] immutable turn commits
- [x] expected-head checks and per-branch mutation leases
- [x] actor + canonizer provider adapter
- [x] streaming actor route with NDJSON deltas
- [x] deterministic reducer
- [x] context capsule and closure-mode budget governor
- [x] in-memory store for local development
- [x] Firestore production store
- [x] production config guardrails
- [x] Firebase Hosting config and Firestore rules
- [x] Google Galaxy `/map` release UI
- [x] visual branch checkout and fork controls
- [x] semantic rewind search across transcripts and canon landmarks
- [x] deterministic branch replay from the Atlas
- [x] branch compare/diff route and Atlas panel
- [x] canon debugger route and Atlas panel
- [x] user-data JSON and Markdown export
- [x] repo deletion workflow
- [x] audio asset manifest registration and listing
- [x] optional audio asset links on Live turn commits
- [x] direct browser-to-GCS audio upload UX through server-issued upload intents, CRC32C validation, server-side SHA-256 verification, and signed object preconditions
- [x] release tests for search/export/audio/canon/compare/delete

## v1.1: voice-native control layer

- [ ] Voice-only branch commands: list, fork, checkout, replay, summarize, finish
- [ ] Voice confirmation for time-machine forks
- [ ] Audible branch recaps
- [ ] Branch library voice navigation
- [ ] Transcript spans and audio timestamp alignment
- [ ] Timeline audio replay

## v1.2: robustness and scale

- [ ] Embedding-backed semantic index for very large story libraries
- [ ] Background worker queue for canonizer/auditor/snapshotter jobs
- [ ] Continuity auditor route/worker
- [ ] Load tests with realistic story lengths
- [ ] Abuse reporting and moderation workflow
- [ ] Materialized map read models or galaxy tiles for very large libraries
- [ ] Admin tools for stuck canonization jobs and continuity repair

## v2: platform expansion

- [ ] Multi-provider plugin system
- [ ] Barge-in support
- [ ] Branch endings and generated cover summaries
- [ ] Import story repos from archive bundles
- [ ] Encrypted private repos with user-managed keys
- [ ] Public share pages generated from branches
- [ ] Plugin system for worlds, rulesets, voices, and canon reducers
