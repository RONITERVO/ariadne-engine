# Roadmap

## MVP: developer/self-hosted release candidate

- [x] BYOK Google AI Studio / Gemini key flow
- [x] provider-key redaction
- [x] provider-key rejection from query/body/non-provider routes
- [x] repo + branch creation
- [x] immutable turn commits
- [x] actor + canonizer provider adapter
- [x] streaming actor route with NDJSON deltas
- [x] deterministic reducer skeleton
- [x] context capsule and closure-mode budget governor
- [x] in-memory store for local development
- [x] PostgreSQL schema and store baseline
- [x] transcript-only browser voice loop after sign-in/key setup
- [x] production config guardrails
- [x] Firebase Auth support for paid hosted usage
- [x] Firestore story store and Firebase Hosting config
- [x] prepaid credit billing ledger and Stripe checkout/webhook routes
- [x] Gemini server key rotation
- [x] Gemini Live browser integration using `/v1/provider/gemini/live-token`

## Alpha: make it unforgettable

- [ ] Audio upload to S3-compatible object storage
- [ ] Transcript spans and audio alignment
- [ ] Voice-only branch commands
- [ ] Semantic rewind: "go back before the betrayal"
- [ ] Branch library voice navigation
- [ ] Timeline audio replay
- [ ] Continuity auditor route/worker
- [ ] Background worker queue for canonizer/auditor/snapshotter

## Beta: make it robust

- [ ] Multi-provider plugin system
- [ ] Barge-in support
- [ ] Branch diffing
- [ ] Branch endings and generated cover summaries
- [ ] Human-readable repo export
- [ ] Import/export story repos as archive bundles
- [ ] Encrypted private repos
- [ ] Public share pages generated from branches
- [ ] Load tests and abuse tests

## 1.0: impress the world

- [ ] Voice-native Git for stories
- [ ] Live branching during play
- [ ] Audible branch recaps
- [ ] Canon debugger
- [ ] Model migration tool
- [ ] Deterministic replay of saved branches
- [ ] Plugin system for worlds, rulesets, voices, and canon reducers
- [ ] Offline archive format
