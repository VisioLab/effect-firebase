---
"@visiolab/effect-firebase-admin": minor
---

The Admin SDK's encoder writes document references. It now builds them in the
database they point into, so `firestore/FirestoreEncoder.make` takes the
`Firestore` to write into.
