# Ariadne Atlas

Ariadne Atlas is the player-facing story map. It is deliberately not a clone of Map of GitHub's tile pipeline: a personal story library is a living graph, not a static million-node atlas. The long-term shape is a compact graph API plus a client renderer that can later swap SVG for Canvas/WebGL without changing persistence.

## Product metaphor

Ariadne Atlas now uses a Google Galaxy-style zoom ladder rather than a flat story graph. The backend contract stays the same, but the frontend renders the same saved story data at progressively deeper cosmic scales:

- **Observable Universe**: the signed-in user's complete story library.
- **Superclusters & Filaments**: story repos/worlds connected by canon filaments.
- **Galaxies & Local**: branches, forks, and local timelines.
- **Solar Systems & Stars**: current scenes and committed turns.
- **Planets, Moons & Signals**: entities, facts, and unresolved story threads from canonical branch state.

This keeps the Git-like model visible to users without exposing database internals, while making `/map` feel like a cinematic deep-space navigation product.

## Routes

| Route | Purpose |
|---|---|
| `GET /map` | Player-facing interactive atlas page. |
| `GET /v1/story-map` | Compact graph payload used by the atlas. |

`/v1/story-map` uses the same Firebase access model as story repo routes. In local/dev mode it can show unowned in-memory repos; in production with `ARIADNE_FIREBASE_AUTH_REQUIRED=true`, it only returns the signed-in user's graph.

## Why no migration is required

The atlas is derived from existing documents:

```text
StoryRepo
  -> BranchRef
     -> TurnCommit timeline
     -> WorldState scene/entities/facts/threads
```

No new stored coordinates, indexes, or map tables are required for the first release. The backend builds a compact read model on demand and caps very large collections defensively. When the app grows, the same response shape can be backed by cached materialized read models or vector/geospatial indexes without changing the frontend contract.

## Long-term upgrade path

1. Keep `/v1/story-map` as the stable contract.
2. Add pagination/query params for very large libraries.
3. Cache layout hints per user if deterministic client layout becomes too slow.
4. Add semantic clusters from embeddings: locations, factions, mysteries, relationships.
5. Add optional materialized galaxy tiles only when node counts outgrow a single WebGL scene.
6. Add map actions: fork from selected turn, compare branches, replay route, and filter by unresolved threads.

