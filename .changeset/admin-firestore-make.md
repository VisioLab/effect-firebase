---
"@visiolab/effect-firebase-admin": minor
---

`AdminFirestore` is now built on core's `Firestore.make`, so it requires `@visiolab/effect-firebase` 0.3.0. Its methods, options and types are unchanged, with two differences you may notice. Each `Firestore.*` span now covers encoding and decoding as well as the SDK call. An invalid collection path or Collection Group id now fails with a `FirestoreError`, where it used to be a defect.
