# @visiolab/effect-firebase-client

The [`@visiolab/effect-firebase`](https://github.com/VisioLab/effect-firebase/tree/main/packages/effect-firebase) services on the Firebase client SDK (`firebase`), for browsers. On a server, use [`@visiolab/effect-firebase-admin`](https://github.com/VisioLab/effect-firebase/tree/main/packages/admin) instead.

```sh
pnpm add effect @visiolab/effect-firebase @visiolab/effect-firebase-client firebase
```

## App

`App` is the client SDK app as an Effect service. Every other service in this package is built on it.

`App.layer` initializes the app when the layer is built and deletes it when the layer's scope closes. It takes the arguments of `initializeApp(options, name)`. The options are required: they are the config the Firebase console gives a web app.

```ts
import { Effect } from "effect";
import { App } from "@visiolab/effect-firebase-client";

const program = Effect.gen(function* () {
  const app = yield* App.App;
  yield* Effect.log(`Running against ${app.name}`);
});

program.pipe(
  Effect.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
);
```

An app already registered under the same name is not deleted when the scope closes. The client SDK only hands that app back when it was initialized with the same options. To use an app initialized elsewhere, provide it directly:

```ts
import { Layer } from "effect";
import { getApp } from "firebase/app";
import { App } from "@visiolab/effect-firebase-client";

const AppLive = Layer.succeed(App.App, getApp());
```

## Firestore

`ClientFirestore.layer` provides one service under two keys: the portable `Firestore`, which code that runs on either SDK asks for, and `ClientFirestore`, which adds what only the client SDK can do. Both reach the same database:

```ts
import { Layer } from "effect";
import { persistentLocalCache } from "firebase/firestore";
import { App } from "@visiolab/effect-firebase-client";
import { ClientFirestore } from "@visiolab/effect-firebase-client/firestore";

const FirestoreLive = ClientFirestore.layer({
  localCache: persistentLocalCache(),
  emulator: import.meta.env.DEV ? { host: "127.0.0.1", port: 8080 } : undefined,
}).pipe(
  Layer.provide(App.layer({ apiKey: "<api key>", projectId: "my-project", appId: "<app id>" })),
);
```

What `ClientFirestore` adds:

- **Read sources.** `getDoc` and `getDocs` take `{ source: "server" }` or `{ source: "cache" }` to read from one side alone.
- **Listen options.** `streamDoc` and `streamDocs` take `includeMetadataChanges` and a `source`.
- **Snapshot metadata.** Every snapshot carries `metadata`, with `fromCache` and `hasPendingWrites`, as `ClientDocumentSnapshot` and `ClientQuerySnapshot` describe.

Where it behaves differently from the Admin SDK's:

- **The emulator is a layer option**, connected before the database is first used, not an environment variable.
- **Writes wait for the server.** A write made offline is applied to the local cache at once, but only succeeds once the server acknowledges it. Interrupting it, or timing it out, does not take it back: the SDK still sends it when it can.
- **Pending server timestamps are estimated.** A field written with a server timestamp the server has not settled yet reads as the local clock's estimate, not `null`, so it decodes as a timestamp.
- **Error codes are always named**, such as `permission-denied`.
- **Transactions read one document at a time.** The client SDK's transactions cannot read a collection.

`ClientFirestore.instance` is the client SDK's own `Firestore`, for what the service does not wrap, such as `disableNetwork` and `enableNetwork`. `ClientFirestoreValue` maps between Firestore Values and the client SDK's values, to read or write a model through it.
