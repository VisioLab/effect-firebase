# @visiolab/effect-firebase-admin

The [`@visiolab/effect-firebase`](https://github.com/VisioLab/effect-firebase/tree/main/packages/effect-firebase) services on the Firebase Admin SDK (`firebase-admin`), for servers. In a browser, use [`@visiolab/effect-firebase-client`](https://github.com/VisioLab/effect-firebase/tree/main/packages/client) instead.

```sh
pnpm add effect @visiolab/effect-firebase @visiolab/effect-firebase-admin firebase-admin
```

## App

`App` is the Admin SDK app as an Effect service. Every other service in this package is built on it.

`App.layer` initializes the app when the layer is built and deletes it when the layer's scope closes. It takes the arguments of `initializeApp(options, name)`. With no arguments, the Admin SDK initializes the app from `FIREBASE_CONFIG` and application default credentials:

```ts
import { Effect } from "effect";
import { App } from "@visiolab/effect-firebase-admin/app";

const program = Effect.gen(function* () {
  const app = yield* App.App;
  yield* Effect.log(`Running against ${app.name}`);
});

program.pipe(Effect.provide(App.layer()));
```

An app already registered under the same name is not deleted when the scope closes. The Admin SDK only hands that app back when the request matches how it was created, though: it rejects auto-init against explicit options, and rejects reuse outright when either side carries a credential or an `httpAgent`. To use an app the host initialized, provide it directly:

```ts
import { Layer } from "effect";
import { getApp } from "firebase-admin/app";
import { App } from "@visiolab/effect-firebase-admin/app";

const AppLive = Layer.succeed(App.App, getApp());
```

## Firestore

`AdminFirestore.layer` provides one service under two keys: the portable `Firestore`, which code that runs on either SDK asks for, and `AdminFirestore`, which adds what only the Admin SDK can do. Both reach the same database:

```ts
import { Layer } from "effect";
import { App } from "@visiolab/effect-firebase-admin/app";
import { AdminFirestore } from "@visiolab/effect-firebase-admin/firestore";

const FirestoreLive = AdminFirestore.layer().pipe(Layer.provide(App.layer()));
```

Where it differs from the client SDK's:

- **The emulator comes from the environment.** The Admin SDK reads `FIRESTORE_EMULATOR_HOST`, which must be set before the database is opened and applies to every app in the process.
- **Transactions can read many documents.** A transaction body that asks for `AdminFirestore.AdminTransaction` can `getDocs` a collection or a Collection Group.
- **`preferRest`** talks HTTP/1.1 instead of gRPC until something needs gRPC, which saves start-up time in short-lived processes.

`AdminFirestore.instance` is the Admin SDK's own `Firestore`, for what the service does not wrap. `AdminFirestoreValue` maps between Firestore Values and the Admin SDK's values, to read or write a model through it.

## Auth

`Auth.layer` provides Firebase Authentication for the app in context. It wraps the calls server code uses most, such as `verifyIdToken` and the user management calls. Each fails with an `AuthError` that carries the SDK's `code`, such as `auth/user-not-found`. `Auth.use` reaches the rest of the Admin SDK:

```ts
import { Effect, Layer } from "effect";
import { App } from "@visiolab/effect-firebase-admin/app";
import { Auth } from "@visiolab/effect-firebase-admin/auth";

const makeAdmin = (idToken: string) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Auth;
    const { uid } = yield* auth.verifyIdToken(idToken, true);
    yield* auth.use((sdk) => sdk.setCustomUserClaims(uid, { admin: true }));
  });

const AuthLive = Auth.layer.pipe(Layer.provide(App.layer()));
```
