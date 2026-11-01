# @visiolab/effect-firebase-admin

## 0.2.0

### Minor Changes

- [#81](https://github.com/VisioLab/effect-firebase/pull/81) [`5b3290b`](https://github.com/VisioLab/effect-firebase/commit/5b3290bc6678ddd718b48ebadd54c83e18849202) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `AdminFirestore` writes and reads documents through `toCodecFirestore`. A model
  can hold plain Effect schemas such as `Schema.DateTimeUtc`, `Schema.Date` and
  `Schema.Uint8Array`: they are stored as Firestore timestamps and bytes and read
  back as what they were written as. Reading a document that holds a value
  outside Firestore Values, such as a vector, fails with a `FirestoreError`
  naming the field.

  The new `firestore/AdminFirestoreValue` module exports the mapping the service
  applies, for writes made through the raw SDK:

  ```ts
  const encoded = Schema.encodeSync(FirestoreValue.toCodecFirestore(Post))(post);
  await firestore.doc("posts/hello").set(AdminFirestoreValue.toAdmin(encoded, firestore));
  ```

  `AdminFirestoreValue.fromAdmin` goes the other way, from what the Admin SDK
  read to Firestore Values. A document reference read back is the
  `DocumentPath` it points at, and `toAdmin` writes a `DocumentPath` as
  `firestore.doc(path)`.

  The `effect` peer dependency is pinned to `4.0.4`, as the core package's is.

- [#70](https://github.com/VisioLab/effect-firebase/pull/70) [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `AdminFirestore`, a `Firestore` that also offers what only the Admin SDK
  can do, in the `firestore/AdminFirestore` module. Its `layer` provides one
  service under both `AdminFirestore` and `Firestore`, so portable code and admin code share one
  database. `AdminFirestore`
  has `instance`, the Admin SDK's own Firestore for the database it was opened
  on, for what the service does not wrap yet.

- [#109](https://github.com/VisioLab/effect-firebase/pull/109) [`4df4327`](https://github.com/VisioLab/effect-firebase/commit/4df432771304eb5ef80ea71e299cf75c5d058dcb) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `AdminTransaction.getDocs` reads a Collection Group as well as a collection,
  with the same overloads as `Firestore.getDocs`. A group read inside a
  transaction can fail with `UndefinedCollectionError`, which fails the body and
  rolls the transaction back without retrying it. The portable `Transaction`
  stays document-only.

- [#70](https://github.com/VisioLab/effect-firebase/pull/70) [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `AdminTransaction`, a `Transaction` that can also read every document in a
  collection: `getDocs(collectionRef)` hands back a `QuerySnapshot`, as
  `Firestore.getDocs` does, and follows the same reads-before-writes rule as a
  document read. `AdminFirestore.runTransaction` provides the one transaction
  under both `AdminTransaction` and `Transaction`, so portable transaction
  helpers and admin ones run in the same body, and asks the caller for neither.

- [#43](https://github.com/VisioLab/effect-firebase/pull/43) [`378c409`](https://github.com/VisioLab/effect-firebase/commit/378c4090ed74dd9f4add769e5d336f66bc714018) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Let an update grow or shrink an array with `FieldValue.arrayUnion` and
  `FieldValue.arrayRemove`. `FirestoreModel.Array(item)` takes either in an
  update, and `FirestoreSchema` gains `ArrayUnion`, `ArrayRemove` and `ArrayOr`.

- [#109](https://github.com/VisioLab/effect-firebase/pull/109) [`4df4327`](https://github.com/VisioLab/effect-firebase/commit/4df432771304eb5ef80ea71e299cf75c5d058dcb) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Read every document of a collection across all of its parents with a
  Collection Group. The new `firestore/CollectionGroup` module defines one from
  the `Collection` definitions it stands for, all sharing one collection id:
  `CollectionGroup.make(UserPosts)`, or `CollectionGroup.make(UserPosts,
  OrgPosts)` for several. It also offers `isCollectionGroup`, `Members` and
  `Valid`. The type checker refuses a group whose collections do not share the
  collection id of the first, or that has two collections at the same path, and
  `make` throws on those and on an empty group.

  `Firestore.getDocs` and `Firestore.streamDocs` take a group as well as a
  collection reference, on the Admin and client SDKs alike. Each document comes
  back as a document of the one collection it lives in: its `DocumentReference`
  typed by that collection, its ancestor ids filled in from its path, and its
  data decoded through that collection's model. The snapshot's `docs` are a union
  per collection, such as `Existing<UserPosts> | Existing<OrgPosts>`, so
  `docs.filter(OrgPosts.contains)` narrows the id, ancestors, reference and data
  together. `QuerySnapshot` and `ClientQuerySnapshot` distribute their `docs`
  this way through the new `QuerySnapshot.Existing` and
  `ClientQuerySnapshot.Existing` types. A stream emits the whole group each time
  a document in any of its collections changes.

  A document under the collection id at a path the group does not define fails
  the read, or the stream at the first snapshot holding it, with the new
  `UndefinedCollectionError`, carrying its `path` and the `collectionId`. Reading
  a collection still fails with `FirestoreError` alone. On the client SDK, group
  reads and streams take the same read and listen options as collection ones, and
  hand back `ClientQuerySnapshot`s with their metadata.

- [#44](https://github.com/VisioLab/effect-firebase/pull/44) [`6ad9e48`](https://github.com/VisioLab/effect-firebase/commit/6ad9e481f0ef04994fdcbfe6635b29021e4be398) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `FirestoreSchema.DocumentReference(collection)` for fields holding a
  document reference.

- [#114](https://github.com/VisioLab/effect-firebase/pull/114) [`2cc242d`](https://github.com/VisioLab/effect-firebase/commit/2cc242d8950eedfd54b35d9830aacc8f5e66680a) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Require `effect` `~4.1.0` as the peer dependency, up from exactly 4.0.6. Any
  4.1.x patch release now satisfies it, so a consumer no longer has to match the
  exact `effect` version this library was released with.

- [#22](https://github.com/VisioLab/effect-firebase/pull/22) [`8de738a`](https://github.com/VisioLab/effect-firebase/commit/8de738a3ae06f3844ba8009eff066efa1ae6c075) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `firestore/Firestore`, a service that reads and writes the documents of a
  typed collection: `getDoc` hands back a `DocumentSnapshot`, `getDocs` the
  `Existing` snapshots of a collection, and `setDoc` and `addDoc` write a document
  in its model's `create` shape, and `updateDoc` writes a patch in its `update`
  shape, or its `updateUnchecked` one with `{ mode: "unchecked" }`. The Admin SDK implements it in
  `firestore/AdminFirestore.layer`.

- [#58](https://github.com/VisioLab/effect-firebase/pull/58) [`be404f0`](https://github.com/VisioLab/effect-firebase/commit/be404f02335c452b86e6b31f9044b69a0b675df5) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `Firestore.streamDoc` and `Firestore.streamDocs`, which listen to a
  document or a collection and emit a snapshot - what `getDoc` or `getDocs` would
  hand back - each time it changes. Running the stream attaches a listener of its
  own, which is detached once the stream stops; a reader that falls behind sees
  the latest snapshot rather than every one in between, and the stream fails with
  a `FirestoreError` when Firestore drops the listener. The Admin and client SDKs
  implement them in `firestore/AdminFirestore.layer` and
  `firestore/ClientFirestore.layer`; the client SDK emits its own
  writes as soon as it makes them, before the database acknowledges them.

- [#57](https://github.com/VisioLab/effect-firebase/pull/57) [`9883e51`](https://github.com/VisioLab/effect-firebase/commit/9883e5163e0abdb84f5c18ef34dcc1fa145747d6) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `Firestore.runTransaction`, which runs an effect in a transaction with a
  `Transaction` service provided: `getDoc`, `setDoc` and `updateDoc`,
  as the service has them, with every read before every write and the writes
  queued until the effect is done. The SDK runs the effect again, up to
  `maxAttempts`, when it fails with a `FirestoreError` the SDK would retry - a
  conflict, or an outage that passes; any other failure rolls the transaction
  back and fails with exactly what the effect failed with, without a retry. Interrupting it rolls the transaction back and waits for the rollback.
  The Admin SDK implements it in `firestore/AdminFirestore.layer`.

- [#27](https://github.com/VisioLab/effect-firebase/pull/27) [`d7ab3e5`](https://github.com/VisioLab/effect-firebase/commit/d7ab3e5e964125038e9c9b37e11938a0612d4e16) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Require `effect` `^4.0.1`.

- [#19](https://github.com/VisioLab/effect-firebase/pull/19) [`97f1dc3`](https://github.com/VisioLab/effect-firebase/commit/97f1dc36937da1cdf957289e97f9e2688c4d17c2) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add Firestore timestamps.

  `firestore/Timestamp` models a timestamp without depending on an SDK, holding
  the seconds and nanoseconds Firestore stores. `firestore/FirestoreSchema` holds
  its schema.

  The Admin package's Firestore entry moves to `firestore` as well, and is no
  longer re-exported from the root.

- [#35](https://github.com/VisioLab/effect-firebase/pull/35) [`15ef0f7`](https://github.com/VisioLab/effect-firebase/commit/15ef0f77ed304afbf274c6cd560f14655295eb19) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add the Firestore increment sentinel.

  `firestore/FieldValue` gains `increment` and `decrement`, which ask the server
  to move a number by however far rather than to write one over it, so two clients
  that each add one leave the field two higher. Firestore has the one sentinel for
  both directions, so `decrement(2)` is `increment(-2)` and reads back as such.

  `firestore/FirestoreSchema` gains the `Increment` codec that writes it, and
  `IncrementOr`, which takes the schema a field is read through and hands back the
  one it is written through. `firestore/FirestoreModel` gains `Number`, the field
  built from the pair: read as that schema, written as it or as a move.

  ```ts
  visits: FirestoreModel.Number(Schema.Int);
  balance: FirestoreModel.Number(Schema.Finite);
  ```

  What the number may be is the call site's to say, down to any check it cares to
  put on it, and the writes hold it as closely as the read does.

- [#70](https://github.com/VisioLab/effect-firebase/pull/70) [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Reading many documents hands back a `QuerySnapshot` rather than a bare array.
  The new `firestore/QuerySnapshot` module holds the documents a read found in
  `docs`, with `QuerySnapshot.make` and `QuerySnapshot.isQuerySnapshot`.
  `Firestore.getDocs` returns one and `Firestore.streamDocs` emits them, and both
  the Admin and client SDKs implement the new shape.

  Breaking: read the documents from `snapshot.docs` where `getDocs` or
  `streamDocs` used to hand back the array itself.

- [#38](https://github.com/VisioLab/effect-firebase/pull/38) [`de20e4b`](https://github.com/VisioLab/effect-firebase/commit/de20e4b4e72b1e500ebf02f3539d0da433c72520) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Let an update remove a field.

  `firestore/FieldValue` gains `deleteField`, with `DeleteField` and
  `DeleteFieldOr` to write it in `firestore/FirestoreSchema`.
  `firestore/FirestoreModel` gains `Optional`: an optional key where a field is
  read and created, and removable where it is updated. It takes a schema or
  another field.

  ```ts
  nickname: FirestoreModel.Optional(Schema.String);
  lastSeenAt: FirestoreModel.Optional(FirestoreModel.Timestamp(FirestoreSchema.Timestamp));
  ```

- [#81](https://github.com/VisioLab/effect-firebase/pull/81) [`5b3290b`](https://github.com/VisioLab/effect-firebase/commit/5b3290bc6678ddd718b48ebadd54c83e18849202) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `FirestoreEncoder` is removed. A model is a plain Effect schema, and encoding
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
  accepts only references built from `collection`. Through `toCodecFirestore`, a
  reference is written as its `DocumentPath` and read back into `collection`.

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
    `GeoPoint`, `DocumentPath` and `Uint8Array` - rather than the SDK's own
    values, and `data` decodes it through `toCodecFirestore` of the collection's
    model.
  - A `Schema.Any` field takes Firestore Values only, like `Schema.Unknown`.
    Writing an SDK value or a class instance through one fails with a
    `SchemaError` at its path instead of reaching the SDK.

- [#28](https://github.com/VisioLab/effect-firebase/pull/28) [`4506660`](https://github.com/VisioLab/effect-firebase/commit/450666055b6f6fb678ea316ac9205ff02186c2c6) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add Firestore document models.

  `firestore/FirestoreModel` derives the shapes a document is read and written in
  from one field declaration, over the `VariantSchema` that `effect/schema`'s
  `Model` is built on. The class is the `read` variant, which is what a snapshot
  decodes into, and `create` and `update` hang off it - the latter with every
  field it carries made optional, since an update writes the fields that change
  rather than a whole document.

  `Immutable` keeps a field out of the writes that must not carry it, and
  `Timestamp` is a field read as a timestamp and written either as one or as the
  sentinel the server resolves.

  `firestore/FieldValue` holds the sentinels that only exist on the way to the
  database, which is `serverTimestamp` for now. `firestore/FirestoreSchema` gains
  the `ServerTimestamp` codec that writes it, and `TimestampOrServer` for a field
  that takes either.

- [#45](https://github.com/VisioLab/effect-firebase/pull/45) [`0eea67f`](https://github.com/VisioLab/effect-firebase/commit/0eea67fadc140cf1a8f253098a85976ddf006e73) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `FirestoreSchema.GeoPoint`, which writes a geopoint as the SDK's own `GeoPoint` rather than a map.

### Patch Changes

- [#115](https://github.com/VisioLab/effect-firebase/pull/115) [`209a22d`](https://github.com/VisioLab/effect-firebase/commit/209a22d3596fe89e2340c53b63b6c3cc96ce958f) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Brand the error classes (`FirestoreError`, `UndefinedCollectionError`, `AppError`,
  `AuthError`), so TypeScript no longer accepts a plain object of the same shape
  where one is expected. Construct them with `new` as before.
- Updated dependencies [[`378c409`](https://github.com/VisioLab/effect-firebase/commit/378c4090ed74dd9f4add769e5d336f66bc714018), [`209a22d`](https://github.com/VisioLab/effect-firebase/commit/209a22d3596fe89e2340c53b63b6c3cc96ce958f), [`8a32e3f`](https://github.com/VisioLab/effect-firebase/commit/8a32e3f63668346aa7c5b1afda46fd1fe49ad609), [`4df4327`](https://github.com/VisioLab/effect-firebase/commit/4df432771304eb5ef80ea71e299cf75c5d058dcb), [`4df4327`](https://github.com/VisioLab/effect-firebase/commit/4df432771304eb5ef80ea71e299cf75c5d058dcb), [`5d9dc0f`](https://github.com/VisioLab/effect-firebase/commit/5d9dc0f93a9304a12c12d1e2df6a68cb209e064d), [`6ad9e48`](https://github.com/VisioLab/effect-firebase/commit/6ad9e481f0ef04994fdcbfe6635b29021e4be398), [`1e3d2ae`](https://github.com/VisioLab/effect-firebase/commit/1e3d2ae47f2bc22e3c9bd3e418da99415486386b), [`2cc242d`](https://github.com/VisioLab/effect-firebase/commit/2cc242d8950eedfd54b35d9830aacc8f5e66680a), [`8de738a`](https://github.com/VisioLab/effect-firebase/commit/8de738a3ae06f3844ba8009eff066efa1ae6c075), [`be404f0`](https://github.com/VisioLab/effect-firebase/commit/be404f02335c452b86e6b31f9044b69a0b675df5), [`9883e51`](https://github.com/VisioLab/effect-firebase/commit/9883e5163e0abdb84f5c18ef34dcc1fa145747d6), [`5b3290b`](https://github.com/VisioLab/effect-firebase/commit/5b3290bc6678ddd718b48ebadd54c83e18849202), [`9eb2eff`](https://github.com/VisioLab/effect-firebase/commit/9eb2eff4a675f1b792ff6b1ec326c5a830ba52a2), [`d81a4ca`](https://github.com/VisioLab/effect-firebase/commit/d81a4ca068f4387886dd6a6a6d3f35b0a662d46c), [`d7ab3e5`](https://github.com/VisioLab/effect-firebase/commit/d7ab3e5e964125038e9c9b37e11938a0612d4e16), [`4009449`](https://github.com/VisioLab/effect-firebase/commit/4009449f20e68b725b480c680d5bcdb38aa94495), [`97f1dc3`](https://github.com/VisioLab/effect-firebase/commit/97f1dc36937da1cdf957289e97f9e2688c4d17c2), [`15ef0f7`](https://github.com/VisioLab/effect-firebase/commit/15ef0f77ed304afbf274c6cd560f14655295eb19), [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85), [`de20e4b`](https://github.com/VisioLab/effect-firebase/commit/de20e4b4e72b1e500ebf02f3539d0da433c72520), [`87a65ce`](https://github.com/VisioLab/effect-firebase/commit/87a65ceabb1bb9b81ad0a4d7d490a93808b875ad), [`5b3290b`](https://github.com/VisioLab/effect-firebase/commit/5b3290bc6678ddd718b48ebadd54c83e18849202), [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85), [`4506660`](https://github.com/VisioLab/effect-firebase/commit/450666055b6f6fb678ea316ac9205ff02186c2c6), [`a732c46`](https://github.com/VisioLab/effect-firebase/commit/a732c460f61db0aa44984dee07a57c5ecc3cc6cc), [`0eea67f`](https://github.com/VisioLab/effect-firebase/commit/0eea67fadc140cf1a8f253098a85976ddf006e73)]:
  - @visiolab/effect-firebase@0.2.0

## 0.1.0

### Minor Changes

- 6215789: Initial release. Effect bindings for Firebase: an `App` layer, a typed Firestore
  `Collection` builder, and an Admin SDK `Auth` service.

### Patch Changes

- Updated dependencies [6215789]
  - @visiolab/effect-firebase@0.1.0
