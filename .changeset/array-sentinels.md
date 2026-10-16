---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
---

Let an update grow or shrink an array with `FieldValue.arrayUnion` and
`FieldValue.arrayRemove`. `FirestoreModel.Array(item)` takes either in an
update, and `FirestoreSchema` gains `ArrayUnion`, `ArrayRemove` and `ArrayOr`.

`FirestoreEncoder` gains `arrayUnion` and `arrayRemove`, so an encoder written
against the previous interface has to answer them as well.
