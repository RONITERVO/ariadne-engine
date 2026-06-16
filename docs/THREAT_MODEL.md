# Threat model

## Assets

- User-provided Google AI Studio / Gemini API key.
- Story transcripts and generated content.
- User and assistant audio artifacts.
- Canonical world state and branch history.
- Model invocation metadata.

## Main risks

### Provider key leakage

Controls:

- Keys are supplied per provider request and not persisted.
- Provider key headers and known body fields are redacted from logs.
- Keys are rejected from query strings and JSON bodies.
- Provider key headers are rejected on non-provider routes.
- Production must use HTTPS.
- Production CORS must be a strict allow-list.
- Gemini Live uses short-lived ephemeral tokens for direct browser sessions.

### Story privacy leakage

Controls:

- Request body logging should remain disabled.
- Model invocation table stores hashes and usage metadata by default; only store full prompts/responses behind an explicit debug flag.
- Audio storage should be encrypted and access-controlled.
- Export/share features must require explicit user action.

### Prompt injection through user story text

Controls:

- Story text is not allowed to override system/developer instructions.
- Canonizer output is validated with schema before reducer application.
- Reducer is deterministic and only applies known patch shapes.
- Continuity warnings mark contradictions instead of silently trusting the model.

### Unbounded cost / abuse

Controls:

- Rate limiting is enabled.
- Maximum transcript size is enforced.
- Production config rejects mock provider, memory storage, and wildcard CORS by default.
- Public deployments should require user authentication.
- BYOK cost warning should be displayed before any non-developer public release.
- Add per-user quotas before open beta.

### Branch state corruption

Controls:

- Turns are immutable commits.
- Branches are mutable refs pointing at commits.
- Canonical state is rebuilt from patches and cached in snapshots.
- Forks require a compiled source-turn snapshot.

## Out of scope for this starter

- Full hosted-account authentication.
- Payment and subscription abuse management.
- End-to-end encrypted audio archive.
- Formal prompt-injection proof.
- Mature child-safety and age-gating policy.
