# @visiolab/effect-firebase-client

Firebase client SDK (`firebase`) implementation of the
[`@visiolab/effect-firebase`](https://github.com/VisioLab/effect-firebase/tree/main/packages/effect-firebase) services.

## App

`App` is the Firebase client SDK app as an Effect service. `App.layer`
initializes the app when the layer is built and deletes it again when the
layer's scope closes:

```ts
import { App } from "@visiolab/effect-firebase-client";

App.layer({ apiKey: "...", projectId: "my-project", appId: "..." });
```

An app that is already registered under the same name, with the same options,
is left alone when the scope closes rather than deleted.

## Firestore

`firestore/ClientFirestore.layer` provides `ClientFirestore` for the app in
context. It is the portable `Firestore` plus what only the client SDK can do,
and the layer provides the same object under both tags, so portable code asks
for `Firestore` and client-specific code for `ClientFirestore`:

```ts
import { ClientFirestore } from "@visiolab/effect-firebase-client/firestore";
import { persistentLocalCache } from "firebase/firestore";

ClientFirestore.layer({
  localCache: persistentLocalCache(),
  emulator: import.meta.env.DEV ? { host: "127.0.0.1", port: 8080 } : undefined,
});
```

Where it behaves differently from the Admin SDK's:

- **The emulator is a layer option**, connected before the database is first
  used, rather than an environment variable.
- **Writes wait for the server.** A write made offline is applied to the local
  cache straight away but only succeeds once the server acknowledges it.
  Interrupting it, or timing it out, does not take it back: the SDK still sends
  it when it can.
- **Pending server timestamps are estimated.** A document read before the server
  has settled a `serverTimestamp` it was written with reads that field as the
  local clock's estimate rather than `null`, so it decodes as a timestamp.
- **Error codes are always named**, such as `permission-denied`.

`ClientFirestore.instance` is the client SDK's own `Firestore` object, for what
this library does not wrap, such as `disableNetwork` and `enableNetwork`.
