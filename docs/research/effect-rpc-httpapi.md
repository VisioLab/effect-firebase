# Contracts in Effect's Rpc and HttpApi

Research for [Contracts in Effect's Rpc and HttpApi](https://github.com/VisioLab/effect-firebase/issues/157) (map [Wayfinder: Type-safe callable functions](https://github.com/VisioLab/effect-firebase/issues/155)). This note records facts and verified sketches. It weighs options but makes no design decisions.

## Answer in short

- **Yes, an `RpcGroup` can be served and called one Rpc per `onCall` / `httpsCallable`.** Both directions were run in scratch probes against `effect@4.1.0` (see [Probes](#probes)).
- **Client:** a custom `RpcClient.Protocol` whose `send` turns each `Request` message into one `httpsCallable(functions, tag)(payload)` call and writes back one `Exit` message. `RpcClient.make(group)` then gives a fully typed client, with errors and `Date`s decoded by the Rpc's schemas. About 30 lines.
- **Server:** the server `Protocol` is shaped for long-lived connections (a `run` loop, client ids, `Eof`, `Ack`, disconnects). One request per `onCall` fits it, but the lighter route is to skip `RpcServer`: `RpcGroup.accessHandler(tag)` returns the handler for one Rpc, the Rpc's `middlewares` are applied in a loop, and the result is encoded with `Rpc.exitSchema(rpc)`. `RpcServer.makeNoSerialization` with one write per call also works.
- **Auth:** `RpcMiddleware` only sees string `headers`, a `ServerClient`, the payload and the Rpc. The verified `CallableRequest.auth` is not among them. Provide it as a service around the middleware chain and declare it as the middleware's `requires`. This type-checks without casts, and the Rpc then carries it in its `~requires` type.
- **Errors:** `Rpc.exitSchema(rpc)` already unions the Rpc's error schema with every middleware's error schema. The encoded typed failure fits into `HttpsError.details`, and the client SDK hands `details` back on `FunctionsError`.
- **HttpApi** declares the same three schemas (`payload`, `success`, `error`) but adds method, path, params, query, headers, status codes and OpenAPI. None of those exist on a callable. Two of its ideas carry over: several error schemas as an array, and a per-error annotation for the wire status (`HttpApiSchema.status`), which maps onto a `FunctionsErrorCode`.

## Versions and sources

| Package               | Version       | Where                                                                                                 |
| --------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `effect`              | 4.1.0         | `packages/admin/node_modules/effect/src` (catalog pin in `pnpm-workspace.yaml`)                       |
| `@firebase/functions` | 0.14.0        | `node_modules/.pnpm/@firebase+functions@0.14.0_@firebase+app@0.16.3/node_modules/@firebase/functions` |
| `firebase-functions`  | not installed | https://github.com/firebase/firebase-functions/blob/master/src/common/providers/https.ts              |

In Effect 4.1 the modules are no longer under `unstable/`. They are exported as `effect/rpc` and `effect/http-api` (`effect/package.json`, `exports`). Every export still carries `@stability unstable`.

Source references below are relative to `effect/src`:

- **[Rpc]** `rpc/Rpc.ts`, **[Group]** `rpc/RpcGroup.ts`, **[Mw]** `rpc/RpcMiddleware.ts`, **[Server]** `rpc/RpcServer.ts`, **[Client]** `rpc/RpcClient.ts`, **[Msg]** `rpc/RpcMessage.ts`, **[Ser]** `rpc/RpcSerialization.ts`, **[Utils]** `rpc/Utils.ts`
- **[Ep]** `http-api/HttpApiEndpoint.ts`, **[Builder]** `http-api/HttpApiBuilder.ts`, **[ApiMw]** `http-api/HttpApiMiddleware.ts`, **[ApiSchema]** `http-api/HttpApiSchema.ts`
- **[FnC]** `@firebase/functions` `dist/esm/index.esm.js`

## Rpc: declaring the contract

An `Rpc` is a value carrying a tag and schemas ([Rpc] `interface Rpc`, line 77):

```ts
interface Rpc<Tag, Payload, Success, Error, Middleware, Requires> {
  readonly _tag: Tag;
  readonly payloadSchema: Payload;
  readonly successSchema: Success;
  readonly errorSchema: Error;
  readonly defectSchema: Schema.Top;
  readonly middlewares: ReadonlySet<Middleware>;
  readonly annotations: Context.Context<never>;
  readonly "~requires": Requires; // type only
  // setPayload / setSuccess / setError / middleware / prefix / annotate
}
```

- `Rpc.make(tag, { payload, success, error, defect, stream, primaryKey })` ([Rpc] line 942). `payload` takes a schema or struct fields. Defaults are `Schema.Void` payload and success, `Schema.Never` error, `Schema.Defect()` defect. Only one `error` schema; several errors are passed as a `Schema.Union`.
- `stream: true` wraps success and error into `RpcSchema.Stream(success, error)` and sets the plain error to `Never` ([Rpc] lines 984–987). This is the hook a v2 `sendChunk` / `stream()` callable would use.
- `Rpc.custom` builds a constructor that rewrites the success/error schemas, for example to add pagination ([Rpc] line 1043).
- `.middleware(M)` adds a middleware and folds its `provides` / `requires` into the Rpc's `Requires` type ([Rpc] line 139, `RpcMiddleware.ApplyServices`).
- `.annotate(key, value)` attaches arbitrary metadata as a `Context`. `Rpc.ParseOptions` is the one built-in annotation ([Rpc] line 1214). Callable options (region, `enforceAppCheck`, a `FunctionsErrorCode` per error) could ride on annotations the same way.

`RpcGroup.make(...rpcs)` collects Rpcs by `_tag` ([Group] line 411). A group can `add`, `merge`, `omit`, `prefix`, apply `middleware` to every Rpc added so far, and `annotateRpcs`.

`Rpc.exitSchema(rpc)` builds `Schema.Exit(success, Union(error, ...middleware errors, stream error), defect)` and caches it per Rpc ([Rpc] line 1170). Client and server both encode and decode through it. Middleware failures are therefore part of every Rpc's typed error channel without being declared on the Rpc.

## Rpc: handlers as Layers

The group derives handler types from the contract ([Group] lines 76–150):

- `group.toLayer(handlers | Effect<handlers>)` returns `Layer<Rpc.ToHandler<R>>`. Each handler is stored in the context under `rpc.key` (`effect/rpc/Rpc/<tag>`) together with the context the layer was built in ([Group] `toHandlers`, line 307).
- `group.toLayerHandler(tag, handler)` implements **one** Rpc as its own Layer ([Group] line 117). A group can therefore be implemented in pieces, which fits one deployed function per Rpc.
- `group.accessHandler(tag)` reads one handler back as a plain function `(payload, { client, requestId, headers }) => Effect | Stream`, with the layer's context already provided ([Group] lines 137 and 354). It does **not** apply middleware or schemas.
- The handler's service requirements are checked against what the Rpc's middleware provides (`HandlersServices`, [Group] lines 91 and 214). A handler may `yield* CurrentUser` when a middleware `provides: CurrentUser`; the service is then removed from the Layer's requirements instead of leaking into them.

## Rpc: middleware and context

`RpcMiddleware.Service<Self, { provides, requires, clientError }>()(id, { error, requiredForClient })` declares a middleware key ([Mw] line 278). The implementation is a function, provided with `Layer.succeed(Key)(fn)` ([Mw] line 51):

```ts
(
  effect: Effect<SuccessValue, E, Provides>,
  options: {
    client: Rpc.ServerClient;
    requestId: RequestId;
    rpc: Rpc.AnyWithProps;
    payload: unknown;
    headers: Headers;
  },
) => Effect<SuccessValue, E, Requires | Scope>;
```

- The middleware wraps the handler effect. It provides context by `Effect.provideService(effect, CurrentUser, user)` and fails with its declared `error`.
- The server applies middlewares in a loop: `Context.getUnsafe(context, service)(handler, options)` for each `rpc.middlewares` ([Server] `applyMiddleware`, line 607). The helper is not exported, but the loop needs only the public `rpc.middlewares` field.
- `headers` is the only per-request input from the transport. Over HTTP the server concatenates the HTTP request headers into the Rpc message headers ([Server] line 1351). They are string pairs ([Msg] `RequestEncoded.headers`, line 81).
- `requiredForClient: true` plus `RpcMiddleware.layerClient` adds a client-side middleware that may rewrite outgoing requests, for example to add headers ([Mw] line 347).

**Consequence for `onCall`.** Firebase has already verified the ID token and App Check token when the `onCall` callback runs, and hands them over as `request.auth` and `request.app`. Neither fits into string headers without re-encoding. Two ways in, both verified:

1. Provide a per-call service (say `CallableRequest`) around the middleware-wrapped handler, and declare it in the middleware's `requires`. The middleware then reads it with `yield* CallableRequest` and type-checks without casts. `Rpc["~requires"]` on the Rpc names exactly the services the `onCall` wrapper has to provide.
2. Pass the raw `Authorization` header in `headers` and verify it again in the middleware. This duplicates Firebase's work.

## Rpc: server transport

`RpcServer.Protocol` is the transport service ([Server] line 1099):

```ts
{
  run: (f: (clientId: number, data: FromClientEncoded) => Effect<void>) => Effect<never>;
  disconnects: Queue.Dequeue<number>;
  send: (clientId: number, response: FromServerEncoded) => Effect<void>;
  end: (clientId: number) => Effect<void>;
  clientIds;
  initialMessage;
  supportsAck;
  supportsTransferables;
  supportsSpanPropagation;
  supportsNotifications;
  codecFor: RpcSerialization.CodecFor;
}
```

- `RpcServer.make(group)` / `RpcServer.layer(group)` run a long-lived server over the current `Protocol` ([Server] lines 652 and 1026). Decoding uses `codecFor(rpc.payloadSchema)`; encoding uses `codecFor(Rpc.exitSchema(rpc))` ([Server] `rpcCodecs`, line 542).
- The HTTP protocol shows how request/response maps onto it: each HTTP request becomes a new client id, its messages are written followed by `Eof`, and the response collects the `Exit` messages for that client ([Server] `makeProtocolWithHttpEffect`, line 1247; `toHttpEffect`, line 1463). An `onCall` protocol could copy this pattern, with the server forked once per function instance.
- `RpcServer.makeNoSerialization(group, { onFromServer })` is the same server without encoding ([Server] line 105). `server.write(clientId, request, { onRequest })` takes an `onRequest` hook that wraps the request effect. That hook is where a per-call service can be provided.
- `RpcSerialization` (json, ndjson, jsonRpc, msgpack-like binary) only matters when the transport carries bytes ([Ser]). `httpsCallable` and `onCall` carry JSON values, so only its `codecFor` (`Schema.toCodecJson`) is relevant.

A server built this way brings tracing spans, concurrency limits and fatal-defect handling. It also brings client bookkeeping, `Scope` lifetime and stream acks that one-shot calls do not need.

## Rpc: client transport

`RpcClient.Protocol` is the client transport ([Client] line 960):

```ts
{
  run: (clientId: number, f: (data: FromServerEncoded) => Effect<void>) => Effect<never>;
  send: (clientId: number, request: FromClientEncoded) => Effect<void, RpcClientError>;
  supportsAck: boolean;
  supportsTransferables: boolean;
  codecFor: RpcSerialization.CodecFor;
}
```

`RpcClient.Protocol.make((write) => Effect.succeed({ send, ... }))` supplies `run` and buffering ([Utils] `withRunClient`, line 65). The unbatched HTTP protocol is the model: one `send` per `Request`, one written `Exit` per response ([Client] `makeProtocolHttpUnbatched`, line 1013).

`RpcClient.make(group)` needs `Protocol | Rpc.MiddlewareClient<Rpcs> | Scope` and returns an object with one method per tag: `client.getGreeting(payload)` returns `Effect<Success, Error | MiddlewareError | RpcClientError>` ([Client] lines 76–130, 670). `RpcClient.makeNoSerialization` is the decoded-values variant ([Client] line 254).

The `Request` message also carries `headers`, `traceId`, `spanId`, `sampled` ([Msg] line 76). `httpsCallable` cannot send custom headers, so a callable protocol drops them. Trace propagation would need to travel in the payload.

## Firebase callable wire, as it meets the Rpc exit

From the client SDK ([FnC]):

- `encode` turns `Date` into an ISO string, `undefined`/`null` into `null`, and throws on non-finite numbers and functions (line 41). The Rpc codec already encodes before this, so `encode` only sees JSON values. A `Schema.Void` payload or an optional `undefined` arrives on the server as `null`.
- `_errorForResponse` reads `{ error: { status, message, details } }`. It maps `status` to a `FunctionsErrorCode`, appends ` [httpStatus]` to `message`, and decodes `details` (line 250). An unknown `status` becomes `internal` with no details.

From `firebase-functions` (source linked above, not installed here): a returned value becomes `{ result }`; a thrown `HttpsError(code, message, details)` becomes `{ error: { status, message, details } }`; any other thrown value becomes `INTERNAL` with no details.

The encoded `Exit` from `Rpc.exitSchema` looks like this (probe output):

```json
{"_tag":"Success","value":{"text":"hi u1","at":"1970-01-01T00:00:00.000Z"}}
{"_tag":"Failure","cause":[{"_tag":"Fail","error":{"_tag":"NotFound","id":"missing"}}]}
{"_tag":"Failure","cause":[{"_tag":"Fail","error":{"_tag":"Unauthenticated"}}]}
```

Two ways to put it on the wire:

|                    | A. Exit in `result`        | B. Success in `result`, typed failure in `HttpsError.details`                               |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------- |
| Server             | return the encoded `Exit`  | return `value`; throw `HttpsError(code, message, encodedError)` for `Fail`; rethrow defects |
| Client             | decode `data` as an `Exit` | `Success` from `data`; `Fail` from `FunctionsError.details`; anything else is a defect      |
| Status code        | always 200                 | Firebase status from a per-error code                                                       |
| Non-Effect callers | see an `Exit` envelope     | see an ordinary callable                                                                    |
| Needs              | nothing                    | a `FunctionsErrorCode` per error schema (an annotation, like `HttpApiSchema.status`)        |

Option B was verified on the client side with a fake `httpsCallable` that rejects with `{ code, message, details }`.

## HttpApi: the same contract, HTTP-shaped

`HttpApiEndpoint.post(identifier, path, { params, query, headers, payload, success, error })` declares an endpoint ([Ep] line 1196). `error` takes one schema or an array. Endpoints go into an `HttpApiGroup`, groups into an `HttpApi`:

```ts
import { Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"

const Api = HttpApi.make("Api").add(
  HttpApiGroup.make("greetings").add(
    HttpApiEndpoint.post("getGreeting", "/greeting", {
      payload: { id: Schema.String },
      success: Greeting,
      error: [NotFound.pipe(HttpApiSchema.status(404)), Unauthenticated.pipe(HttpApiSchema.status(401))]
    })
  )
)

// sketch, not type-checked
const GreetingsLive = HttpApiBuilder.group(Api, "greetings", (handlers) =>
  handlers.handle("getGreeting", ({ payload }) => /* Effect<Greeting, NotFound> */)
)
```

- Handlers are implemented per group with `HttpApiBuilder.group(api, groupId, h => h.handle(endpointId, fn))` ([Builder] line 147). `HttpApiBuilder.handler(api, group, endpoint, fn)` types one handler on its own ([Builder] line 193).
- `HttpApiMiddleware.Service` has the same `provides` / `requires` / `error` shape as `RpcMiddleware`, plus `security` schemes from `HttpApiSecurity` (bearer, API key, basic) ([ApiMw] line 344).
- `HttpApiSchema.status(code)` annotates an error schema with its HTTP status ([ApiSchema] line 142).

What does not carry over to callables: method, path, params, query, headers, content types, status for success, OpenAPI. The map rules out serving an `HttpApi` through `onRequest`.

What carries over as ideas:

- An `error` list instead of a hand-written `Schema.Union`.
- A per-error annotation for the wire code, here a `FunctionsErrorCode` instead of an HTTP status.
- Security as a declared middleware, here `request.auth` / `request.app` instead of a bearer header.

## Sketches

### Contract (portable core)

```ts
import { Context, Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}
class Unauthenticated extends Schema.TaggedError<Unauthenticated>()("Unauthenticated", {}) {}

// per-call input the onCall wrapper provides
class CallableAuth extends Context.Service<CallableAuth, { readonly uid: string } | undefined>()(
  "CallableAuth",
) {}
class CurrentUser extends Context.Service<CurrentUser, { readonly uid: string }>()("CurrentUser") {}

class Authenticated extends RpcMiddleware.Service<
  Authenticated,
  { provides: CurrentUser; requires: CallableAuth }
>()("Authenticated", { error: Unauthenticated }) {}

export const GetGreeting = Rpc.make("getGreeting", {
  payload: { id: Schema.String },
  success: Schema.Struct({ text: Schema.String, at: Schema.Date }),
  error: NotFound,
}).middleware(Authenticated);

export const Api = RpcGroup.make(GetGreeting);
```

### Server: one `onCall` per Rpc, without `RpcServer`

```ts
import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/rpc";
import { RequestId } from "effect/rpc/RpcMessage";

const HandlersLive = Api.toLayer({
  getGreeting: ({ id }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser; // provided by Authenticated
      if (id === "missing") return yield* new NotFound({ id });
      return { text: `hi ${user.uid}`, at: new Date() };
    }),
});

const AuthLive = Layer.succeed(Authenticated)((effect) =>
  Effect.gen(function* () {
    const auth = yield* CallableAuth;
    if (!auth) return yield* new Unauthenticated();
    return yield* Effect.provideService(effect, CurrentUser, auth);
  }),
);

// what an onCall callback would run for one Rpc
const handleOne = (payload: unknown, auth: { uid: string } | undefined) =>
  Effect.gen(function* () {
    const handler = yield* Api.accessHandler("getGreeting");
    const decoded = yield* Schema.decodeUnknownEffect(
      Schema.toCodecJson(GetGreeting.payloadSchema),
    )(payload);
    const opts = { client: new Rpc.ServerClient(0), requestId: RequestId(0n), headers: {} };
    let effect = handler(decoded, opts);
    for (const m of GetGreeting.middlewares) {
      effect = (yield* m)(effect, { ...opts, rpc: GetGreeting, payload: decoded });
    }
    const exit = yield* Effect.exit(Effect.provideService(effect, CallableAuth, auth));
    return yield* Schema.encodeUnknownEffect(Schema.toCodecJson(Rpc.exitSchema(GetGreeting)))(exit);
    // option B: return exit.value on success, throw HttpsError(code, msg, error) on Fail
  });

// export const getGreeting = onCall((req) => runtime.runPromise(handleOne(req.data, req.auth)))
```

The dummy `ServerClient(0)`, `RequestId(0n)` and empty `headers` are what the middleware signature asks for. They show that `RpcMiddleware` was designed for a connection-oriented server, not for one-shot calls.

### Server: through `RpcServer.makeNoSerialization`

```ts
const server =
  yield *
  RpcServer.makeNoSerialization(Api, {
    disableClientAcks: true,
    onFromServer: (r) =>
      Effect.sync(() => {
        if (r._tag === "Exit") pending.get(r.clientId)?.(r.exit);
      }),
  });
// per call: a fresh clientId, then
yield *
  server.write(
    clientId,
    { _tag: "Request", id, tag: "getGreeting", payload: decoded, headers: {} },
    {
      onRequest: (e) => Effect.provideService(e, CallableAuth, req.auth),
    },
  );
// await the Exit for clientId, encode with Rpc.exitSchema, then server.disconnect(clientId)
```

### Client: custom `RpcClient.Protocol` over `httpsCallable`

```ts
import { Effect, Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { FunctionsError, httpsCallable, type Functions } from "firebase/functions";

const layerCallableProtocol = (functions: Functions) =>
  Layer.effect(RpcClient.Protocol)(
    RpcClient.Protocol.make((write) =>
      Effect.succeed({
        supportsAck: false,
        supportsTransferables: false,
        codecFor: RpcSerialization.json.codecFor,
        send: (clientId, message) =>
          message._tag !== "Request"
            ? Effect.void
            : Effect.tryPromise({
                try: () => httpsCallable(functions, message.tag)(message.payload),
                catch: (e) => e,
              }).pipe(
                Effect.map(({ data }) => ({ _tag: "Success", value: data }) as const),
                Effect.catch((e) =>
                  Effect.succeed(
                    e instanceof FunctionsError && e.details !== undefined
                      ? ({ _tag: "Failure", cause: [{ _tag: "Fail", error: e.details }] } as const)
                      : ({ _tag: "Failure", cause: [{ _tag: "Die", defect: String(e) }] } as const),
                  ),
                ),
                Effect.flatMap((exit) =>
                  write(clientId, { _tag: "Exit", requestId: message.id, exit }),
                ),
              ),
      }),
    ),
  );

// const client = yield* RpcClient.make(Api)
// yield* client.getGreeting({ id: "x" })  // Effect<{ text; at: Date }, NotFound | Unauthenticated | RpcClientError>
```

`message.tag` is the function name here. With prefixed groups or renamed exports the protocol needs a tag-to-name map. Transport failures that are not typed errors could become `RpcClientError` instead of a defect.

## Probes

Both probes ran with `vpx` in `packages/admin` against `effect@4.1.0` and type-checked with the package's `tsc`. They were throwaway files and are not committed.

- **Server probe.** The contract and handlers above, called through the `accessHandler` route and the `makeNoSerialization` route with `{ id: "x" }`, `{ id: "missing" }` and no auth. Both routes produced the three encoded exits shown in [Firebase callable wire](#firebase-callable-wire-as-it-meets-the-rpc-exit). With `requires: CallableAuth` on the middleware, `Layer.succeed(Authenticated)(...)` type-checks without casts.
- **Client probe.** The custom protocol above with a fake `httpsCallable` that resolves `{ data }` or rejects with `{ code, message, details }`. `RpcClient.make(Api)` returned `Success` with `at` decoded to a `Date`, a typed `Fail(NotFound)`, and a `Die` for an `internal` error without details. The client's error type was inferred as `NotFound | RpcClientError` (no middleware on that probe's Rpc).

## Open points this raises for other tickets

- **How a callable is declared:** reuse `Rpc` / `RpcGroup` / `RpcMiddleware` as the contract, or write our own constructor modelled on `Rpc.make`. Reuse ties the core package's public types to APIs marked `@stability unstable`.
- **One deployed function per callable or per group:** `toLayerHandler` and `accessHandler` already work per Rpc, so per-callable deploys need nothing from `RpcServer`. Per-group would need a dispatch on `tag` in the payload.
- **Callable errors across the wire:** options A and B above. B needs a `FunctionsErrorCode` per error schema and decides what non-Effect callers see.
- **What a handler sees of the request:** `request.auth`, `request.app` and `rawRequest` do not fit `RpcMiddleware`'s `headers`. A per-call service declared as middleware `requires` works and is typed.
- **Turning an Effect handler into an onCall export:** the wrapper must provide `Rpc["~requires"]`, run handler and middleware in a runtime built once per instance, and map the `Exit`.
- **Wire encoding:** `Schema.toCodecJson` output is what the Firebase `encode` sees. `undefined` arrives as `null`.
- **Streaming callables:** `Rpc.make(..., { stream: true })` and `RpcSchema.Stream` give the contract shape. The client protocol would write `Chunk` messages from `stream()`.
