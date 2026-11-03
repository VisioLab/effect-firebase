---
"@visiolab/effect-firebase-admin": minor
---

`AdminFirestore` is now built on core's `Firestore.make`, so it requires `@visiolab/effect-firebase` 0.3.0. Its methods and options are unchanged, with two differences you may notice. Each `Firestore.*` span now covers encoding and decoding as well as the SDK call. An invalid collection path or Collection Group id now fails with a `FirestoreError`, where it used to be a defect.

`AdminTransaction` is now a class-style service key, so a body that asks for it and runs through the portable `Firestore` still asks its caller for it, rather than having it dropped as if it were a `Transaction`. Its runtime key and what `yield* AdminTransaction` hands back are unchanged, but the type `AdminTransaction` now names the key: write `AdminTransaction["Service"]` for the transaction itself.
