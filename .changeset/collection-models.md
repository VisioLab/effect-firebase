---
"@visiolab/effect-firebase": minor
---

`Collection.make` and `subcollection` take a `FirestoreModel` rather than any
schema, so every collection carries the `create` and `update` shapes its
documents are written in, not just the one they are read in.

Breaking: a collection defined over a plain schema, such as a `Schema.Struct`,
no longer compiles. Declare its documents with `FirestoreModel.Class` instead.
