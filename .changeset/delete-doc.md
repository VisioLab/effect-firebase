---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
"@visiolab/effect-firebase-client": minor
---

`Firestore`, `AdminFirestore` and `ClientFirestore` can delete a document with `firestore.deleteDoc(ref)`, and a transaction can queue a delete with `transaction.deleteDoc(ref)`. Deleting a document that is not there succeeds. A custom backend built with `Firestore.make` must now provide a `deleteDoc` hook, both in its options and in the operations its `runTransaction` hook hands to the body.
