# @visiolab/effect-firebase-client

## 0.3.1

### Patch Changes

- [#195](https://github.com/VisioLab/effect-firebase/pull/195) [`eeed4ff`](https://github.com/VisioLab/effect-firebase/commit/eeed4ff505188865bdcc946f5b83f6a7bc93277a) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - The npm pages link to the docs at https://visiolab.github.io/effect-firebase/, and the install command for `@visiolab/effect-firebase-functions` now adds its `@visiolab/effect-firebase-admin` and `firebase-admin` peers.
- Updated dependencies [[`eeed4ff`](https://github.com/VisioLab/effect-firebase/commit/eeed4ff505188865bdcc946f5b83f6a7bc93277a)]:
  - @visiolab/effect-firebase@0.3.1

## 0.3.0

### Minor Changes

- [#154](https://github.com/VisioLab/effect-firebase/pull/154) [`eb017af`](https://github.com/VisioLab/effect-firebase/commit/eb017af4cc16c2c05bc0c481f15a22ae9b1fe1ac) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Move `App` and `Auth` into their own lowercase entries, the way `firestore` is laid out, and drop the package roots, which re-exported only them. Import `App` from `@visiolab/effect-firebase-admin/app` or `@visiolab/effect-firebase-client/app`, `Auth` from `@visiolab/effect-firebase-admin/auth`, and `defaultAppName` from `@visiolab/effect-firebase/app/App` (or `App` from `@visiolab/effect-firebase/app`). The bare package imports and the `/App` and `/Auth` subpaths are gone. The service keys follow the new paths too: `@visiolab/effect-firebase-admin/app/App`, `@visiolab/effect-firebase-client/app/App` and `@visiolab/effect-firebase-admin/auth/Auth`.

- [#138](https://github.com/VisioLab/effect-firebase/pull/138) [`ebb0378`](https://github.com/VisioLab/effect-firebase/commit/ebb03785572affe1112bf6a6b1088500b7fefa11) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `ClientFirestore` is now built on core's `Firestore.make`. Its methods and options are unchanged: read source and listen options still apply, and snapshots still carry and print Snapshot Metadata. One difference you may notice is that each `Firestore.*` span now covers encoding and decoding as well as the SDK call.

  `ClientFirestore` follows Effect's pattern for driver services such as `PgClient`: its type extends `Firestore.With` rather than `Firestore`, and its key hands back `ClientFirestore & Firestore`. Providing only a portable `Firestore` no longer removes `ClientFirestore` from an effect's requirements.

- [#193](https://github.com/VisioLab/effect-firebase/pull/193) [`9c7e0d5`](https://github.com/VisioLab/effect-firebase/commit/9c7e0d53ac16feca7195d73dc5979409568a8e46) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add the `functions` entry with `ClientFunctions` and `CallableClient`. `CallableClient.make(Greet)` calls a Callable through `httpsCallable`, with its Payload and success value typed and sent through `Schema.toCodecJson`.

  `CallableClient.make(Users)` builds the client of a Function Group: one function per Callable member, each calling `<group>-<name>`. Members of other kinds, such as Document Triggers, get none.

  A declared error comes back as its own class, so `Effect.catchTag` recovers from it, and so do the errors of a Callable's middleware, such as `Unauthenticated` from `Caller.Authenticated`. Every other failure is a `CallableError` with a `TransportError`, `ResponseError`, `DecodeError` or `EncodeError` reason. A `TransportError` means no answer arrived: a network failure, the SDK's own timeout, or a cancelled call. A `deadline-exceeded` the server sends is a `ResponseError`.

  Every `CallableClient` call runs in a `kind: "client"` span named `CallableClient.<deployed name>`.

### Patch Changes

- [#185](https://github.com/VisioLab/effect-firebase/pull/185) [`bd7d20a`](https://github.com/VisioLab/effect-firebase/commit/bd7d20a6d49a82004c5dc78d04267a5e13629259) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - All packages now release together under one version, so `@visiolab/effect-firebase-client` and `@visiolab/effect-firebase-functions` skip ahead to 0.3.0. Install every `@visiolab/effect-firebase*` package at the same version: each one works with the core version it shares a number with.

- [#194](https://github.com/VisioLab/effect-firebase/pull/194) [`303319c`](https://github.com/VisioLab/effect-firebase/commit/303319c6aac7b17def21ea650e8141dca9897d79) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Packages now publish publicly to npmjs.com instead of GitHub Packages, so installing them needs no token or `.npmrc` mapping. Remove any `@visiolab:registry=https://npm.pkg.github.com` line from your `.npmrc`.
- Updated dependencies [[`eb017af`](https://github.com/VisioLab/effect-firebase/commit/eb017af4cc16c2c05bc0c481f15a22ae9b1fe1ac), [`ebb0378`](https://github.com/VisioLab/effect-firebase/commit/ebb03785572affe1112bf6a6b1088500b7fefa11), [`bd7d20a`](https://github.com/VisioLab/effect-firebase/commit/bd7d20a6d49a82004c5dc78d04267a5e13629259), [`9c7e0d5`](https://github.com/VisioLab/effect-firebase/commit/9c7e0d53ac16feca7195d73dc5979409568a8e46), [`303319c`](https://github.com/VisioLab/effect-firebase/commit/303319c6aac7b17def21ea650e8141dca9897d79), [`ebb0378`](https://github.com/VisioLab/effect-firebase/commit/ebb03785572affe1112bf6a6b1088500b7fefa11)]:
  - @visiolab/effect-firebase@0.3.0

## 0.1.0

### Minor Changes

- [#81](https://github.com/VisioLab/effect-firebase/pull/81) [`5b3290b`](https://github.com/VisioLab/effect-firebase/commit/5b3290bc6678ddd718b48ebadd54c83e18849202) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `ClientFirestore` writes and reads documents through `toCodecFirestore`. A
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
  const encoded = Schema.encodeSync(FirestoreValue.toCodecFirestore(Event))(event);
  await setDoc(doc(firestore, "events/e"), ClientFirestoreValue.toClient(encoded, firestore));
  ```

  `ClientFirestoreValue.fromClient` goes the other way, from what the client SDK
  read to Firestore Values. A document reference read back is the
  `DocumentPath` it points at, and `toClient` writes a `DocumentPath` as
  `doc(firestore, path)`.

  The `effect` peer dependency is pinned to `4.0.4`, as the core package's is.

- [#70](https://github.com/VisioLab/effect-firebase/pull/70) [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `ClientFirestore`: a `Firestore` that also offers what only the client SDK
  can do, in the `firestore/ClientFirestore` module. Its `layer` provides one service under both the `ClientFirestore` and
  the portable `Firestore` tag. `ClientFirestore.instance` is the client SDK's own
  Firestore object, for what this library does not wrap, such as turning the
  network off and on.

- [#70](https://github.com/VisioLab/effect-firebase/pull/70) [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `ClientFirestore`'s `streamDoc` and `streamDocs` take optional
  `ListenOptions`, named as in the client SDK's listen options.
  `includeMetadataChanges: true` also emits when only the Snapshot Metadata
  changes, such as when the server acknowledges a pending write, and
  `source: "cache"` listens to the local cache alone, never reaching the server.
  Without options, streams behave as before. The portable `Firestore` streams take
  no options, since the Admin SDK's listeners have none.

- [#70](https://github.com/VisioLab/effect-firebase/pull/70) [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `ClientFirestore`'s `getDoc` and `getDocs` take optional `ReadOptions`, whose
  `source` says where a one-off read is served from: `"default"` (what a read
  does without options), `"server"` (fails when the server can't be reached) or
  `"cache"` (the local cache alone).

  Cache misses behave as they do in the SDK: a cached `getDoc` of a document the
  cache has never seen fails with a `FirestoreError` coded `unavailable`, while
  one the cache knows was deleted reads as `Missing`. A cached `getDocs` never
  fails for a miss, and hands back whatever the cache holds, possibly nothing,
  with `fromCache: true`. The portable `Firestore` is unchanged.

- [#59](https://github.com/VisioLab/effect-firebase/pull/59) [`2e2e009`](https://github.com/VisioLab/effect-firebase/commit/2e2e0099ed0ab3b5746fbfdb6352f83f8fb0bd53) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add the Firebase client SDK implementation: `App.layer` initializes a client
  SDK app for the lifetime of the layer, and `firestore/ClientFirestore.layer`
  provides the shared `Firestore` service over it. The layer takes the emulator to connect to and the
  local cache to keep, and reads documents with pending server timestamps
  estimated.

- [#70](https://github.com/VisioLab/effect-firebase/pull/70) [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Every snapshot read through `ClientFirestore` carries its Snapshot Metadata:
  `metadata.fromCache` says whether it was served from the local cache, and
  `metadata.hasPendingWrites` whether it reflects writes the server has not
  acknowledged yet.

  The new `firestore/ClientDocumentSnapshot` module holds `Existing` and
  `Missing`, which extend the portable variants with `metadata`, and the new
  `firestore/ClientQuerySnapshot` module holds `ClientQuerySnapshot`, which
  extends the portable `QuerySnapshot` with the metadata of the read as a whole -
  the only place an empty result says where it came from. `ClientFirestore`'s
  `getDoc`, `getDocs`, `streamDoc` and `streamDocs` return or emit these, and
  stay assignable to the portable `Firestore`. Reads inside a transaction keep
  handing back the portable snapshots.

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

- [#114](https://github.com/VisioLab/effect-firebase/pull/114) [`2cc242d`](https://github.com/VisioLab/effect-firebase/commit/2cc242d8950eedfd54b35d9830aacc8f5e66680a) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Require `effect` `~4.1.0` as the peer dependency, up from exactly 4.0.6. Any
  4.1.x patch release now satisfies it, so a consumer no longer has to match the
  exact `effect` version this library was released with.

- [#58](https://github.com/VisioLab/effect-firebase/pull/58) [`be404f0`](https://github.com/VisioLab/effect-firebase/commit/be404f02335c452b86e6b31f9044b69a0b675df5) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `Firestore.streamDoc` and `Firestore.streamDocs`, which listen to a
  document or a collection and emit a snapshot - what `getDoc` or `getDocs` would
  hand back - each time it changes. Running the stream attaches a listener of its
  own, which is detached once the stream stops; a reader that falls behind sees
  the latest snapshot rather than every one in between, and the stream fails with
  a `FirestoreError` when Firestore drops the listener. The Admin and client SDKs
  implement them in `firestore/AdminFirestore.layer` and
  `firestore/ClientFirestore.layer`; the client SDK emits its own
  writes as soon as it makes them, before the database acknowledges them.

- [#70](https://github.com/VisioLab/effect-firebase/pull/70) [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Reading many documents hands back a `QuerySnapshot` rather than a bare array.
  The new `firestore/QuerySnapshot` module holds the documents a read found in
  `docs`, with `QuerySnapshot.make` and `QuerySnapshot.isQuerySnapshot`.
  `Firestore.getDocs` returns one and `Firestore.streamDocs` emits them, and both
  the Admin and client SDKs implement the new shape.

  Breaking: read the documents from `snapshot.docs` where `getDocs` or
  `streamDocs` used to hand back the array itself.

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

### Patch Changes

- [#115](https://github.com/VisioLab/effect-firebase/pull/115) [`209a22d`](https://github.com/VisioLab/effect-firebase/commit/209a22d3596fe89e2340c53b63b6c3cc96ce958f) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Brand the error classes (`FirestoreError`, `UndefinedCollectionError`, `AppError`,
  `AuthError`), so TypeScript no longer accepts a plain object of the same shape
  where one is expected. Construct them with `new` as before.
- Updated dependencies [[`378c409`](https://github.com/VisioLab/effect-firebase/commit/378c4090ed74dd9f4add769e5d336f66bc714018), [`209a22d`](https://github.com/VisioLab/effect-firebase/commit/209a22d3596fe89e2340c53b63b6c3cc96ce958f), [`8a32e3f`](https://github.com/VisioLab/effect-firebase/commit/8a32e3f63668346aa7c5b1afda46fd1fe49ad609), [`4df4327`](https://github.com/VisioLab/effect-firebase/commit/4df432771304eb5ef80ea71e299cf75c5d058dcb), [`4df4327`](https://github.com/VisioLab/effect-firebase/commit/4df432771304eb5ef80ea71e299cf75c5d058dcb), [`5d9dc0f`](https://github.com/VisioLab/effect-firebase/commit/5d9dc0f93a9304a12c12d1e2df6a68cb209e064d), [`6ad9e48`](https://github.com/VisioLab/effect-firebase/commit/6ad9e481f0ef04994fdcbfe6635b29021e4be398), [`1e3d2ae`](https://github.com/VisioLab/effect-firebase/commit/1e3d2ae47f2bc22e3c9bd3e418da99415486386b), [`2cc242d`](https://github.com/VisioLab/effect-firebase/commit/2cc242d8950eedfd54b35d9830aacc8f5e66680a), [`8de738a`](https://github.com/VisioLab/effect-firebase/commit/8de738a3ae06f3844ba8009eff066efa1ae6c075), [`be404f0`](https://github.com/VisioLab/effect-firebase/commit/be404f02335c452b86e6b31f9044b69a0b675df5), [`9883e51`](https://github.com/VisioLab/effect-firebase/commit/9883e5163e0abdb84f5c18ef34dcc1fa145747d6), [`5b3290b`](https://github.com/VisioLab/effect-firebase/commit/5b3290bc6678ddd718b48ebadd54c83e18849202), [`9eb2eff`](https://github.com/VisioLab/effect-firebase/commit/9eb2eff4a675f1b792ff6b1ec326c5a830ba52a2), [`d81a4ca`](https://github.com/VisioLab/effect-firebase/commit/d81a4ca068f4387886dd6a6a6d3f35b0a662d46c), [`d7ab3e5`](https://github.com/VisioLab/effect-firebase/commit/d7ab3e5e964125038e9c9b37e11938a0612d4e16), [`4009449`](https://github.com/VisioLab/effect-firebase/commit/4009449f20e68b725b480c680d5bcdb38aa94495), [`97f1dc3`](https://github.com/VisioLab/effect-firebase/commit/97f1dc36937da1cdf957289e97f9e2688c4d17c2), [`15ef0f7`](https://github.com/VisioLab/effect-firebase/commit/15ef0f77ed304afbf274c6cd560f14655295eb19), [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85), [`de20e4b`](https://github.com/VisioLab/effect-firebase/commit/de20e4b4e72b1e500ebf02f3539d0da433c72520), [`87a65ce`](https://github.com/VisioLab/effect-firebase/commit/87a65ceabb1bb9b81ad0a4d7d490a93808b875ad), [`5b3290b`](https://github.com/VisioLab/effect-firebase/commit/5b3290bc6678ddd718b48ebadd54c83e18849202), [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85), [`4506660`](https://github.com/VisioLab/effect-firebase/commit/450666055b6f6fb678ea316ac9205ff02186c2c6), [`a732c46`](https://github.com/VisioLab/effect-firebase/commit/a732c460f61db0aa44984dee07a57c5ecc3cc6cc), [`0eea67f`](https://github.com/VisioLab/effect-firebase/commit/0eea67fadc140cf1a8f253098a85976ddf006e73)]:
  - @visiolab/effect-firebase@0.2.0
