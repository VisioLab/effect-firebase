---
"@visiolab/effect-firebase-admin": minor
---

Add `AdminFirestore`, a `Firestore` that also offers what only the Admin SDK
can do. The admin package's `firestore/Firestore` module is now
`firestore/AdminFirestore`, and its `layer` provides one service under both
`AdminFirestore` and `Firestore`, so portable code and admin code share one
database; `layerWithEncoder` adds `FirestoreEncoder` on top. `AdminFirestore`
has `instance`, the Admin SDK's own Firestore for the database it was opened
on, for what the service does not wrap yet.

Breaking: import the layers from `firestore/AdminFirestore` instead of
`firestore/Firestore`, and the barrel's `Firestore` namespace is now
`AdminFirestore`.
