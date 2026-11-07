---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-client": minor
"@visiolab/effect-firebase-functions": minor
---

Generalise what is deployed from Callables to Functions, with Callables as the only kind for now and their behaviour unchanged.

- Add `FirebaseFunction` (`@visiolab/effect-firebase/functions`), the type every kind of Function shares: its `kind`, its `name`, and the `Handler` key its handler is provided under. A Callable is a Function of kind `"Callable"`.
- `FunctionGroup` replaces `CallableGroup`. `FunctionGroup.make(identifier).add(...)` takes Functions of any kind, and its members are under `functions` rather than `callables`. `Members`, `Names` and `Member` take an optional kind, such as `FunctionGroup.Members<typeof Users, Callable.Any>`, to keep only the members of that kind. `add` still throws on a name clash, now with `The Function Group "<group>" already has a Function named "<name>"`. Everything that took a `CallableGroup` takes a `FunctionGroup`, restricted to its Callable members.
- `Functions.make(fn, live, options?)` and `Functions.group(group, live, options?)`, from the new root entry `@visiolab/effect-firebase-functions`, replace `CallableFunction.make` and `CallableFunction.group`, and dispatch on each member's kind. Export shapes, deployed names and per-member options are unchanged. `CallableFunction.Export` is now `Functions.CallableExport`. The `./https` and `./https/CallableFunction` entries are removed.
- `CallableClient.make` takes a Callable or a `FunctionGroup`, and its client has a function for each of the group's Callables only.

Callable spans, their names and attributes, and Cloud Logging output are unchanged.
