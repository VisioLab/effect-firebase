---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
"@visiolab/effect-firebase-client": minor
---

`FirestoreEncoder` is removed, along with everything that only existed to work
around it. Encoding a model no longer asks for any service: derive a codec with
`toCodecFirestore` and map its output with the SDK package's mapping function.

- The core `FirestoreEncoder` module and service, and the Admin and client
  `FirestoreEncoder` implementations, are removed.
- `AdminFirestore.layerWithEncoder` and `ClientFirestore.layerWithEncoder` are
  removed. `layer` is the only layer:

  ```ts
  // Before
  AdminFirestore.layerWithEncoder({ databaseId: "other" });

  // After
  AdminFirestore.layer({ databaseId: "other" });
  ```

- Encoding a document by hand for a write the service does not make (a raw SDK
  write, a batch) takes `toCodecFirestore` plus the SDK's exported mapping
  function instead of an encoder:

  ```ts
  // Before: encoded through the FirestoreEncoder from layerWithEncoder
  const data = yield * Schema.encodeEffect(Post)(post);
  yield * Effect.promise(() => firestore.doc("posts/hello").set(data));

  // After: no layer; map the Firestore Values to the SDK's own
  const encoded = Schema.encodeSync(FirestoreValue.toCodecFirestore(Post))(post);
  await firestore.doc("posts/hello").set(AdminFirestoreValue.toAdmin(encoded, firestore));
  // or, on the client SDK
  await setDoc(doc(firestore, "posts/hello"), ClientFirestoreValue.toClient(encoded, firestore));
  ```

- `Firestore.WriteServices` and `Firestore.UpdateServices` are removed. Write
  methods ask for the model's `create` or `update` schema's `EncodingServices`
  as they are.
- `Timestamp.TimestampLike`, `isTimestampLike` and `fromTimestampLikeUnsafe`,
  `GeoPoint.GeoPointLike`, `isGeoPointLike` and `fromGeoPointLikeUnsafe`, and
  `Collection.DocumentReferenceLike` and `isDocumentReferenceLike` are removed.
  Reads map the SDK's values to the portable ones before decoding, so nothing
  accepts SDK values structurally any more. `Timestamp.Order` orders
  `Timestamp`s.
- `AdminFirestoreValue.toAdmin` and `ClientFirestoreValue.toClient` take
  Firestore Values only. A value outside the union, such as the SDK's own
  `Timestamp` or a class instance, throws instead of being handed to the SDK.
- `toCodecFirestore` no longer lets `Schema.Any` through as an escape hatch:
  like `Schema.Unknown`, it accepts Firestore Values only. Writing an SDK value
  or a class instance through a `Schema.Any` field fails with a `SchemaError`
  at its path instead of reaching the SDK.
