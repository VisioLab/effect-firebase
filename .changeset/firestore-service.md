---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
---

Add `firestore/Firestore`, a service that reads and writes the documents of a
typed collection: `getDoc` hands back a `DocumentSnapshot`, `getDocs` the
`Existing` snapshots of a collection, and `setDoc` and `addDoc` write a document
in its model's `create` shape. The Admin SDK implements it in
`firestore/Firestore.layer`, which writes through an encoder of its own built
against the database it opens.
