---
"@visiolab/effect-firebase-admin": minor
---

Add `AdminTransaction`, a `Transaction` that can also read every document in a
collection: `getDocs(collectionRef)` hands back a `QuerySnapshot`, as
`Firestore.getDocs` does, and follows the same reads-before-writes rule as a
document read. `AdminFirestore.runTransaction` provides the one transaction
under both `AdminTransaction` and `Transaction`, so portable transaction
helpers and admin ones run in the same body, and asks the caller for neither.
