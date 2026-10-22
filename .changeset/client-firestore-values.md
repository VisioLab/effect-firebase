---
"@visiolab/effect-firebase-client": minor
---

`ClientFirestore` writes and reads documents through `toCodecFirestore`. A
model can hold plain Effect schemas such as `Schema.DateTimeUtc`, `Schema.Date`,
`Schema.Uint8Array` and `Schema.Option`. The first two are stored as Firestore
timestamps and `Uint8Array` as bytes, and each reads back as what it was
written as:

```ts
class Event extends FirestoreModel.Class<Event>("Event")({
  at: Schema.DateTimeUtc,
  on: Schema.Date,
  payload: Schema.Uint8Array,
  note: Schema.Option(Schema.String),
}) {}
```

Reading a document that holds a value outside Firestore Values, such as a
vector, fails with a `FirestoreError` naming the field.

The new `firestore/ClientFirestoreValue` module exports the mapping the service
applies, for writes made through the raw SDK:

```ts
const encoded = Schema.encodeSync(toCodecFirestore(Event))(event);
await setDoc(doc(firestore, "events/e"), ClientFirestoreValue.toClient(encoded, firestore));
```

`ClientFirestoreValue.fromClient` goes the other way, from what the client SDK
read to Firestore Values. A document reference read back keeps its path, and
`FirestoreSchema.DocumentReference(collection)` resolves it as before.

Models that use the `FirestoreSchema` codecs keep working unchanged.
