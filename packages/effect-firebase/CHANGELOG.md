# @visiolab/effect-firebase

## 0.3.1

### Patch Changes

- [#195](https://github.com/VisioLab/effect-firebase/pull/195) [`eeed4ff`](https://github.com/VisioLab/effect-firebase/commit/eeed4ff505188865bdcc946f5b83f6a7bc93277a) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - The npm pages link to the docs at https://visiolab.github.io/effect-firebase/, and the install command for `@visiolab/effect-firebase-functions` now adds its `@visiolab/effect-firebase-admin` and `firebase-admin` peers.

## 0.3.0

### Minor Changes

- [#154](https://github.com/VisioLab/effect-firebase/pull/154) [`eb017af`](https://github.com/VisioLab/effect-firebase/commit/eb017af4cc16c2c05bc0c481f15a22ae9b1fe1ac) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Move `App` and `Auth` into their own lowercase entries, the way `firestore` is laid out, and drop the package roots, which re-exported only them. Import `App` from `@visiolab/effect-firebase-admin/app` or `@visiolab/effect-firebase-client/app`, `Auth` from `@visiolab/effect-firebase-admin/auth`, and `defaultAppName` from `@visiolab/effect-firebase/app/App` (or `App` from `@visiolab/effect-firebase/app`). The bare package imports and the `/App` and `/Auth` subpaths are gone. The service keys follow the new paths too: `@visiolab/effect-firebase-admin/app/App`, `@visiolab/effect-firebase-client/app/App` and `@visiolab/effect-firebase-admin/auth/Auth`.

- [#138](https://github.com/VisioLab/effect-firebase/pull/138) [`ebb0378`](https://github.com/VisioLab/effect-firebase/commit/ebb03785572affe1112bf6a6b1088500b7fefa11) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Build a `Firestore` for any backend with `Firestore.make`. A backend supplies Effect-native hooks that read and write Firestore Values by document path, and core does the rest: models, snapshots, Collection Groups, spans and transactions. `Firestore.transactionFromCallback` and `Firestore.streamFromListener` wrap an SDK that runs transactions as callbacks or listens through callbacks. The Admin and client packages are now built this way.

  What `make` returns is typed from its hooks, as a `Firestore.With<ReadOptions, ListenOptions, Extra, TransactionServices>`. The options a backend's reads take, what its snapshots carry beyond the portable ones, and the services a transaction body can ask for all stay in the type, and a backend's own service extends `Firestore.With`. What `make` returns is always a portable `Firestore` too, so it can be provided as one. The portable `Firestore` and `Transaction` now carry a type id, so a backend's own service and transaction types, which extend `Firestore.With` and the new `Firestore.TransactionBase`, stay apart from them in an effect's requirements. Everything `make` takes is `@stability unstable`.

- [#193](https://github.com/VisioLab/effect-firebase/pull/193) [`9c7e0d5`](https://github.com/VisioLab/effect-firebase/commit/9c7e0d53ac16feca7195d73dc5979409568a8e46) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add the `functions` entry, which declares server Functions in code shared by server and client, with no Firebase SDK import. A Function is a `FirebaseFunction` of a kind: a Callable or a Document Trigger.

  - `Callable.make` declares a Callable once, as its name, its Payload and its success value. `Callable.toLayer` implements it as a Layer, and `Callable.handler` runs a handler behind its middleware chain in process.
  - A Callable declares the errors it can fail with in `error`. `Callable.errorCode` and the `callableErrorCode` annotation give an error its Firebase error code, and `CallableError` adds built-in errors such as `NotFound` and `PermissionDenied`.
  - `CallableMiddleware`, `CallableRequest` and `Caller`: `.middleware(M)` attaches Callable Middleware to a Callable. It runs before the Payload is decoded; its `provides` leave the handler's Layer and its errors join the Callable's. The built-in `Caller.Authenticated` provides the `Caller` and fails a signed-out call with `Unauthenticated`. `CallableRequest.rawRequest` is the HTTP request a call came in, as Effect's `HttpServerRequest`, for middleware that reads headers or the caller's `remoteAddress`.
  - `FunctionGroup.make("users").add(...)` collects Functions of any kind, Callables and Document Triggers together, that deploy as `users-<name>`. `Callable.toLayer(Users, "create", handler)` and `DocumentTrigger.toLayer(Users, "onCreated", handler)` implement a member. `FunctionGroup.Members`, `Names` and `Member` take an optional kind, such as `FunctionGroup.Members<typeof Users, Callable.Any>`, to keep only the members of that kind. A group carries no middleware: attach it to each Callable that needs it.
  - `Callable.deployment` gives a Callable's deployed name and span attributes, which the functions and client packages share. `DocumentTrigger.deployment` gives a trigger's deployed name and document path pattern.

  Document Triggers run when a document of a collection changes:

  - `DocumentTrigger.created`, `deleted`, `updated` and `written(name, collection)` declare a trigger from a name and a `Collection` definition. Each event carries the document's typed Document Reference (`ref`, whose `ancestors` and `id` hold the path's ids) and the CloudEvent's `id` and `time`. A `created` or `deleted` event hands over the document as an existing Document Snapshot (`snapshot`), as it was just before it was deleted for `deleted`. An `updated` event hands over `before` and `after`, both existing. A `written` event runs on a create, an update and a delete: `before` is `Missing` on a create and `after` is `Missing` on a delete, narrowed with `DocumentSnapshot.isExisting` or `DocumentSnapshot.isMissing`. Snapshot data decodes through the collection's model when it is read.
  - `DocumentTrigger.toLayer(trigger, handler | Effect<handler>)` implements a trigger, and `DocumentTrigger.serve` runs an event through its handler in process. Build test events with `DocumentTrigger.createdEvent`, `deletedEvent`, `updatedEvent` or `writtenEvent` and `DocumentSnapshot.existing`.

  Firebase delivers each event at least once, so make handlers idempotent, keyed on the event's `id`.

- [#138](https://github.com/VisioLab/effect-firebase/pull/138) [`ebb0378`](https://github.com/VisioLab/effect-firebase/commit/ebb03785572affe1112bf6a6b1088500b7fefa11) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `DocumentSnapshot.make`, `DocumentSnapshot.existing`, `DocumentSnapshot.missing` and `QuerySnapshot.make` take an optional `extra`: an SDK passes what it knows about a read beyond the portable snapshot, and each of its fields is put on the snapshot and shown when it prints. Snapshots built without one are unchanged.

  `QuerySnapshot` takes the extra its documents carry as a second type argument, `QuerySnapshot<C, DocumentExtra>`, whose `docs` are each `Existing<C> & DocumentExtra`. The query snapshot's own extra stays an intersection, as `QuerySnapshot<C, E> & E`. `QuerySnapshot<C>` means what it did. `QuerySnapshot.make` infers it from the documents it is given, so a query snapshot built from snapshots with an extra keeps it in its type.

### Patch Changes

- [#185](https://github.com/VisioLab/effect-firebase/pull/185) [`bd7d20a`](https://github.com/VisioLab/effect-firebase/commit/bd7d20a6d49a82004c5dc78d04267a5e13629259) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - All packages now release together under one version, so `@visiolab/effect-firebase-client` and `@visiolab/effect-firebase-functions` skip ahead to 0.3.0. Install every `@visiolab/effect-firebase*` package at the same version: each one works with the core version it shares a number with.

- [#194](https://github.com/VisioLab/effect-firebase/pull/194) [`303319c`](https://github.com/VisioLab/effect-firebase/commit/303319c6aac7b17def21ea650e8141dca9897d79) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Packages now publish publicly to npmjs.com instead of GitHub Packages, so installing them needs no token or `.npmrc` mapping. Remove any `@visiolab:registry=https://npm.pkg.github.com` line from your `.npmrc`.

## 0.2.0

### Minor Changes

- [#43](https://github.com/VisioLab/effect-firebase/pull/43) [`378c409`](https://github.com/VisioLab/effect-firebase/commit/378c4090ed74dd9f4add769e5d336f66bc714018) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Let an update grow or shrink an array with `FieldValue.arrayUnion` and
  `FieldValue.arrayRemove`. `FirestoreModel.Array(item)` takes either in an
  update, and `FirestoreSchema` gains `ArrayUnion`, `ArrayRemove` and `ArrayOr`.

- [#48](https://github.com/VisioLab/effect-firebase/pull/48) [`8a32e3f`](https://github.com/VisioLab/effect-firebase/commit/8a32e3f63668346aa7c5b1afda46fd1fe49ad609) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `FirestoreModel` updates only take patches that are safe for any stored document. A document may go without an `Optional` struct, and a patch into one that is missing creates the struct holding only what the patch carried, so the document no longer reads. `update` now writes an `Optional` struct whole with the new `Patch.replace`, or removes it with `FieldValue.deleteField`, and never patches it.

  The new `firestore/Patch` module says how a patch writes a struct: a plain object is written field by field at its paths, as before, and `Patch.replace(value)` writes the struct whole, as `set` would, constructor defaults filled in. It works on any struct, in either mode, unless the struct holds a field that `set` or an update leaves out (`Immutable`, or one only ever read), which replacing it would change or drop.

  Breaking: a patch into an `Optional` struct is now a type error, and its encoding is rejected. Use `Patch.replace` to write the struct whole, or the new `updateUnchecked` where the struct is known to be there (an earlier read, a query, a transaction). `updateUnchecked` takes every patch `update` takes and writes it the same, plus patches into `Optional` structs. `UpdateFields`, `UpdatePaths` and `Update` take an `UpdateMode` (`"checked"` by default, or `"unchecked"`), and `UpdatePaths`' prefix moves to its third parameter. A struct's own path now takes the struct written whole where it may be replaced.

- [#109](https://github.com/VisioLab/effect-firebase/pull/109) [`4df4327`](https://github.com/VisioLab/effect-firebase/commit/4df432771304eb5ef80ea71e299cf75c5d058dcb) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Every `Collection` definition has a `contains` guard that tells whether a
  `DocumentReference`, or an `Existing` or `Missing` snapshot, belongs to that
  collection, and narrows it to that collection's id, ancestors, reference and
  data. Two definitions are the same collection only when they are the same
  object, so one built separately with the same path is another collection. The
  guard is bound, so `snapshot.docs.filter(Posts.contains)` works and narrows the
  element type.

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

- [#53](https://github.com/VisioLab/effect-firebase/pull/53) [`5d9dc0f`](https://github.com/VisioLab/effect-firebase/commit/5d9dc0f93a9304a12c12d1e2df6a68cb209e064d) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `Collection.make` and `subcollection` take a `FirestoreModel` rather than any
  schema, so every collection carries the `create` and `update` shapes its
  documents are written in, not just the one they are read in.

  Breaking: a collection defined over a plain schema, such as a `Schema.Struct`,
  no longer compiles. Declare its documents with `FirestoreModel.Class` instead.

- [#44](https://github.com/VisioLab/effect-firebase/pull/44) [`6ad9e48`](https://github.com/VisioLab/effect-firebase/commit/6ad9e481f0ef04994fdcbfe6635b29021e4be398) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `FirestoreSchema.DocumentReference(collection)` for fields holding a
  document reference.

- [#52](https://github.com/VisioLab/effect-firebase/pull/52) [`1e3d2ae`](https://github.com/VisioLab/effect-firebase/commit/1e3d2ae47f2bc22e3c9bd3e418da99415486386b) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `firestore/DocumentSnapshot`, what a read hands back: the typed `ref` a
  document was read at, its `id`, and either the `raw` data the SDK read
  (`Existing`) or nothing (`Missing`). `data` decodes `raw` through the collection's
  schema only when it is run, so telling whether a document is there, or which one
  it is, never touches the schema. `make(ref, raw)` builds one from what an SDK's
  `snapshot.data()` returns.

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

- [#81](https://github.com/VisioLab/effect-firebase/pull/81) [`5b3290b`](https://github.com/VisioLab/effect-firebase/commit/5b3290bc6678ddd718b48ebadd54c83e18849202) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `FirestoreValue`, which makes Firestore a canonical format the way JSON is
  one. `FirestoreValue.toCodecFirestore(schema)` derives a codec from any plain
  schema to Firestore Values, needing no service and no SDK:

  ```ts
  import { FirestoreValue } from "@visiolab/effect-firebase/firestore";
  import { Schema } from "effect";

  const User = Schema.Struct({ name: Schema.String, joinedAt: Schema.DateTimeUtc });

  // { name: "Ada", joinedAt: Timestamp(...) }
  const encoded = Schema.encodeSync(FirestoreValue.toCodecFirestore(User))(user);
  ```

  `Schema.Date` and `Schema.DateTimeUtc` are written as a portable `Timestamp`
  (and read back to the millisecond), `Schema.Uint8Array` as bytes, and any
  other declaration through its `toCodecFirestore`, `toCodecJson` or `toCodec`
  annotation, so `Option`, `Duration`, `Schema.Class` and the like need no extra
  work. A `bigint` is written as a string, as in JSON. A value Firestore can't
  store fails with a schema error at its path. Unlike `Schema.toCodecJson`,
  `Schema.Any` is no escape hatch: like `Schema.Unknown`, it takes Firestore
  Values only.

  `FirestoreValue.FirestoreValue` is the union of values Firestore stores, with
  `FirestoreValue.isFirestoreValue` as its guard. `FirestoreSchema.Timestamp`
  also gains a `toCodecJson` form, `{ seconds, nanoseconds }`, so the same model
  can be sent over HTTP.

  Firestore stores a document reference as the document's path alone, so the
  union holds the new `DocumentPath` (built with `DocumentPath.make(path)`, equal
  by path) rather than a typed `Collection.DocumentReference`.
  `FirestoreSchema.DocumentReference(collection)` writes a typed reference as its
  `DocumentPath` and reads one back into `collection`, failing on a path outside
  it. Under `Schema.Unknown` a typed reference is refused like any other value
  that isn't a Firestore Value. `FirestoreSchema.DocumentPath` is the schema
  for a field that holds the path itself.

  The `effect` peer range is pinned to `4.0.4`, since the derivation builds on
  Effect internals a patch release may change.

- [#20](https://github.com/VisioLab/effect-firebase/pull/20) [`9eb2eff`](https://github.com/VisioLab/effect-firebase/commit/9eb2eff4a675f1b792ff6b1ec326c5a830ba52a2) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Rename the Firestore entry to `firestore`, and stop re-exporting it from the
  root. `Collection` is now reached through `@visiolab/effect-firebase/firestore`
  or `@visiolab/effect-firebase/firestore/Collection` rather than through the
  package root.

- [#39](https://github.com/VisioLab/effect-firebase/pull/39) [`d81a4ca`](https://github.com/VisioLab/effect-firebase/commit/d81a4ca068f4387886dd6a6a6d3f35b0a662d46c) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - `FirestoreModel` updates reach into nested structs: `update` takes a nested
  partial and writes each field at its path (`{ address: { city } }` →
  `{ "address.city": city }`). `Optional` now accepts a struct, which an update can
  remove with `FieldValue.deleteField`.

  Breaking: `update` is now a transformation, not a struct. Use `update.to` for
  the patch and `update.from` for the paths.

- [#27](https://github.com/VisioLab/effect-firebase/pull/27) [`d7ab3e5`](https://github.com/VisioLab/effect-firebase/commit/d7ab3e5e964125038e9c9b37e11938a0612d4e16) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Require `effect` `^4.0.1`.

- [#37](https://github.com/VisioLab/effect-firebase/pull/37) [`4009449`](https://github.com/VisioLab/effect-firebase/commit/4009449f20e68b725b480c680d5bcdb38aa94495) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Let a timestamp field say how the instant is held.

  `FirestoreSchema.TimestampOrServer` becomes `ServerTimestampOr`, which takes the
  schema a field is read through and hands back the one it is written through, and
  `FirestoreModel.Timestamp` takes that schema too. This is what
  `FirestoreModel.Number` already does for a number.

  ```ts
  createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp);
  seenAt: FirestoreModel.Timestamp(Schema.DateTimeUtc);
  ```

  A field held as a `DateTime.Utc` no longer has to be declared variant by variant
  to keep the server sentinel: the schema goes into the read as it stands and into
  both writes beside the sentinel.

  `FirestoreModel.Timestamp` was a field and is now a function, so a declaration
  that named it bare has to hand it `FirestoreSchema.Timestamp` to read as before.

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

- [#47](https://github.com/VisioLab/effect-firebase/pull/47) [`87a65ce`](https://github.com/VisioLab/effect-firebase/commit/87a65ceabb1bb9b81ad0a4d7d490a93808b875ad) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `FirestoreModel.Record(key, value)`, a map field an update writes key by key. It is read and created as `Schema.Record(key, value)`. An update writes each key at its own path, in the value's update form: `{ votes: { pizza: FieldValue.increment(1) } }` becomes `{ "votes.pizza": <increment> }`. `arrayUnion`, `serverTimestamp`, nested structs and nested Records work the same way.

  With string keys, any key may be missing, so each key also takes `FieldValue.deleteField`. A struct or Record held at a key is written whole with `Patch.replace` or removed, and only `updateUnchecked` patches it, as with an `Optional` struct. With a union of literals as keys, the Record holds every key and is updated like a struct with one field per key. A whole Record takes `Patch.replace`, and an `Optional` Record also takes `deleteField`.

  Paths use each key's encoded form. The key schema encodes them as part of the update, so any service it needs becomes a requirement of the update. A key that is empty or contains `.`, before or after encoding, fails the update. A literal key written that way throws as soon as the Record is declared.

  `FirestoreModel` also exports `Value`, the union of everything a field can be declared as, which `Optional` and `Record` accept.

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

- [#70](https://github.com/VisioLab/effect-firebase/pull/70) [`5aa0256`](https://github.com/VisioLab/effect-firebase/commit/5aa0256f65793bfcd7004a6557153349d3b70e85) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Remove the portable `App` service and its interface: nothing provided it and
  nothing asked for it. `defaultAppName` stays exported from
  `@visiolab/effect-firebase/App`. The SDK packages keep their own `App`.

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

- [#46](https://github.com/VisioLab/effect-firebase/pull/46) [`a732c46`](https://github.com/VisioLab/effect-firebase/commit/a732c460f61db0aa44984dee07a57c5ecc3cc6cc) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Keep constructor defaults out of a `FirestoreModel` update. A field declared with `Schema.withConstructorDefault` used to have its default filled in by `update.make` whenever the key was left out, so the update overwrote a field nobody touched. Defaults now apply only where a document is created, at every depth.

## 0.1.0

### Minor Changes

- 6215789: Initial release. Effect bindings for Firebase: an `App` layer, a typed Firestore
  `Collection` builder, and an Admin SDK `Auth` service.
