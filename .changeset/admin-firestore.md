---
"@visiolab/effect-firebase-admin": minor
---

Add `AdminFirestore`, a `Firestore` that also offers what only the Admin SDK
can do, in the `firestore/AdminFirestore` module. Its `layer` provides one
service under both `AdminFirestore` and `Firestore`, so portable code and admin code share one
database. `AdminFirestore`
has `instance`, the Admin SDK's own Firestore for the database it was opened
on, for what the service does not wrap yet.
