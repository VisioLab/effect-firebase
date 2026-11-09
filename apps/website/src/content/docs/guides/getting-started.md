---
title: Getting started
description: Install Effect Firebase and run a first program.
---

Effect Firebase comes as three packages:

- `@visiolab/effect-firebase` defines the services and the typed Firestore
  collections, independent of any Firebase SDK.
- `@visiolab/effect-firebase-admin` implements them on the Firebase Admin SDK,
  for servers and Cloud Functions.
- `@visiolab/effect-firebase-client` implements them on the Firebase client
  SDK, for browsers and apps.

Code written against the first package runs unchanged on either of the other
two.

## Install

On a server:

```sh
pnpm add effect @visiolab/effect-firebase @visiolab/effect-firebase-admin firebase-admin
```

In a browser or app:

```sh
pnpm add effect @visiolab/effect-firebase @visiolab/effect-firebase-client firebase
```

## Define a model and a collection

A model is the schema of a document. A collection says where documents of
that model live.

```ts
import { Schema } from "effect";
import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
  visits: FirestoreModel.Number(Schema.Int),
}) {}

const Users = Collection.make("users", User);
```

## Read and write documents

Ask for the `Firestore` service and pass it references built from the
collection. Writes are encoded through the model, and reads are decoded
through it.

```ts
import { Effect } from "effect";
import { DocumentSnapshot, FieldValue, Firestore } from "@visiolab/effect-firebase/firestore";

const program = Effect.gen(function* () {
  const firestore = yield* Firestore.Firestore;
  const alice = Users.doc(Users.id.make("alice"));

  yield* firestore.setDoc(alice, { name: "Alice", visits: 0 });
  yield* firestore.updateDoc(alice, { visits: FieldValue.increment(1) });

  const snapshot = yield* firestore.getDoc(alice);
  if (DocumentSnapshot.isExisting(snapshot)) {
    const user = yield* snapshot.data;
    yield* Effect.log(`${user.name} has visited ${user.visits} times`);
  }
});
```

A document that is not there is not an error: `getDoc` returns a missing
snapshot, and `DocumentSnapshot.isExisting` tells the two apart.

## Provide a backend

`program` needs a `Firestore`. Provide it with the layer of the SDK you run on.

With the Admin SDK, `App.layer()` initializes the app from `FIREBASE_CONFIG`
and application default credentials:

```ts
import { Effect, Layer } from "effect";
import { App } from "@visiolab/effect-firebase-admin/app";
import { AdminFirestore } from "@visiolab/effect-firebase-admin/firestore";

const FirestoreLive = AdminFirestore.layer().pipe(Layer.provide(App.layer()));

Effect.runPromise(program.pipe(Effect.provide(FirestoreLive)));
```

To use the emulator, set `FIRESTORE_EMULATOR_HOST` before the program runs.

With the client SDK, pass the app's config to `App.layer`:

```ts
import { Effect, Layer } from "effect";
import { App } from "@visiolab/effect-firebase-client/app";
import { ClientFirestore } from "@visiolab/effect-firebase-client/firestore";

const FirestoreLive = ClientFirestore.layer().pipe(
  Layer.provide(App.layer({ apiKey: "...", projectId: "my-project", appId: "..." })),
);

Effect.runPromise(program.pipe(Effect.provide(FirestoreLive)));
```

To use the emulator, pass `emulator: { host: "127.0.0.1", port: 8080 }` to
`ClientFirestore.layer`.

## Next steps

- [`Firestore`](../../api/effect-firebase/firestore/Firestore/): every read, write,
  listener and transaction.
- [`FirestoreModel`](../../api/effect-firebase/firestore/FirestoreModel/): optional
  fields, server timestamps, counters, unions and nested structs.
- [`Collection`](../../api/effect-firebase/firestore/Collection/): subcollections and
  typed ids.
