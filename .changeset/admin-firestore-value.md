---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
---

`AdminFirestore` writes and reads documents through `toCodecFirestore`. A model
can hold plain Effect schemas such as `Schema.DateTimeUtc`, `Schema.Date` and
`Schema.Uint8Array`: they are stored as Firestore timestamps and bytes and read
back as what they were written as. Reading a document that holds a value
outside Firestore Values, such as a vector, fails with a `FirestoreError`
naming the field. A `DocumentSnapshot` now decodes its data through
`toCodecFirestore` of the collection's model.

The new `firestore/AdminFirestoreValue` module exports the mapping the service
applies, for writes made through the raw SDK:

```ts
const encoded = Schema.encodeSync(toCodecFirestore(Post))(post);
await firestore.doc("posts/hello").set(AdminFirestoreValue.toAdmin(encoded, firestore));
```

`AdminFirestoreValue.fromAdmin` goes the other way, from what the Admin SDK
read to Firestore Values.
