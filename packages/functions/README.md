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
- Names must be unique within a group. `.add` throws when a name is taken, so the clash fails when the module loads. The types don't catch it.
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

- Declare a middleware of your own with `CallableMiddleware.Service`. Its implementation wraps the call and reads the portable `CallableRequest`: `auth`, `app`, the raw `data`, and `rawRequest`, the HTTP request as Effect's `HttpServerRequest`, with the caller's IP address as `remoteAddress`. Every call provides it, so the Layer you serve needn't, even when a handler or middleware reads it. Its body streams Firebase's buffered bytes without copying them.
- The Firebase web SDK's `httpsCallable` can't send custom headers. A header of your own reaches `rawRequest` only from callers that don't use it, such as another server. Headers like `user-agent` and `accept-language` are there for every caller.
- A middleware attached later wraps the ones attached before it.
- The Payload is decoded inside the chain, so a middleware that catches every failure also catches a Payload that doesn't decode. The caller then no longer gets `invalid-argument`. Catch only the errors you mean to.
- `CallableFunction` provides no middleware itself, so a `Live` without an implementation is a type error.
- Run a handler in process, with its chain and without the emulator, through `Callable.handler(WhoAmI)`. Pass a `rawRequest` built with `HttpServerRequest.fromWeb` to test a middleware that reads headers or the address; left out, it is a JSON `POST` of the Payload to `http://localhost/<deployed name>`.

### Group middleware

`.middleware(M)` on a Callable Group attaches the middleware to every member, including members added after it:

```ts
import { Effect, Layer, Schema } from "effect";
import { Callable, CallableGroup, Caller } from "@visiolab/effect-firebase/functions";
import { CallableFunction } from "@visiolab/effect-firebase-functions/https";

const Me = Callable.make("me", { success: Schema.String });

class Accounts extends CallableGroup.make("accounts").middleware(Caller.Authenticated).add(Me) {}

export const { accounts } = CallableFunction.group(
  Accounts,
  Layer.merge(
    Callable.toLayer(Accounts, "me", () =>
      Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
    ),
    Caller.Authenticated.layer,
  ),
);
```

- Group middleware runs outside each member's own middleware, so a member's middleware may require what the group's provides.
- It is stored on the group, not copied onto the members. The same Callable in another group, or on its own, is served without it.
- Its errors join each member's errors in `CallableClient.make(Accounts)`, and `Live` must provide its implementation.
- Middleware isn't deduplicated: the same middleware on a group and on one of its members runs twice for that member.

## Tracing

Every call runs in a `kind: "server"` span named `CallableFunction.<deployed name>`, such as `CallableFunction.users-create`, with the attributes `rpc.system: "firebase_callable"`, `rpc.method`, `rpc.service` (the group, for a member) and `faas.name`. Spans are exported only when the Layer you export provides a `Tracer`, for example from `@effect/opentelemetry`:

```ts
export const { users } = CallableFunction.group(Users, Layer.mergeAll(UsersLive, TracingLive));
```

- The span covers the middleware, decoding the Payload, the handler and encoding the answer. On the call that builds the Layer, it covers the build too, and spans opened during the build are its children.
- Its parent is the trace context Firebase reads from the request (`X-Cloud-Trace-Context`, else `traceparent`), so it joins the platform's trace. In the emulator it is a root span.
- `CallableClient` opens a `kind: "client"` span per call. It isn't linked to the server span: the two land in separate traces.
- Neither span carries a uid. Add one where you want it with `Effect.annotateCurrentSpan("enduser.id", uid)`.

## Logging

Every call logs through `CloudLogging.layer`, which writes each Effect log as one Cloud Logging JSON line, in the format of Firebase's own `logger`:

- The trace, span id and sampled flag come from the current span, so concurrent calls on one instance each log under their own trace.
- Trace and Debug are `DEBUG`, Info `INFO`, Warn `WARNING`, Error `ERROR` and Fatal `CRITICAL`. Error and Fatal go to `console.error`, the rest to `console.log`.
- Log annotations become fields of the entry, other logged values go under `args` and log spans under `spans`.
- A Cause is appended to `message` with its stacks, so defects and failed Layer builds reach Error Reporting.
- Entries carry no uid. Add one where you want it with `Effect.annotateLogs({ uid })`.
- The project comes from `GCLOUD_PROJECT`, else `GOOGLE_CLOUD_PROJECT`. With neither, entries carry no trace fields.
- Logs written while the first call builds the Layer are held until the build is done, so they get the spans' final ids. Entries carry no timestamp of their own, so Cloud Logging stamps them with the time the build finished.
- Provide a `Logger.layer` in the Layer you export to log differently.

To log the same way outside a Callable Function, provide the layer yourself:

```ts
import { Effect } from "effect";
import { CloudLogging } from "@visiolab/effect-firebase-functions/logger";

const job = Effect.log("Cleaning up").pipe(Effect.provide(CloudLogging.layer));
```
