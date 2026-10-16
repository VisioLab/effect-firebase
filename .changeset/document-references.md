---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
---

Read and write document references. `FirestoreSchema.DocumentReference(collection)`
decodes an SDK's `DocumentReference` into a `Collection.DocumentReference` typed
by `collection`, refusing one whose path points anywhere else, and encodes it
back through the encoder. `Collection` gains `DocumentReferenceLike`,
`isDocumentReferenceLike` and `fromPath`.

`FirestoreEncoder` gains `documentReference`, so an encoder written against the
previous interface has to answer it as well. The Admin SDK's encoder does not
write references yet.
