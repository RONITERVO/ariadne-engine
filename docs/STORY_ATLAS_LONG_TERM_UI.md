# Ariadne Atlas long-term UI

## Product decision

The universe is the interface. The map is never treated as wallpaper behind application chrome.

The long-term shell has only two pieces:

1. **Universe workspace** — the navigable 3D story graph.
2. **Command dock** — one input-height row at the bottom for global actions.

Contextual information never floats over the universe. Opening an object changes the layout: the universe yields space to an adjacent inspector on wide screens or a lower inspector on compact screens. The canvas resizes and remains interactive.

## Why this is the preferred model

A floating-card map UI works for geographic lookup because the map is often supporting context. In Ariadne, the map is the product. Covering it with scale menus, legends, search results, stats, status pills, and object cards makes the central metaphor feel decorative and becomes unusable on a small phone.

The Atlas therefore uses four rules:

- **Direct manipulation first.** Tap an object to focus it. Tap it again to inspect it. Pinch, drag, and scroll manipulate the universe itself.
- **One stable home for global controls.** Search, filters, reset, and selected-object entry live in the bottom command dock.
- **Reflow instead of overlay.** Search suggestions, filters, and the inspector consume layout space; they do not cover the map.
- **Progressive disclosure.** Every object exposes one obvious primary action, at most two quick actions, and a `More` disclosure for expert and destructive operations.

## Command dock

### Resting state

The resting dock is approximately the height of a normal chat composer. From left to right it contains:

- Show the whole universe.
- Search stories and moments.
- Filter the universe.
- Open the selected object.

On compact phones the selected-object button is icon-only. On wider screens it also shows the selected name. The selected object remains visibly highlighted and labeled in the universe, so the dock does not need to duplicate a card.

### Search state

Typing changes the universe immediately:

- Exact matches brighten in place.
- Nonmatches recede.
- Compact result chips appear in one horizontally scrollable row beneath the search field.
- Pressing Search runs semantic story-memory search for requests such as “before the betrayal at the inn.”

The result row is below the search field. The search field rises by a few pixels as the dock grows downward. The workspace becomes slightly shorter, so no result covers the universe.

Selecting a result flies to it and opens its inspector. Semantic results can expose a small branch action, but the branch form itself opens inline in the inspector.

### Filter state

The same lower row contains a short, horizontally scrolling set of filters. Filters affect the universe directly and never open a menu or sheet.

Long-term filters should stay conceptual rather than technical:

- All
- Current path
- Path endings
- Open threads
- Story memory

Additional specialist filters belong in natural-language search, not in a growing toolbar.

## Object interaction

### First tap

- Select the object.
- Center and zoom to the appropriate scale.
- Strengthen its world-space label and selection ring.
- Keep the inspector closed unless it was already open.

### Second tap or the info button

- Open the inspector.
- Preserve the object at the center of the remaining universe viewport.
- Keep all map gestures available.

### Back / close

- Close the inspector.
- Return all available space to the universe without losing selection or camera position.

### Home

- Clear search.
- Clear filters.
- Close the inspector.
- Return to the whole library view.

## Inspector behavior

The inspector is not a card or sheet. It is an adjacent application region.

### Wide screens

- Right-side column, roughly 330–430 px.
- The universe occupies all remaining width.
- Opening and closing the inspector resizes the WebGL canvas.

### Compact screens

- Universe remains in the upper 38–42% of the workspace, with a minimum usable height.
- Inspector occupies the lower workspace and scrolls independently.
- The command dock remains at the bottom.
- Nothing covers the universe, including the inspector header.

### Information order

1. Plain-language object type and location in the story.
2. Object name.
3. One-sentence meaning or summary.
4. One primary action.
5. At most two quick actions.
6. A few useful counts or status values.
7. `More`, `Details`, and `Related` disclosures.

Cosmic terminology is visual flavor, not required product vocabulary. The inspector says “story world,” “story path,” and “story moment,” rather than requiring the user to learn “supercluster,” “galaxy,” and “star.”

## What each object is for

| Object | What it means to a person | Show immediately | Primary action | Quick action | Advanced disclosure |
|---|---|---|---|---|---|
| Library | All saved stories | World, path, moment, and open-thread counts | Start a story | None | Leave map, warnings |
| Story world | One complete fictional world | Summary, path count, moment count, people/places, threads | Continue story | View current timeline | Downloads, delete |
| Story path | One branch of events | Summary, moments, people/places, open threads | Continue this path | View timeline; create a new path | Compare, inspect memory, downloads |
| Story moment | One committed turn | Short excerpt, moment number, saved time | Continue this story | Branch from this moment | Timeline, raw memory detail |
| Scene | Current dramatic situation | Location, tone, present people | Continue this story | View timeline | Inspect memory |
| Character or place | A remembered entity | Current description and status | Continue this story | Related objects | Full metadata |
| Open thread | An unresolved promise, mystery, risk, or goal | Summary, status, priority | Continue this story | Related moments | Full metadata |
| Story fact | A canon statement | Fact text and provenance | Continue this story | Related objects | Full metadata |

## Simple for newcomers, deep for experts

The novice path is entirely visible:

- Tap a world.
- Tap it again.
- Press Continue.

Expert depth does not require more persistent chrome:

- `/` focuses search.
- `F` opens filters.
- `Enter` opens the selected object.
- `Esc` closes the current secondary region.
- `+`, `-`, and `R` control the camera.
- Number keys retain direct scale navigation.
- Natural-language search becomes the command surface for rewind, compare, fork, and future voice-native actions.

## No-overlay policy

The long-term Atlas does not use floating UI for:

- Object details
- Search results
- Filters
- Scale controls
- Legends
- Statistics
- Status pills
- Fork naming
- Destructive confirmation
- Timeline, compare, or canon inspection

Transient operating-system UI such as the software keyboard is unavoidable. Product UI otherwise reflows the universe or lives inside the inspector.

## Accessibility

- Every map object remains available in a semantic navigation layer.
- All controls use familiar symbols plus accessible labels.
- Touch controls remain at least 44 px on compact screens.
- Search uses a native search field and `enterkeyhint="search"`.
- Selection is conveyed by more than color.
- Keyboard access is first-class, not a separate expert mode.
- Reduced-motion settings remove layout animation.
- Plain-language labels avoid making the cosmic metaphor a prerequisite for understanding the product.

## Long-term growth rule

New features do not earn new permanent buttons. They must fit one of three places:

1. A direct manipulation in the universe.
2. A global command in search or filters.
3. A contextual action in the inspector, usually under `More`.

This constraint keeps the Atlas usable when the library contains thousands of worlds and when the product gains voice commands, multiplayer presence, richer relationships, generated recaps, and plugin data.
