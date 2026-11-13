---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-client": minor
---

Decode a Document Snapshot or Query Snapshot once into a Decoded Snapshot, whose documents hold their decoded `data` as a value instead of an Effect. `DocumentSnapshot.decode` and `QuerySnapshot.decode` keep `ref`, `id` and `raw`, fail with `SchemaError` and require the models' decoding services. A query decodes every document or fails as a whole. A Decoded Snapshot is a value of its own, `DecodedExisting`, `DecodedMissing` or `DecodedQuerySnapshot`, never the lazy snapshot it came from, so `isDocumentSnapshot` and `isQuerySnapshot` are `false` for it. `ClientDocumentSnapshot.decode` and `ClientQuerySnapshot.decode` also keep `metadata` in the type, on each document and on the query. All four work on a live read: `streamDoc(ref).pipe(Stream.mapEffect(DocumentSnapshot.decode))`.
