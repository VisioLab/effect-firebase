# How Firebase callables work end to end

Research for the ticket "How Firebase callables work end to end", under the map "Wayfinder: Type-safe callable functions".

The question: how do `firebase-functions` v2 `onCall` and the client SDK's `httpsCallable` work? What goes over the wire, how errors travel, what a handler receives, which options exist, how firebase-tools discovers and deploys the exports, and how the Functions emulator runs them. The focus is on the facts a wrapper design depends on.

## Sources

All claims come from the published package source, read on 2026-11-06, or from the official protocol page.

| Short name | Source                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **server** | `firebase-functions@7.4.0` (npm tarball). Main files: `lib/v2/providers/https.{js,d.ts}`, `lib/common/providers/https.{js,d.ts}`, `lib/v2/options.{js,d.ts}`, `lib/runtime/{loader,manifest}.js`, `lib/bin/firebase-functions.js`, `lib/common/onInit.js`, `lib/params/types.js`. Upstream: <https://github.com/firebase/firebase-functions> (`src/` has the same paths as `.ts`).        |
| **client** | `@firebase/functions@0.14.0` (the `firebase/functions` entry of the `firebase` package). Main files: `dist/esm/index.esm.js`, `dist/esm/src/{api,public-types}.d.ts`. Upstream: <https://github.com/firebase/firebase-js-sdk/tree/main/packages/functions/src> (`serializer.ts`, `error.ts`, `service.ts`, `context.ts`).                                                                 |
| **tools**  | `firebase-tools@15.35.0`. Main files: `lib/deploy/functions/runtimes/node/index.js`, `lib/deploy/functions/runtimes/discovery/{index,v1alpha1}.js`, `lib/deploy/functions/{build,backend,prepare}.js`, `lib/deploy/functions/release/fabricator.js`, `lib/emulator/{functionsEmulator,functionsEmulatorShared}.js`, `lib/api.js`. Upstream: <https://github.com/firebase/firebase-tools>. |
| **spec**   | "Protocol specification for https.onCall": <https://firebase.google.com/docs/functions/callable-reference>                                                                                                                                                                                                                                                                                |

## 1. The wire protocol

### Request

- The client sends `POST <url>` with `Content-Type: application/json` and the body `{"data": <encoded value>}` (client `callAtURL`, `postJSON`).
- The URL is `https://<region>-<projectId>.cloudfunctions.net/<name>`. With a custom domain it is `<customDomain>/<name>`. In the emulator it is `<emulatorOrigin>/<projectId>/<region>/<name>` (client `FunctionsService._url`).
- The client picks the region with `getFunctions(app, regionOrCustomDomain)`, and the default is `us-central1` (client `DEFAULT_REGION`). **The client does not learn the region from the server.** If the function is deployed anywhere else, the client must be told the region.
- The client adds these headers when it has the values (client `makeAuthHeaders`):
  - `Authorization: Bearer <Firebase Auth ID token>` when the Auth SDK is registered and has a user.
  - `X-Firebase-AppCheck: <token>` when App Check is registered. With `limitedUseAppCheckTokens: true` it sends a limited-use token instead.
  - `Firebase-Instance-ID-Token: <FCM token>` when Messaging is registered and notifications are granted.
- For streaming, the client also sends `Accept: text/event-stream` (client `streamAtURL`).
- The server accepts a request only when all of these hold: the method is `POST`, the content type is `application/json` (parameters after `;` are ignored), `body.data` is not `undefined`, and the body has **no keys other than `data`**. Anything else fails with `invalid-argument` / "Bad Request" (server `isValidRequest`).
- The client times out after 70 s by default (`HttpsCallableOptions.timeout`). The timeout fails with `deadline-exceeded` (client `failAfter`). Deleting the Functions instance cancels any call in flight with `cancelled`.

### Success response

- The server responds with `200` and the body `{"result": <encoded value>}` (server `wrapOnCallHandler`).
- The client reads `json.data`, falls back to `json.result`, and fails with `internal` / "Response is missing data field." when both are absent (client `callAtURL`). The client resolves to `{ data }` (`HttpsCallableResult`).
- The spec page says `result` but shows `response` in its example. The code uses `result`.

