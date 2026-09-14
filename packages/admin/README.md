# @effect-firebase/admin

Firebase Admin SDK implementation of the [`effect-firebase`](../effect-firebase) services.

## App

`App` is the Firebase Admin SDK app as an Effect service. `App.layer`
initializes the app when the layer is built and deletes it again when the
layer's scope closes:

```ts
import * as App from "@effect-firebase/admin/App";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const app = yield* App.App;
  yield* Effect.log(`Running against ${app.name}`);
});

program.pipe(Effect.provide(App.layer()));
```

`layer` mirrors `initializeApp(options, name)`. Called with no arguments it
initializes the app the way the Admin SDK does by default, from
`FIREBASE_CONFIG` and application default credentials; pass either argument to
configure it:

```ts
App.layer({ projectId: "my-project" }, "secondary");
App.layer(undefined, "secondary"); // default behaviour, under a name
```

An app that is already registered under the same name is left alone when the
scope closes rather than deleted. Reusing it that way is narrow, though: the
Admin SDK rejects auto-init against explicit options, and rejects reuse outright
when either side carries a credential or an `httpAgent` - which covers the usual
`initializeApp({ credential: cert(...) })` host setup. To pick up an app the host
initialized, provide it directly:

```ts
import { getApp } from "firebase-admin/app";
import { Layer } from "effect";

const AppLive = Layer.succeed(App.App, getApp());
```
