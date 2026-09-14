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

program.pipe(Effect.provide(App.layer));
```

`layer` initializes the app the way the Admin SDK does by default, from
`FIREBASE_CONFIG` and application default credentials. Use `layerOptions` -
which also takes an optional `name` - to configure it explicitly:

```ts
App.layerOptions({ projectId: "my-project", name: "secondary" });
```

An app that is already registered under the same name is adopted rather than
initialized, and is left alone when the scope closes.
