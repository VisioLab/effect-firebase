---
"@visiolab/effect-firebase-admin": minor
---

The Admin SDK's encoder writes document references. It now builds them in the
database they point into, so `firestore/FirestoreEncoder.layer` requires an
`App` and writes into that app's default database, and `make` takes the
`Firestore` to write into.
