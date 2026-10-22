---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
"@visiolab/effect-firebase-client": minor
---

`FirestoreEncoder` is removed. A model is a plain Effect schema, and encoding
it asks for no service: the services derive a codec with `toCodecFirestore`
and map its Firestore Values to their SDK's own values.

The `FirestoreSchema` schemas - `Timestamp`, `GeoPoint`,
`DocumentReference(collection)`, `ServerTimestamp`/`ServerTimestampOr`,
`Increment`/`IncrementOr`, `DeleteField`/`DeleteFieldOr` and
`ArrayUnion`/`ArrayRemove`/`ArrayOr` - are plain schemas of the portable
values. A model's `create`, `update` and `updateUnchecked` schemas have
`EncodingServices` of `never`, and encoding one of these schemas gives the
portable value rather than the SDK's. Decoding one accepts the portable value
and refuses an SDK's own. `Schema.is(FirestoreSchema.DocumentReference(collection))`
accepts only references built from `collection`; decoding re-homes a reference
read back by its path.

Breaking changes, and how to migrate:

- `FirestoreSchema.DateTimeUtcFromTimestamp` is removed. `Schema.DateTimeUtc`
  does its job, and is stored as a Firestore timestamp too:

  ```ts
  // Before
  seenAt: FirestoreSchema.DateTimeUtcFromTimestamp,
  lastSeenAt: FirestoreModel.Timestamp(FirestoreSchema.DateTimeUtcFromTimestamp),

  // After
  seenAt: Schema.DateTimeUtc,
  lastSeenAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
  ```

- `AdminFirestore.layerWithEncoder` and `ClientFirestore.layerWithEncoder` are
  removed. `layer` is the only layer:

  ```ts
  // Before
  AdminFirestore.layerWithEncoder({ databaseId: "other" });

  // After
  AdminFirestore.layer({ databaseId: "other" });
  ```

- The core `FirestoreEncoder` module and service, and the Admin and client
  `FirestoreEncoder.make`, are removed. Encoding a document by hand for a write
  the service does not make (a raw SDK write, a batch) takes `toCodecFirestore`
  plus the SDK package's mapping function:

  ```ts
  // Before: encoded through the FirestoreEncoder from layerWithEncoder
  const write = Schema.encodeEffect(Post)(post).pipe(
    Effect.flatMap((data) => Effect.promise(() => firestore.doc("posts/hello").set(data))),
  );

  // After: no layer; map the Firestore Values to the SDK's own
  const encoded = Schema.encodeSync(FirestoreValue.toCodecFirestore(Post))(post);
  await firestore.doc("posts/hello").set(AdminFirestoreValue.toAdmin(encoded, firestore));
  // or, on the client SDK
  await setDoc(doc(firestore, "posts/hello"), ClientFirestoreValue.toClient(encoded, firestore));
  ```

- `FirestoreModel.Timestamp` and `FirestoreSchema.ServerTimestampOr` take a
  `FirestoreSchema.TimeSchema`, a schema whose encoded side is a `Timestamp`,
  `DateTime.Utc` or `Date` (`FirestoreSchema.Timestamp`, `Schema.DateTimeUtc`,
  `Schema.Date`), where they took one that encodes to a `TimestampLike`.
- `Firestore.WriteServices` and `Firestore.UpdateServices` are removed. Write
  methods ask for the model's `create` or `update` schema's `EncodingServices`
  as they are.
- `Timestamp.TimestampLike`, `isTimestampLike` and `fromTimestampLikeUnsafe`,
  `GeoPoint.GeoPointLike`, `isGeoPointLike` and `fromGeoPointLikeUnsafe`, and
  `Collection.DocumentReferenceLike` and `isDocumentReferenceLike` are removed.
  Reads map the SDK's values to the portable ones before decoding, so nothing
  accepts SDK values structurally any more. `Timestamp.Order` orders
  `Timestamp`s.
- `DocumentSnapshot.raw` holds Firestore Values - the portable `Timestamp`,
  `GeoPoint`, document reference and `Uint8Array` - rather than the SDK's own
  values, and `data` decodes it through `toCodecFirestore` of the collection's
  model.
- A `Schema.Any` field takes Firestore Values only, like `Schema.Unknown`.
  Writing an SDK value or a class instance through one fails with a
  `SchemaError` at its path instead of reaching the SDK.
