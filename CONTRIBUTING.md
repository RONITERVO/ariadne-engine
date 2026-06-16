# Contributing

Ariadne's core rule is: the AI performs, the event ledger remembers.

Before opening a pull request:

1. Run `npm run check`.
2. Do not add code that stores provider keys.
3. Keep model providers behind adapters.
4. Keep canonical story state reducer-driven and deterministic.
5. Document Firestore shape changes in `docs/PERSISTENCE.md` and add export/backfill notes before public data changes.

Security issues should be reported privately, not through public issues.