### Value encoding (what survives the trip)

The server and the client each run their own `encode`/`decode`, and the two **are not symmetric**.

| Value                                               | Client `encode` (request)                                | Server `decode` (request)                            | Server `encode` (response)        | Client `decode` (response) |
| --------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- | --------------------------------- | -------------------------- |
| `null`, `undefined`                                 | `null`                                                   | as is                                                | `null`                            | as is                      |
| finite number, `Number` object                      | number                                                   | as is                                                | number                            | as is                      |
| `NaN`, `±Infinity`                                  | **throws**                                               | –                                                    | **throws** (→ `internal`)         | –                          |
| boolean, string                                     | as is (`String` objects too)                             | as is                                                | as is (primitive strings only)    | as is                      |
| `Date`                                              | **ISO string**                                           | stays a string                                       | **`{}`** (no own enumerable keys) | –                          |
| `bigint`                                            | **throws**                                               | –                                                    | **throws** (→ `internal`)         | –                          |
| array                                               | mapped                                                   | mapped                                               | mapped                            | mapped                     |
| other object or function                            | own enumerable keys, mapped                              | mapped                                               | own enumerable keys, mapped       | mapped                     |
| `Map`, `Set`, class instance                        | own enumerable keys only, so `Map` and `Set` become `{}` | –                                                    | same                              | –                          |
| `{"@type": "…Int64Value" \| "…UInt64Value", value}` | –                                                        | **`parseFloat(value)`**, losing precision above 2^53 | never produced                    | `Number(value)`            |
| object with any other `@type` key                   | –                                                        | **throws** (→ `internal`)                            | –                                 | **throws**                 |

Sources: server `encode`/`decode` in `lib/common/providers/https.js`; client `encode`/`decode` in `serializer.ts`.

What a wrapper depends on:

- **The payload is JSON with a few lossy edges, and neither side calls `toJSON`.** The server `encode` walks `Object.entries`, so a `Date` in a handler's return value arrives as `{}`, silently. The request side turns a `Date` into an ISO string and never turns it back. The wrapper must encode with its own schema before the value reaches either SDK, and decode after.
- **An object property set to `undefined` arrives as `null`, not as a missing key.** Both encoders map `undefined` to `null` and keep the key. A schema with `optional` keys that rejects `null` would fail on a value the client itself produced. Either strip `undefined` keys before calling the SDK, or have the decoders accept `null` for absent keys.
- The `@type` key is reserved. The spec says maps with unknown `@type` values "are left as maps", but **both JS implementations throw** on them. User data must not contain an `@type` key.
- `NaN`, `Infinity` and `bigint` throw. A throw in the server `encode` happens inside the `try`, so the client sees `internal`.
- The spec also says that "any other header causes the request to be rejected". The Node server does not enforce this.

### Error response

- The body is `{"error": {"status": "<CANONICAL_NAME>", "message": string, "details"?: unknown}}`. The HTTP status follows the code (server `HttpsError.toJSON`, `errorCodeMap`):

  | `FunctionsErrorCode`  | wire `status`       | HTTP |
  | --------------------- | ------------------- | ---- |
  | `ok`                  | OK                  | 200  |
  | `cancelled`           | CANCELLED           | 499  |
  | `unknown`             | UNKNOWN             | 500  |
  | `invalid-argument`    | INVALID_ARGUMENT    | 400  |
  | `deadline-exceeded`   | DEADLINE_EXCEEDED   | 504  |
  | `not-found`           | NOT_FOUND           | 404  |
  | `already-exists`      | ALREADY_EXISTS      | 409  |
  | `permission-denied`   | PERMISSION_DENIED   | 403  |
  | `unauthenticated`     | UNAUTHENTICATED     | 401  |
  | `resource-exhausted`  | RESOURCE_EXHAUSTED  | 429  |
  | `failed-precondition` | FAILED_PRECONDITION | 400  |
  | `aborted`             | ABORTED             | 409  |
  | `out-of-range`        | OUT_OF_RANGE        | 400  |
  | `unimplemented`       | UNIMPLEMENTED       | 501  |
  | `internal`            | INTERNAL            | 500  |
  | `unavailable`         | UNAVAILABLE         | 503  |
  | `data-loss`           | DATA_LOSS           | 500  |

