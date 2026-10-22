---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
"@visiolab/effect-firebase-client": minor
---

Reading many documents hands back a `QuerySnapshot` rather than a bare array.
The new `firestore/QuerySnapshot` module holds the documents a read found in
`docs`, with `QuerySnapshot.make` and `QuerySnapshot.isQuerySnapshot`.
`Firestore.getDocs` returns one and `Firestore.streamDocs` emits them, and both
the Admin and client SDKs implement the new shape.

Breaking: read the documents from `snapshot.docs` where `getDocs` or
`streamDocs` used to hand back the array itself.
