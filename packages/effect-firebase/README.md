# @visiolab/effect-firebase

Typed Firestore collections and Firebase services for [Effect](https://effect.website), independent of any Firebase SDK.

This package defines the services and the document models. Two packages implement them:

| Package                                                                                                     | Runs on               | SDK              |
| ----------------------------------------------------------------------------------------------------------- | --------------------- | ---------------- |
| [`@visiolab/effect-firebase-admin`](https://github.com/VisioLab/effect-firebase/tree/main/packages/admin)   | servers and functions | `firebase-admin` |
| [`@visiolab/effect-firebase-client`](https://github.com/VisioLab/effect-firebase/tree/main/packages/client) | browsers and apps     | `firebase`       |

Code written against this package, such as models, collections and the portable `Firestore` service, runs unchanged on either.

## Install

```sh
pnpm add effect @visiolab/effect-firebase @visiolab/effect-firebase-admin firebase-admin
# or, in a browser or app
pnpm add effect @visiolab/effect-firebase @visiolab/effect-firebase-client firebase
```

## Example

Define a document with `FirestoreModel.Class`, where it lives with `Collection.make`, and read and write it through the `Firestore` service:

```ts
import { Effect, Layer, Schema } from "effect";
import {
  Collection,
  DocumentSnapshot,
  Firestore,
  FirestoreModel,
} from "@visiolab/effect-firebase/firestore";
import { App } from "@visiolab/effect-firebase-admin/app";
import { AdminFirestore } from "@visiolab/effect-firebase-admin/firestore";

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
  visits: FirestoreModel.Number(Schema.Int),
}) {}

const Users = Collection.make("users", User);

const program = Effect.gen(function* () {
  const firestore = yield* Firestore.Firestore;
  const alice = Users.doc(Users.id.make("alice"));

  yield* firestore.setDoc(alice, { name: "Alice", visits: 0 });

  const snapshot = yield* firestore.getDoc(alice);
  if (DocumentSnapshot.isExisting(snapshot)) {
    const user = yield* snapshot.data;
    yield* Effect.log(`${user.name} has visited ${user.visits} times`);
  }
});

const FirestoreLive = AdminFirestore.layer().pipe(Layer.provide(App.layer()));

Effect.runPromise(program.pipe(Effect.provide(FirestoreLive)));
```

`program` only asks for the portable `Firestore`, so providing `ClientFirestore.layer` from `@visiolab/effect-firebase-client` runs it on the client SDK instead.

## Modules

Everything is exported from `@visiolab/effect-firebase/firestore`, and each module from its own path, such as `@visiolab/effect-firebase/firestore/Collection`.

| Module             | What it is for                                                                    |
| ------------------ | --------------------------------------------------------------------------------- |
| `Firestore`        | The service: read, listen to, write and update documents, and run transactions.   |
| `FirestoreModel`   | Document models, with the shapes a document is created, updated and read in.      |
| `FirestoreSchema`  | Schemas for Firestore's own values, such as timestamps and server-side sentinels. |
| `Collection`       | Where documents live, and typed references to them.                               |
| `CollectionGroup`  | Every collection with the same id, read together.                                 |
| `DocumentSnapshot` | A document as a read found it: there or missing.                                  |
| `QuerySnapshot`    | The documents a read of a collection or group found.                              |
| `FieldValue`       | Server-side writes: `serverTimestamp`, `increment`, `arrayUnion` and the others.  |
| `Patch`            | `Patch.replace`, to write a nested struct whole in an update.                     |
| `Timestamp`        | Firestore's timestamp, to the nanosecond.                                         |
| `GeoPoint`         | Firestore's geographic point.                                                     |
| `DocumentPath`     | An untyped document reference, as Firestore stores it in a field.                 |
| `FirestoreValue`   | Values as Firestore stores them, and the codec models encode through.             |
