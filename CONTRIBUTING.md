# Contributing

This repository is the public Ariadne Engine product base. Keep changes small, explicit, and aligned with the Firebase-first architecture.

## Before Opening A PR

Run:

```bash
npm run check
```

Read:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `docs/ADMIN_RUNBOOK.md`
- `docs/PERSISTENCE.md`
- `docs/BYOK_GOOGLE_AI_STUDIO.md`

## Hard Rules

- Do not reintroduce anonymous Firebase sign-in in the hosted app. Production uses Google sign-in.
- Do not add Postgres, SQL migration folders, or legacy database migration code. Production persistence is Firestore; tests and local dev use the in-memory store.
- Do not store user Gemini keys. BYOK keys only travel in `x-ariadne-provider-key` and must be redacted from logs.
- Do not bypass `expectedHeadTurnId`, branch mutation leases, or branch-head commit checks.
- Do not change paid usage defaults without updating model pricing docs, tests, and release checks.
- Do not replace `npm run deploy:firebase` with a plain Vite build for production Hosting. The deploy script injects Firebase web config before building.
- Do not commit `web/dist`, `.firebase`, Auth exports, local `.env` files, secret files, logs, screenshots with tokens, or generated billing exports.

## Auth Expectations

Hosted users sign in with Firebase Google Auth before using paid Ariadne credits or BYOK story storage. Anonymous Auth must remain disabled in Firebase Console and absent from frontend code.

If you need a local no-provider smoke test, set `ARIADNE_ALLOW_MOCK_PROVIDER=true` in a local `.env` and use the documented mock key. Do not make the public deployment accept mock provider calls.

## Architecture Expectations

Ariadne is not a chat-history wrapper. A story is stored as immutable turns, branch refs, event patches, and reduced branch state. Changes that flatten this into a transcript-only database model are regressions.

The model catalog is the only intended place to add, remove, or reprice supported models. The current hosted defaults enforce:

- Live: `gemini-3.1-flash-live-preview`
- Text: `gemini-flash-lite-latest`
- Optional text catalog entry: `gemini-3.1-flash-lite`

## PR Quality Bar

Good PRs include:

- a narrow problem statement
- tests for changed behavior
- doc updates when commands, auth, billing, deployment, or model pricing changes
- no unrelated refactors

PRs should not ask reviewers to infer whether deployment, billing, or auth still works. Include the exact command output summary, not secrets.

## Security Reports

Security issues should be reported privately, not through public issues.
