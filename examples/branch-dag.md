# Example branch DAG

```text
repo: the-glass-forest

main
  t001: User enters the forest.
  t002: Mara appears.
  t003: User opens the silver door.

branch: no-silver-door
  parent: t002
  t004: User refuses the door and follows Mara.
  t005: The moon-stag blocks the road.

branch: darker-ending
  parent: t003
  t006: The door eats the user's shadow.
```

Voice command:

> "Take me back before the silver door and make a branch where I don't trust Mara."

Resolution:

1. Semantic index finds `t003` as the silver door event.
2. Engine chooses parent `t002` as the before-point.
3. New branch ref points at `t002`.
4. Next user turn commits as first new turn on that branch.
```
