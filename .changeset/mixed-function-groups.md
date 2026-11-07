---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-functions": minor
---

Let one Function Group hold Callables and Document Triggers together.

- `DocumentTrigger.toLayer(group, name, handler)`, `DocumentTrigger.serve(group, name)` and `DocumentTrigger.deployment(group, name)` implement, run and locate a trigger as a member of a Function Group, as their `Callable` counterparts do.
- `Functions.group` deploys a Document Trigger member as `<group>-<name>`, next to the group's Callables. Each member's options are typed by its kind: `CallableOptions` for a Callable, the shared options plus `retry` for a Document Trigger.
- A Callable Client built from a mixed group has a function for each Callable only.
