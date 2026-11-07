# @visiolab/effect-firebase-functions

Deploys the Functions of [`@visiolab/effect-firebase`](https://github.com/VisioLab/effect-firebase/tree/main/packages/effect-firebase) as Cloud Functions for Firebase, with `firebase-functions`. A Function is a server function declared once by its name and what runs it. Callables are the kind of Function the client calls, with `CallableClient` from [`@visiolab/effect-firebase-client`](https://github.com/VisioLab/effect-firebase/tree/main/packages/client).

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

Implement it as a Layer, and export it with `Functions.make`:

```ts
import { Effect } from "effect";
import { Callable } from "@visiolab/effect-firebase/functions";
import { Functions } from "@visiolab/effect-firebase-functions";
import { Greet } from "./contract.ts";

const GreetLive = Callable.toLayer(Greet, ({ name }) => Effect.succeed(`Hello, ${name}!`));

export const { greet } = Functions.make(Greet, GreetLive, { region: "europe-west1" });
```

`Functions.make` dispatches on the Function's kind. For a Callable, the export is exactly what `onCall` returns, so plain `firebase deploy` deploys it, and the third argument is Firebase's `CallableOptions`, passed through unchanged.

- The Layer is built on the first call, not at deploy or when the module loads. Every Layer is built through one memo map per process, so concurrent first calls share one build.
- `minInstances` keeps an instance alive, but its Layer is still built on the first call.
- Finalizers of the Layer don't run when the instance shuts down.
- Give each export a Layer of its own where you can, so a cold instance builds only what its function needs.
- Call `setGlobalOptions` before any function is defined, as Firebase requires.

## Document Triggers

A Document Trigger runs when a document of a collection changes. Declare it from a name and a `Collection` definition, implement it with `DocumentTrigger.toLayer`, and deploy it with `Functions.make`:

```ts
import { Effect } from "effect";
import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
import { Functions } from "@visiolab/effect-firebase-functions";
import { Posts } from "./collections.ts";

const OnPostCreated = DocumentTrigger.created("onPostCreated", Posts);

export const { onPostCreated } = Functions.make(
  OnPostCreated,
  DocumentTrigger.toLayer(OnPostCreated, (event) =>
    Effect.gen(function* () {
      const [authorId] = event.ref.ancestors;
      const post = yield* event.snapshot.data;
      yield* Effect.log(`${authorId} published ${post.title}`);
    }),
  ),
  { retry: true },
);
```

- There is one constructor per change: `created` and `deleted` hand over `event.snapshot` (on `deleted`, the document as it was just before), `updated` hands over `event.before` and `event.after`, both existing, and `written` runs on all three, with `before` missing on a create and `after` missing on a delete. Narrow a `written` side with `DocumentSnapshot.isExisting` or `isMissing`.
- The trigger listens to the `(default)` database, at a path pattern derived from the collection: one wildcard per parent document and one for the document. The ids are on `event.ref`, typed.
- `event.snapshot.data` decodes through the collection's model when it runs; `event.snapshot.raw` holds the stored Firestore Values. The same holds for each existing side of a change.
- The options are the shared `firebase-functions` options plus `retry`. A failing handler is logged and makes the function throw, so Firebase delivers the event again when `retry` is set. Events are delivered at least once: key idempotent work on `event.id`.
- Test a handler in process with `DocumentTrigger.serve`, and an event built with `DocumentTrigger.createdEvent`, `updatedEvent`, `deletedEvent` or `writtenEvent` from `DocumentSnapshot.existing` and `DocumentSnapshot.missing`.
- The package takes `@visiolab/effect-firebase-admin` and `firebase-admin` as peer dependencies, to read event data as the Admin SDK reads do.

## Function Groups

Collect related Functions, of any kind, into a Function Group. Each member deploys under the group's name as a prefix:

```ts
import { Effect, Layer, Schema } from "effect";
import { Callable, FunctionGroup } from "@visiolab/effect-firebase/functions";
import { Functions } from "@visiolab/effect-firebase-functions";

const CreateUser = Callable.make("create", {
  payload: { name: Schema.String },
  success: Schema.String,
});
const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });

class Users extends FunctionGroup.make("users").add(CreateUser, DeleteUser) {}

const UsersLive = Layer.mergeAll(
  Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name)),
  Callable.toLayer(Users, "delete", () => Effect.void),
);

// Deploys `users-create` and `users-delete`.
export const { users } = Functions.group(Users, UsersLive, {
  delete: { region: "europe-west1" },
});
```

- Implement a member with `Callable.toLayer(Users, "create", handler)`. A Layer from the Callable on its own doesn't serve it in the group.
- The options are a sparse map keyed by member name, each typed by the member's kind: `CallableOptions` for a Callable. The group has none of its own.
- A Function can be in more than one group. Each group serves and implements it separately.
- Names must be unique within a group. `.add` throws when a name is taken, so the clash fails when the module loads. The types don't catch it.
- Build the client from the group, `CallableClient.make(Users)`. It has a function for each of the group's Callables. A client built from the member on its own calls the unprefixed name and gets `not-found`.

## Middleware and the Caller

Requirements such as "the caller is signed in" are Callable Middleware on the contract. The built-in `Caller.Authenticated` provides the `Caller` and fails a signed-out call with `CallableError.Unauthenticated`, before the Payload is decoded:

```ts
import { Effect, Layer, Schema } from "effect";
import { Callable, Caller } from "@visiolab/effect-firebase/functions";
import { Functions } from "@visiolab/effect-firebase-functions";

const WhoAmI = Callable.make("whoAmI", { success: Schema.String }).middleware(Caller.Authenticated);

const WhoAmILive = Callable.toLayer(WhoAmI, () =>
  Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
);

// `Live` provides the handler and every middleware implementation.
export const { whoAmI } = Functions.make(
  WhoAmI,
  Layer.merge(WhoAmILive, Caller.Authenticated.layer),
);
```

- Declare a middleware of your own with `CallableMiddleware.Service`. Its implementation wraps the call and reads the portable `CallableRequest`: `auth`, `app`, the raw `data`, and `rawRequest`, the HTTP request as Effect's `HttpServerRequest`, with the caller's IP address as `remoteAddress`. Every call provides it, so the Layer you serve needn't, even when a handler or middleware reads it. Its body streams Firebase's buffered bytes without copying them.
- The Firebase web SDK's `httpsCallable` can't send custom headers. A header of your own reaches `rawRequest` only from callers that don't use it, such as another server. Headers like `user-agent` and `accept-language` are there for every caller.
- A middleware attached later wraps the ones attached before it.
- The Payload is decoded inside the chain, so a middleware that catches every failure also catches a Payload that doesn't decode. The caller then no longer gets `invalid-argument`. Catch only the errors you mean to.
- `Functions` provides no middleware itself, so a `Live` without an implementation is a type error.
- Run a handler in process, with its chain and without the emulator, through `Callable.handler(WhoAmI)`. Pass a `rawRequest` built with `HttpServerRequest.fromWeb` to test a middleware that reads headers or the address; left out, it is a JSON `POST` of the Payload to `http://localhost/<deployed name>`.

### Middleware in a group

A Function Group carries no middleware. Attach a middleware to each member that needs it:

```ts
import { Effect, Layer, Schema } from "effect";
import { Callable, FunctionGroup, Caller } from "@visiolab/effect-firebase/functions";
import { Functions } from "@visiolab/effect-firebase-functions";

const Me = Callable.make("me", { success: Schema.String }).middleware(Caller.Authenticated);

class Accounts extends FunctionGroup.make("accounts").add(Me) {}

export const { accounts } = Functions.group(
  Accounts,
  Layer.merge(
    Callable.toLayer(Accounts, "me", () =>
      Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
    ),
    Caller.Authenticated.layer,
  ),
);
```

## Tracing

Every call runs in a `kind: "server"` span named `CallableFunction.<deployed name>`, such as `CallableFunction.users-create`, with the attributes `rpc.system: "firebase_callable"`, `rpc.method`, `rpc.service` (the group, for a member) and `faas.name`. Spans are exported only when the Layer you export provides a `Tracer`, for example from `@effect/opentelemetry`:

```ts
export const { users } = Functions.group(Users, Layer.mergeAll(UsersLive, TracingLive));
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

To log the same way outside a deployed Function, provide the layer yourself:

```ts
import { Effect } from "effect";
import { CloudLogging } from "@visiolab/effect-firebase-functions/logger";

const job = Effect.log("Cleaning up").pipe(Effect.provide(CloudLogging.layer));
```
