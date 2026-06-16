# Contributing

Ariadne's core rule is: the AI performs, the event ledger remembers.

Before opening a pull request:

1. Run `npm run check`.
2. Do not add code that stores provider keys.
3. Keep model providers behind adapters.
4. Keep canonical story state reducer-driven and deterministic.
5. Document schema changes in `docs/RELEASE_CHECKLIST.md` until a migration system exists.

Security issues should be reported privately, not through public issues.