- `new HttpsError(code, message, details?)` throws a plain `Error` when `code` is not in the map.
- **Only an `instanceof HttpsError` passes through.** Anything else a handler throws or rejects with is logged as "Unhandled error" and replaced with `HttpsError("internal", "INTERNAL")`, without details (server `wrapOnCallHandler` catch block). The check is a real `instanceof`, so an `HttpsError` from a second copy of `firebase-functions` (bundled, or a duplicate install) also turns into `internal`. This is another reason `firebase-functions` should stay a peer dependency.
- **`details` is serialised by Express's `res.send` (`JSON.stringify`), not by the callable `encode`.** So `toJSON` _is_ honoured in `details`: a `Date` becomes an ISO string, and `undefined` keys are dropped. This is the opposite of the `result` path.
- On the client (client `_errorForResponse`, `FunctionsError`):
  - The code starts from the HTTP status: 400→`invalid-argument`, 401→`unauthenticated`, 403→`permission-denied`, 404→`not-found`, 409→`aborted`, 429→`resource-exhausted`, 499→`cancelled`, 500→`internal`, 501→`unimplemented`, 503→`unavailable`, 504→`deadline-exceeded`, 0 (network error) →`internal`, other non-2xx →`unknown`. The body's `error.status` then overrides it. An unknown `status` becomes `internal` with "Unknown backend error status".
  - A body `status` of `OK` counts as success, even on a non-2xx response.
  - **`FunctionsError.code` is prefixed: `"functions/permission-denied"`** (type `` `functions/${FunctionsErrorCodeCore}` ``).
  - **`FunctionsError.message` is the server's message with ` [<httpStatus>]` appended**, for example `"Not allowed [403]"`. Streaming errors append ` [0]`. The client does not get the server's message verbatim.
  - `FunctionsError.details` is `decode(error.details)`, or `undefined`.
  - A network failure or a missing CORS header looks the same as a server crash: status 0, code `internal`.
- The wrapper's mapping, then: send a typed failure as `HttpsError(code, message, details)` with the encoded failure in `details`. On the client, strip the `functions/` prefix and decode `details` with the failure schema. Do not rely on `message`.

### Streaming (v2 only)

- The client calls `callable.stream(data, { signal?, limitedUseAppCheckTokens? })` and gets `{ stream: AsyncIterable<StreamData>, data: Promise<ResponseData> }`.
- The server answers with Server-Sent Events. Each `res.sendChunk(chunk)` writes `data: {"message": <chunk>}`. The final value is `data: {"result": …}`, an error is `data: {"error": {...}}`, and heartbeats are `: ping` comments every `heartbeatSeconds` (30 s by default, `null` turns them off) (server `wrapOnCallHandler`, `encodeSSE`).
- **Chunks are serialised with `JSON.stringify` and do not pass through `encode`.** The client runs `decode` on each `message` (client `createResponseStream`).
- An error in streaming mode still arrives with HTTP 200, because the status line was already sent.
- `sendChunk` resolves `false` when the request was not streaming or the client disconnected. `response.signal` aborts when the client goes away. After an abort, the server does not write a result.
- `CallableFunction.stream()` on the server returns a stub that rejects with "Coming soon".
- v1 callables reject `Accept: text/event-stream` with `invalid-argument`.

## 2. What the handler receives

`onCall(opts?, (request: CallableRequest<T>, response?: CallableResponse<Stream>) => Return)` (server `lib/v2/providers/https.d.ts`).

`CallableRequest<T>` (server `lib/common/providers/https.d.ts`):

