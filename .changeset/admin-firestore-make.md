---
"@visiolab/effect-firebase-admin": minor
---

`AdminFirestore` is now built on core's `Firestore.make`. Its methods and options are unchanged, with two differences you may notice. Each `Firestore.*` span now covers encoding and decoding as well as the SDK call. An invalid collection path or Collection Group id now fails with a `FirestoreError`, where it used to be a defect.

`AdminFirestore` and `AdminTransaction` follow Effect's pattern for driver services such as `PgClient`: their types extend `Firestore.With` and `Firestore.TransactionBase` rather than `Firestore` and `Transaction`, and their keys hand back `AdminFirestore & Firestore` and `AdminTransaction & Transaction`. Providing only a portable `Firestore` no longer removes `AdminFirestore` from an effect's requirements, and a body that asks for `AdminTransaction` still needs it provided when it runs through the portable `Firestore`.
