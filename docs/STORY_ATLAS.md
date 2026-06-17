# Ariadne Atlas

Ariadne Atlas is the player-facing story map and 1.0 control plane. It turns the story ledger into a Google Galaxy-style universe: users zoom from their whole library down to worlds, branches, turns, scenes, entities, facts, and unresolved signals.

## Product metaphor

The backend contract stays compact, while the frontend renders saved story data at progressively deeper cosmic scales:

- **Observable Universe**: the signed-in user's complete story library.
- **Superclusters & Filaments**: story repos/worlds connected by canon filaments.
- **Galaxies & Local**: branches, forks, and local timelines.
- **Solar Systems & Stars**: current scenes and committed turns.
- **Planets, Moons & Signals**: entities, facts, and unresolved story threads from canonical branch state.

This keeps the Git-like model visible to users without exposing database internals, while making `/map` feel like a cinematic deep-space navigation product.

## Routes

| Route | Purpose |
|---|---|
| `GET /map` | Player-facing interactive Atlas page. |
| `GET /map?demo=1` | Cinematic simulated galaxy for previews and screenshots. |
| `GET /v1/story-map` | Compact graph payload used by the Atlas. |
| `GET /v1/story-search` | Time-machine search for transcripts and canon landmarks. |
| `GET /v1/branches/:branchId/timeline` | Timeline route used for branch replay and turn selection. |
| `GET /v1/branches/compare` | Branch divergence and state diff. |
| `GET /v1/branches/:branchId/canon` | Canon debugger payload. |
| `GET /v1/repos/:repoId/export` | JSON or Markdown archive download. |
| `DELETE /v1/repos/:repoId` | Delete a story world. |

`/v1/story-map` uses the same Firebase access model as story repo routes. In local/dev mode it can show unowned in-memory repos; in production with `ARIADNE_FIREBASE_AUTH_REQUIRED=true`, it only returns the signed-in user's graph.

## 1.0 release controls

The first Google Galaxy release includes the controls needed for the app's advertised non-voice story flows:

- Continue from a selected repo, branch, turn, scene, entity, fact, or thread by setting that branch active and returning to the player.
- Fork directly from a selected committed turn, or from a selected branch head, using `/v1/branches/fork`.
- Search story memory with time-machine prompts such as “before the betrayal at the inn.”
- Fork from the matched rewind point when the search result resolves to a safe source turn.
- Inspect a branch's committed route and replay visible turns in order.
- Compare the selected branch with the active branch, including common ancestor and state divergence.
- Open the canon debugger for current scene, entities, facts, threads, context budget, latest turn, and audio manifests.
- Export a story world as JSON or Markdown.
- Delete a story world from the map detail panel.
- Filter the universe by current branch, branch heads, unresolved/open threads, and canon landmarks.
- Use in-map help for keyboard, mouse, and touch navigation shortcuts.

## Why no migration is required

The Atlas is derived from existing documents:

```text
StoryRepo
  -> BranchRef
     -> TurnCommit timeline
     -> WorldState scene/entities/facts/threads
```

No stored coordinates, indexes, or map tables are required for 1.0. The backend builds a compact read model on demand and caps very large collections defensively. When the app grows, the same response shape can be backed by cached materialized read models or vector/geospatial indexes without changing the frontend contract.

## Long-term upgrade path

1. Keep `/v1/story-map` as the stable contract.
2. Add pagination/query params for very large libraries.
3. Cache layout hints per user if deterministic client layout becomes too slow.
4. Add embedding-backed clusters for locations, factions, mysteries, and relationships.
5. Add optional materialized galaxy tiles only when node counts outgrow a single WebGL scene.
6. Move voice-native branch commands into v1.1 without changing the map API.