| Field                       | Meaning                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data: T`                   | The decoded request body `data`. **It is not validated.** `T` is only a type parameter, so the handler gets whatever JSON was sent.                                  |
| `auth?: AuthData`           | `{ uid, token: DecodedIdToken, rawToken }`. Missing when there was no `Authorization` header.                                                                        |
| `app?: AppCheckData`        | `{ appId, token: DecodedAppCheckToken, alreadyConsumed? }`. Missing when there was no App Check header, or when the token was invalid and App Check is not enforced. |
| `instanceIdToken?: string`  | The **unverified** `Firebase-Instance-ID-Token` header.                                                                                                              |
| `rawRequest: Request`       | The Express request, with `rawBody`.                                                                                                                                 |
| `acceptsStreaming: boolean` | Whether the request header was exactly `Accept: text/event-stream`.                                                                                                  |

`CallableResponse<Stream>`: `{ sendChunk(chunk): Promise<boolean>, signal: AbortSignal }`.

Before the handler runs, the order is as follows (server `wrapOnCallHandler`, `checkTokens`):

1. CORS runs. Callables default to `cors: true` and allow only `POST`.
2. The request shape is checked (see above).
3. The Auth and App Check tokens are verified in parallel through `firebase-admin` (`getAuth().verifyIdToken`, `getAppCheck().verifyToken`). **`firebase-admin` is a peer dependency of `firebase-functions`** (`^11 || ^12 || ^13 || ^14`). It must be installed, and the default Admin app is used.
4. An Auth token that is present but invalid fails with `unauthenticated`. **A missing Auth token is not an error**: the handler simply gets no `auth`. Requiring a signed-in user is up to the handler.
5. App Check: an invalid token fails with `unauthenticated` only when `enforceAppCheck` is set. Otherwise the handler runs with a warning and without `app`. A missing token fails only when `enforceAppCheck` is set.
6. The deprecated `authPolicy(auth | null, data)` runs, and returning false fails with `permission-denied`.
7. The handler runs. Its return value (awaited) goes through `encode` and is sent as `{result}`.

Other handler-side facts:

- **`CallableFunction.run(request)` calls the raw handler** after `onInit`. It skips the HTTP layer, token checks and encoding, and is meant for unit tests ("Used for unit testing" in the `.d.ts`). This is useful for the map's open question about testing handlers without the emulator.
- `onInit(callback)` (from `firebase-functions`) registers one callback that runs once, before the first invocation of any function that was wrapped with `withInit`. It does not run during discovery. This is where expensive set-up belongs (server `lib/common/onInit.js`).
- The returned function is an Express-style `(req, res) => Promise<void>`. It also carries `__endpoint`, a legacy `__trigger` getter, `run` and `stream`.

## 3. Options

### Per-function: `CallableOptions` (extends `HttpsOptions`, which extends `GlobalOptions` without `region` and `enforceAppCheck`)

- **Deploy-time** (they go into `__endpoint`): `region` (a string, an array of regions, or a param), `memory` (`"128MiB"` … `"32GiB"`), `timeoutSeconds` (callables and HTTPS allow up to 3600 s), `minInstances`, `maxInstances`, `concurrency` (default 80 when `cpu >= 1`, up to 1000), `cpu` (a number or `"gcf_gen1"`), `vpcConnector`, `vpcConnectorEgressSettings`, `serviceAccount`, `ingressSettings`, `labels`, `secrets` (`defineSecret(...)` or names), `invoker`, and `omit` (skip deploy and emulation).
- **Runtime-only** (they configure the request wrapper and never reach the manifest): `cors`, `enforceAppCheck`, `consumeAppCheckToken` (replay protection), `heartbeatSeconds`, and `authPolicy` (deprecated).
- Most values accept `Expression` params (`defineInt`, `defineString` and so on from `firebase-functions/params`) or `RESET_VALUE`.
- **`enforceAppCheck` and `consumeAppCheckToken` given as params are resolved with `.value()` when `onCall` is called**, which is at module load. During deploy (`FUNCTIONS_CONTROL_API=true`) this logs a "`.value()` invoked during function deployment" warning (server `params/types.js`).

### Global: `setGlobalOptions(GlobalOptions)` (`firebase-functions/v2` or `firebase-functions/options`)

- It is stored on `globalThis[Symbol.for("firebase-functions:v2:globalOptions")]`, so it works across duplicate copies of the module. Calling it twice logs "undefined behavior".
- **It is read when `onCall(...)` runs**, both to build `__endpoint` (spread under the per-function options, with labels merged) and to resolve `enforceAppCheck`. **`setGlobalOptions` must therefore run before any `onCall` is constructed.** With ES modules this means it must run in a module that is evaluated before the handler modules. A wrapper that builds its `onCall` lazily or in a different order changes which options apply.
- `GlobalOptions` also has `enforceAppCheck`, `preserveExternalChanges`, `networkInterface`/`vpcEgress`, and `omit`.

### Defaults

- With no region set, the manifest region is `REGION_TBD`. On deploy, firebase-tools keeps the region of an existing function with the same id, or falls back to `us-central1` (tools `prepare.resolveDefaultRegionsForBuild`, `services.FALLBACK_DEPLOYMENT_REGION`). The emulator always uses `us-central1` (tools `functionsEmulatorShared.emulatedFunctionsFromEndpoints`).
- On create, firebase-tools grants **public invoker** to every callable (`setInvokerCreate(..., ["public"])` in tools `release/fabricator.js`). Callables are reachable without IAM credentials, and all access control happens inside the function (Auth, App Check, handler checks).

## 4. Discovery and deploy: what a wrapper must keep intact

How `firebase deploy` and the emulator learn which functions exist:

1. firebase-tools resolves `firebase-functions` from the functions source directory and **runs that package's own `firebase-functions` binary** from a `node_modules/.bin` (it checks the source dir, the project dir, the SDK's `node_modules`, and the pnpm root) (tools `runtimes/node/index.js` `findFunctionsBinary`). So `firebase-functions` must be installed as a real dependency of the functions codebase. The CLI requires SDK `>= 3.20.0` (tools `versioning.js`).
2. If `functions.yaml` exists in the source dir, it is read as is. Otherwise the binary is started either as an HTTP admin server (`FUNCTIONS_CONTROL_API=true`, `GET /__/functions.yaml`, then `/__/quitquitquit`) or, when `FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH` is set, as a one-shot run that writes the manifest to a file (tools `discovery/index.js`; server `lib/bin/firebase-functions.js`).
3. **Discovery times out after 10 s** (`FUNCTIONS_DISCOVERY_TIMEOUT` overrides it, in seconds). Loading the module must stay cheap: no network calls and no Layer builds at top level. Defer that work to `onInit` or to the first call.
4. The binary loads the codebase's `package.json` `main` with `require`, and falls back to dynamic `import()` on `ERR_REQUIRE_ESM` or `ERR_REQUIRE_ASYNC_MODULE`. ESM entry points work (server `runtime/loader.js` `loadModule`).
5. `extractStack` walks the module's exports (server `runtime/loader.js`):
   - **Any export that is a `function` with an object `__endpoint` property is a function.** Its id is the export name, and `entryPoint` is the id with `-` replaced by `.`. Detection is duck-typed, not `instanceof`.
   - **Any other export that is a non-null object is recursed into**, and its keys are prefixed `parent-`. This is how grouping works: `export const users = { create: onCall(...) }` deploys `users-create`, and clients call it by the name `"users-create"`.
   - **The recursion has no cycle guard and does not care what the object is.** Exporting a contract object, a Layer, a schema instance or anything else with cyclic references from the functions entry point can overflow the stack during discovery. A non-cyclic object export that happens to contain a function with `__endpoint` deploys that function under a prefixed name. Functions without `__endpoint` (for example `Schema` classes) are skipped and not recursed into.
   - With ESM, a `default` export that is an object is recursed into as `default-…`.
6. The resulting manifest (`specVersion: v1alpha1`) has one `endpoints[id]` per function: `platform: "gcfv2"`, region, memory, labels, secrets, `callableTrigger: {}` and so on (server `onCall`, `runtime/manifest.js`). **The `callableTrigger` key marks an endpoint as a callable** (tools `build.isCallableTriggered`, `hasOwnProperty`). That decides the public invoker, the `deployment-callable` label and the emulator's handling.
7. In production the platform loads the same module and calls the export at `entryPoint` as an HTTP handler `(req, res)`.

What a wrapper must preserve, then:

- **Export the exact function that `onCall` returns**, as a named export, at the path the client calls. Wrapping it in another function drops `__endpoint`, `run` and the request pipeline. Copying `__endpoint` onto a new function is possible, since detection is duck-typed, but it also bypasses `onCall`'s own handling.
- The export name (with `group-` prefixes) is the deployed name, the emulator name, and the name the client passes to `httpsCallable`. So **the contract cannot own the function's name unless the export is put at that name**. A contract that carries a name must agree with where the user exports the handler, and nothing in firebase-tools checks this.
- Build the `onCall` at module load (that is when `__endpoint` is read), but keep the actual work lazy.
- Keep `setGlobalOptions` ordered before handler construction.

## 5. The Functions emulator

- **Configuration:** `firebase.json` needs a `"functions"` entry (`source`, `runtime` such as `nodejs22`, optional `codebase` and `predeploy`). Port 5001 is the default for `emulators.functions` (tools `emulator/constants.js`). The repo's current `firebase.json` only configures Firestore. The emulator loads the built `main` of the functions package, so a TypeScript codebase must be compiled first (or have `main` point at JS that runs).
- **Discovery** works as for deploy, through the same runtime delegate `discoverBuild`. The emulator watches the source dir with chokidar and re-discovers on changes (tools `functionsEmulator.js`).
- **Routing:** `/<projectId>/<region>/<name>` maps to the trigger `<region>-<name>`. Unknown names get `404` with the list of valid functions, which is useful for debugging name mismatches (tools `handleHttpsTrigger`).
- **The emulator sets `FIREBASE_DEBUG_MODE=true` and `FIREBASE_DEBUG_FEATURES={"skipTokenVerification":true,"enableCors":true}`** (tools `getEmulatorEnvs`). With these, the callable wrapper **decodes Auth and App Check JWTs without verifying them** (server `unsafeDecodeIdToken`, `unsafeDecodeAppCheckToken`):
  - Tests can send any well-formed JWT. `sub` becomes `auth.uid`, or `app.appId` for App Check, and an unsigned `alg: none` token works.
  - `enforceAppCheck` still requires an App Check header to be present, but not a valid one.
  - Tokens minted by the Auth emulator work too.
- The emulator also sets `FUNCTIONS_EMULATOR=true`, `GCLOUD_PROJECT`, `TZ=UTC`, and the `*_EMULATOR_HOST` variables of the other running emulators. The Admin SDK inside a handler therefore talks to the Firestore and Auth emulators automatically.
- **Calling from a test:**
  - With the client SDK: `const functions = getFunctions(app, region)`, then `connectFunctionsEmulator(functions, "127.0.0.1", 5001)` before the first call, then `httpsCallable(functions, name)(data)`.
  - With plain HTTP: `POST http://127.0.0.1:5001/<projectId>/<region>/<name>` with `{"data": …}`. The emulator's project id must match `app.options.projectId`. A `demo-*` project id keeps everything offline.
- `firebase emulators:exec --only functions,firestore "<test command>"` starts the emulators, runs the tests, and stops them.

## 6. Other details worth knowing

- **Import paths in v7:** `firebase-functions/https` and `firebase-functions/v2/https` export `onCall`, `onRequest`, `HttpsError` and `onCallGenkit`. The package root (`main: lib/v2/index.js`) is v2. v1 lives under `firebase-functions/v1`. `onInit` comes from `firebase-functions` (and the `v2` entry), and `setGlobalOptions` from `firebase-functions/options` or `firebase-functions/v2`.
- `firebase-functions@7` depends on `express@^5`, `cors` and `protobufjs`, and needs Node `>= 18`.
- `onCallGenkit` shows the pattern a wrapper can copy: it is a plain `onCall(opts, async (req, res) => …)` that bridges into another runtime and then adds data to `__endpoint.callableTrigger` (`genkitAction`). It also branches on `req.acceptsStreaming` and pipes chunks to `res.sendChunk`.
- The client `HttpsCallable<Req, Res, Stream>` types are only type parameters, with no runtime check. `httpsCallable` is synchronous and cheap; the token lookups happen on each call.
