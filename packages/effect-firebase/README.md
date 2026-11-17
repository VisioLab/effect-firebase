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

## Testing

Code that only asks for the portable `Firestore` runs against the In-memory Firestore, with no emulator. Provide `Firestore.layerMemory`:

- It keeps documents in the running process. Writes are encoded and reads decoded through your models, as on the SDKs, and sentinels such as `FieldValue.serverTimestamp` and `FieldValue.increment` are resolved when a write commits.
- Each build of the layer starts empty, so a test that provides it gets a database of its own. Tests that share one build, as with `it.layer`, share its documents.
- It also provides `Firestore.MemoryDriver`, which reads and writes raw Firestore Values with no model. Use it to seed documents, including data no model would write, and to inspect what the code under test wrote.
- `serverTimestamp` reads Effect's `Clock`, and `addDoc` draws its ids from Effect's `Random`. Pin them with `TestClock` and `Random.withSeed`.

```ts
import { expect, it } from "@effect/vitest";
import { Effect, Option, Random, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  Collection,
  FieldValue,
  Firestore,
  FirestoreModel,
  Timestamp,
} from "@visiolab/effect-firebase/firestore";

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
  visits: FirestoreModel.Number(Schema.Int),
  seenAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
}) {}

const Users = Collection.make("users", User);

// The code under test asks only for the portable Firestore.
const signUp = (name: string) =>
  Effect.gen(function* () {
    const firestore = yield* Firestore.Firestore;
    return yield* firestore.addDoc(Users.collection(), {
      name,
      visits: 0,
      seenAt: FieldValue.serverTimestamp,
    });
  });

const recordVisit = (id: string) =>
  Effect.gen(function* () {
    const firestore = yield* Firestore.Firestore;
    yield* firestore.updateDoc(Users.doc(Users.id.make(id)), {
      visits: FieldValue.increment(1),
      seenAt: FieldValue.serverTimestamp,
    });
  });

it.effect("records a visit", () =>
  Effect.gen(function* () {
    const driver = yield* Firestore.MemoryDriver;
    yield* driver.set("users/alice", {
      name: "Alice",
      visits: 1,
      seenAt: Timestamp.fromMillisUnsafe(0),
    });

    yield* TestClock.setTime(Date.parse("2026-01-02T03:04:05Z"));
    yield* recordVisit("alice");

    expect(yield* driver.get("users/alice")).toStrictEqual(
      Option.some({
        name: "Alice",
        visits: 2,
        seenAt: Timestamp.fromMillisUnsafe(Date.parse("2026-01-02T03:04:05Z")),
      }),
    );
  }).pipe(Effect.provide(Firestore.layerMemory)),
);

it.effect("signs up under the same id for the same seed", () =>
  Effect.gen(function* () {
    const signUpAlice = signUp("Alice").pipe(
      Effect.provide(Firestore.layerMemory),
      Random.withSeed("ids"),
    );
    const first = yield* signUpAlice;
    const second = yield* signUpAlice;
    expect(second.id).toBe(first.id);
  }),
);
```

The In-memory Firestore provides only the portable `Firestore`. Code that asks for `AdminFirestore` or `ClientFirestore` doesn't type-check against it; test that against the emulator with the SDK's layer.

## Modules

Everything is exported from `@visiolab/effect-firebase/firestore`, and each module from its own path, such as `@visiolab/effect-firebase/firestore/Collection`.

| Module             | What it is for                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `Firestore`        | The service: read, listen to, write and update documents, and run transactions. The In-memory Firestore for tests. |
| `FirestoreModel`   | Document models, with the shapes a document is created, updated and read in.                                       |
| `FirestoreSchema`  | Schemas for Firestore's own values, such as timestamps and server-side sentinels.                                  |
| `Collection`       | Where documents live, and typed references to them.                                                                |
| `CollectionGroup`  | Every collection with the same id, read together.                                                                  |
| `DocumentSnapshot` | A document as a read found it: there or missing.                                                                   |
| `QuerySnapshot`    | The documents a read of a collection or group found.                                                               |
| `FieldValue`       | Server-side writes: `serverTimestamp`, `increment`, `arrayUnion` and the others.                                   |
| `Patch`            | `Patch.replace`, to write a nested struct whole in an update.                                                      |
| `Timestamp`        | Firestore's timestamp, to the nanosecond.                                                                          |
| `GeoPoint`         | Firestore's geographic point.                                                                                      |
| `DocumentPath`     | An untyped document reference, as Firestore stores it in a field.                                                  |
| `FirestoreValue`   | Values as Firestore stores them, and the codec models encode through.                                              |
