---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
---

Add `Firestore.runTransaction`, which runs an effect in a transaction with a
`Transaction` service provided: `getDoc`, `setDoc` and `updateDoc`,
as the service has them, with every read before every write and the writes
queued until the effect is done. The SDK runs the effect again, up to
`maxAttempts`, when it fails with a `FirestoreError` the SDK would retry - a
conflict, or an outage that passes; any other failure rolls the transaction
back and fails with exactly what the effect failed with, without a retry. Interrupting it rolls the transaction back and waits for the rollback.
The Admin SDK implements it in `firestore/AdminFirestore.layer`.
