---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
---

Add Firestore timestamps.

`firestore/Timestamp` models a timestamp without depending on an SDK, holding
the seconds and nanoseconds Firestore stores. `firestore/FirestoreSchema` holds
its codecs, and `firestore/FirestoreEncoder` is the service that builds the
SDK's own value when a document is written. The Admin SDK's implementation
ships as `firestore/FirestoreEncoder.layer`.

The Admin package's Firestore entry moves to `firestore` as well, and is no
longer re-exported from the root.
