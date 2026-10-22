---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
"@visiolab/effect-firebase-client": minor
---

`FirestoreSchema.Timestamp`, `FirestoreSchema.GeoPoint` and
`FirestoreSchema.DocumentReference(collection)` are now plain schemas of the
portable `Timestamp`, `GeoPoint` and document reference. They have no encoding
step and ask for no `FirestoreEncoder`: a model using them has `EncodingServices`
of `never`, and `AdminFirestore` and `ClientFirestore` store them as the SDK's
own timestamp, geopoint and reference.

`FirestoreSchema.DateTimeUtcFromTimestamp` is removed. `Schema.DateTimeUtc` does
its job, and is stored as a Firestore timestamp too:

```ts
// Before
seenAt: FirestoreSchema.DateTimeUtcFromTimestamp,
lastSeenAt: FirestoreModel.Timestamp(FirestoreSchema.DateTimeUtcFromTimestamp),

// After
seenAt: Schema.DateTimeUtc,
lastSeenAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
```

`FirestoreModel.Timestamp` and `FirestoreSchema.ServerTimestampOr` take
`FirestoreSchema.Timestamp`, `Schema.DateTimeUtc` or `Schema.Date` (any schema
whose encoded side is one of those, `FirestoreSchema.TimeSchema`) as the schema
a field is read through, where they used to require one that encodes to a
`TimestampLike`.

Decoding one of these schemas directly no longer accepts an SDK's own value;
decode a document through `FirestoreValue.toCodecFirestore` after the SDK
package's mapping (`AdminFirestoreValue.fromAdmin`,
`ClientFirestoreValue.fromClient`), as the services do.

A document reference read back is now the same on both SDKs: the portable
reference at its path, built by the new `Collection.fromPathUntyped(path)`.
`FirestoreSchema.DocumentReference(collection)` turns it into a reference into
`collection`, so a reference read back is equal to one built from `collection`.
`AdminFirestoreValue.fromAdmin` used to hand the Admin SDK's own reference back.
