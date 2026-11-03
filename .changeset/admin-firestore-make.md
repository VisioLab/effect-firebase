---
"@visiolab/effect-firebase-admin": minor
---

`AdminFirestore` is now built on core's `Firestore.make`, so it requires `@visiolab/effect-firebase` 0.3.0. Its methods and options are unchanged, with two differences you may notice. Each `Firestore.*` span now covers encoding and decoding as well as the SDK call. An invalid collection path or Collection Group id now fails with a `FirestoreError`, where it used to be a defect.

Breaking: `AdminTransaction` is now a class-style service key. `yield* AdminTransaction` hands back the same transaction as before, but where you wrote `AdminTransaction` as a type for the transaction, write `AdminTransaction["Service"]`. In return, portable code that asks for `AdminTransaction` now has to be given it, where before the type checker silently dropped it as if it were a `Transaction`.
