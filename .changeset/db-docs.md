---
"@visiolab/effect-firebase-client": minor
---

`Db.docs(collection | group, options?)` is a live read of a whole collection or Collection Group, holding a `ClientQuerySnapshot.DecodedClientQuerySnapshot` with every document decoded and Snapshot Metadata on each document and on the read. A group's documents are a union over its member collections. It follows the same rules as `Db.doc`: one document that does not decode fails the atom with `SchemaError` while it keeps listening, listen errors do not retry until a refresh, and it takes the same `ReadAtomOptions`. Equal collections, and groups of the same members in any order, share one atom and listener; a collection and a group never do. Its result types are `FirestoreAtom.DocsResult` and `FirestoreAtom.GroupDocsResult`, which adds `UndefinedCollectionError`.
