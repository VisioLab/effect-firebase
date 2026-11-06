# @visiolab/effect-firebase-functions

Serves the Callables of [`@visiolab/effect-firebase`](https://github.com/VisioLab/effect-firebase/tree/main/packages/effect-firebase) as Cloud Functions for Firebase, with `firebase-functions`. The client calls them with `CallableClient` from [`@visiolab/effect-firebase-client`](https://github.com/VisioLab/effect-firebase/tree/main/packages/client).

```sh
pnpm add effect @visiolab/effect-firebase @visiolab/effect-firebase-functions firebase-functions
```

## Callable Functions

Declare a Callable once, in code the server and the client share:

```ts
import { Schema } from "effect";
import { Callable } from "@visiolab/effect-firebase/functions";

export const Greet = Callable.make("greet", {
  payload: { name: Schema.String },
  success: Schema.String,
});
```

Implement it as a Layer, and export it with `CallableFunction.make`:

```ts
import { Effect } from "effect";
import { Callable } from "@visiolab/effect-firebase/functions";
import { CallableFunction } from "@visiolab/effect-firebase-functions/https";
import { Greet } from "./contract.ts";

const GreetLive = Callable.toLayer(Greet, ({ name }) => Effect.succeed(`Hello, ${name}!`));

export const { greet } = CallableFunction.make(Greet, GreetLive, { region: "europe-west1" });
```

Each export is exactly what `onCall` returns, so plain `firebase deploy` deploys it. The third argument is Firebase's `CallableOptions`, passed through unchanged.

- The Layer is built on the first call, not at deploy or when the module loads. Every Layer is built through one memo map per process, so concurrent first calls share one build.
- `minInstances` keeps an instance alive, but its Layer is still built on the first call.
- Finalizers of the Layer don't run when the instance shuts down.
- Give each export a Layer of its own where you can, so a cold instance builds only what its function needs.
- Call `setGlobalOptions` before any function is defined, as Firebase requires.

## Callable Groups

Collect related Callables into a Callable Group. Each member deploys under the group's name as a prefix:

```ts
import { Effect, Layer, Schema } from "effect";
import { Callable, CallableGroup } from "@visiolab/effect-firebase/functions";
import { CallableFunction } from "@visiolab/effect-firebase-functions/https";

const CreateUser = Callable.make("create", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });

class Users extends CallableGroup.make("users").add(CreateUser, DeleteUser) {}

const UsersLive = Layer.mergeAll(
  Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name)),
  Callable.toLayer(Users, "delete", () => Effect.void),
);

// Deploys `users-create` and `users-delete`.
export const { users } = CallableFunction.group(Users, UsersLive, {
  delete: { region: "europe-west1" },
});
```

- Implement a member with `Callable.toLayer(Users, "create", handler)`. A Layer from the Callable on its own doesn't serve it in the group.
- The options are a sparse map of `CallableOptions` keyed by member name. The group has none of its own.
- A Callable can be in more than one group. Each group serves and implements it separately.
- Build the client from the group, `CallableClient.make(Users)`. A client built from the member on its own calls the unprefixed name and gets `not-found`.

## Middleware and the Caller

Requirements such as "the caller is signed in" are Callable Middleware on the contract. The built-in `Caller.Authenticated` provides the `Caller` and fails a signed-out call with `CallableError.Unauthenticated`, before the Payload is decoded:

```ts
import { Effect, Layer, Schema } from "effect";
import { Callable, Caller } from "@visiolab/effect-firebase/functions";
import { CallableFunction } from "@visiolab/effect-firebase-functions/https";

const WhoAmI = Callable.make("whoAmI", { success: Schema.String }).middleware(Caller.Authenticated);

const WhoAmILive = Callable.toLayer(WhoAmI, () =>
  Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
);

// `Live` provides the handler and every middleware implementation.
export const { whoAmI } = CallableFunction.make(
  WhoAmI,
  Layer.merge(WhoAmILive, Caller.Authenticated.layer),
);
```

- Declare a middleware of your own with `CallableMiddleware.Service`. Its implementation wraps the call and reads the portable `CallableRequest`. `FunctionsCallableRequest` has the rest of Firebase's request, such as `rawRequest`.
- A middleware attached later wraps the ones attached before it.
- `CallableFunction` provides no middleware itself, so a `Live` without an implementation is a type error.
- Run a handler in process, with its chain and without the emulator, through `Callable.handler(WhoAmI)`.
