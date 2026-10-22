---
"@visiolab/effect-firebase-client": minor
---

Add `ClientFirestore`: a `Firestore` that also offers what only the client SDK
can do. Its `layer` provides one service under both the `ClientFirestore` and
the portable `Firestore` tag, and `layerWithEncoder` adds the
`FirestoreEncoder`. `ClientFirestore.instance` is the client SDK's own
Firestore object, for what this library does not wrap, such as turning the
network off and on.

Breaking: the `firestore/Firestore` module is renamed to
`firestore/ClientFirestore`, and the barrel exports it as `ClientFirestore`.
