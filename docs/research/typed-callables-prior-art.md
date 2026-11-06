# Prior art for typed Firebase callables

Research for [Prior art for typed Firebase callables](https://github.com/VisioLab/effect-firebase/issues/158) (map [Wayfinder: Type-safe callable functions](https://github.com/VisioLab/effect-firebase/issues/155)). This note records what existing libraries and patterns do. It makes no design decisions.

## Sources

Every library was read from its published source, downloaded on 2026-11-06:

| Key                | Project                                                                                                                                                                                                                                                                                                                                                                                    | Version / ref                            | Last activity |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------- |
| **[fwal]**         | [fwal/effect-firebase](https://github.com/fwal/effect-firebase), `@effect-firebase/admin`                                                                                                                                                                                                                                                                                                  | npm `1.0.1`, repo `HEAD`                 | 2026-10       |
| **[trpc-adapter]** | [EdRW/trpc-adapters](https://github.com/EdRW/trpc-adapters), `trpc-firebase-functions`                                                                                                                                                                                                                                                                                                     | npm `1.0.0`                              | 2025-10       |
| **[trpc-v12]**     | tRPC v12 Firebase recipe: [`www/v12/docs/adapters/firebase.md`](https://github.com/trpc/trpc/blob/v12/www/v12/docs/adapters/firebase.md) and [`next/.agent-docs/decisions/firebase-callable-recipe.md`](https://github.com/trpc/trpc/blob/v12/next/.agent-docs/decisions/firebase-callable-recipe.md), branch `v12`; context in [trpc/trpc#6388](https://github.com/trpc/trpc/issues/6388) | unreleased                               | 2026          |
| **[firecall]**     | [tylim88/FireCall](https://github.com/tylim88/FireCall) (server) + [tylim88/FireCaller](https://github.com/tylim88/FireCaller) (client)                                                                                                                                                                                                                                                    | npm `firecall@2.0.5`, `firecaller@1.1.6` | 2022-08       |
| **[fireschema]**   | [yarnaimo/fireschema](https://github.com/yarnaimo/fireschema)                                                                                                                                                                                                                                                                                                                              | npm `4.0.4`                              | 2022-05       |
| **[ffe]**          | [ftzi/firebase-functions-extended](https://github.com/SrBrahma/firebase-functions-extended)                                                                                                                                                                                                                                                                                                | repo `HEAD`                              | 2022-02       |
| **[ff]**           | `firebase-functions` (server SDK)                                                                                                                                                                                                                                                                                                                                                          | `7.4.0`                                  | —             |
| **[fjs]**          | `@firebase/functions` (client SDK, re-exported by `firebase/functions`)                                                                                                                                                                                                                                                                                                                    | `0.14.0`                                 | —             |

Searches on GitHub and npm for "typed callable", "firebase functions zod", "trpc firebase", "effect firebase" and "Effect RPC over onCall" turned up nothing else with a shared contract. No Effect `Rpc`/`HttpApi` integration over the callable protocol exists that I could find.

## Summary table

|                    | Contract declared as                                                               | Server derived                                         | Client derived                                   | Errors                                                                                                              | Auth                                                  | Deploys with plain `firebase deploy` |
| ------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| **[fwal]**         | Effect `Schema`s passed as `inputSchema`/`outputSchema` options on the server only | Yes, `onCallEffect`                                    | No; client uses raw `httpsCallable` by string    | `HttpsError` passes through, everything else becomes Firebase's masked `internal`                                   | Raw `request.auth` in a context object                | Yes, returns `onCall(...)`           |
| **[trpc-adapter]** | tRPC router                                                                        | Router served from one `onRequest`                     | tRPC client over HTTP                            | tRPC's own HTTP errors                                                                                              | Manual ID-token check in tRPC context                 | Yes, but not a callable              |
| **[trpc-v12]**     | tRPC procedure                                                                     | Hand-written `onCall` per procedure calling `t.call()` | No                                               | Table from tRPC codes to `HttpsError` codes                                                                         | `request.auth` copied into `ctx`                      | Yes                                  |
| **[firecall]**     | Plain object `{ req: zod, res: zod, name: string }` shared by both sides           | Yes, `onCall(schema, config, handler)`                 | Yes, `callable(schema)`                          | Handler returns `{ code, message }` unions, turned into `HttpsError`; client never throws, returns `{ code }` union | `route: 'private' \| 'public'` narrows `context.auth` | Yes, dynamic `exports[name] = ...`   |
| **[fireschema]**   | Server module; zod `input`/`output` schemas per callable                           | Yes, `typedFunctions.callable`                         | Yes, `TypedCaller<typeof import('./functions')>` | Input failure → `invalid-argument`; rest untouched; client returns `{ error }`                                      | Raw v1 `context`                                      | Yes, uses export groups              |

## How Firebase itself types callables

These are the hooks every library builds on.

- **Server.** `onCall<T, Return, Stream>(opts, handler)` returns `CallableFunction<T, Promise<Return>, Stream>` **[ff]** `lib/v2/providers/https.d.ts:212`. `T` is only a type parameter: nothing validates `request.data`. `CallableFunction` exposes `run(request)` and `stream(request, response)` for unit tests (`:182-192`).
- **Client.** `httpsCallable<RequestData, ResponseData, StreamData>(functions, name, options)` **[fjs]** `dist/functions-public.d.ts:147`. The generics are asserted by the caller. Nothing ties `name` to the generics or to the server.
- **First-party typed callable.** `onCallGenkit(action)` derives `CallableFunction<ActionInput<A>, Promise<ActionOutput<A>>, ActionStream<A>>` from a Genkit action's schemas **[ff]** `https.d.ts:240-241`. It is the only built-in that derives callable types from a schema, and it is server-only.
- **Errors.** `new HttpsError(code, message, details)` serializes as `{ error: { message, status, details? } }` (`lib/common/providers/https.js:105-124`). Any thrown value that is not an `HttpsError` is logged as "Unhandled error" and replaced by `HttpsError('internal', 'INTERNAL')` (`:569-571`). Firebase checks this with `instanceof`, so the error must come from the same `firebase-functions` copy the function is deployed with. The client rebuilds a `FunctionsError` with `code` (`functions/<code>`), `message` and decoded `details` **[fjs]** `dist/esm/index.esm.js:251-289`.
- **Auth.** The handler gets `request.auth` (`uid`, decoded `token`) and `request.app` (App Check). `CallableOptions.authPolicy` with `isSignedIn()` / `hasClaim()` exists but is marked `@deprecated` (`https.d.ts:144-165`). `enforceAppCheck` and `consumeAppCheckToken` are options on `CallableOptions` (`:106-136`).
- **Wire encoding.** The client encoder turns `Date` into an ISO string, `null`/`undefined` into `null`, and recurses into arrays and objects. Anything else throws ([fjs] `dist/esm/index.esm.js:41-70`). Nothing turns the ISO string back into a `Date`. [ffe]'s README warns that `undefined` properties arrive as `null`, so it recommends `.nullish()` over `.optional()`.
- **Deploy discovery.** firebase-functions' loader walks the module's exports. A value is a function when it is a function carrying `__endpoint`. Nested plain objects are recursed into, and the deployed name is the export path joined with `-` (`lib/runtime/loader.js:29-54`). **The deployed name is always the export key**: a wrapper cannot pick it, so a contract's `name` has to match an export key by convention or by a check.

## Each library

### fwal/effect-firebase (`@effect-firebase/admin`)

The only Effect-based Firebase functions library found. It targets Effect 4 and firebase-functions 7, with `firebase-functions` as a peer dependency.

- **Contract.** None as a separate value. The server passes Effect `Schema`s as `inputSchema` / `outputSchema` options to `onCallEffect` (`packages/admin/src/lib/functions/on-call.ts:22-61`). The example app keeps the schemas and a `name` constant in a shared package (`example/shared/src/functions/on-example-call.ts`). The client does not use that `name`; it calls `httpsCallable(getFunctions(app, 'europe-north1'), 'onExampleCall')` untyped (`example/app/src/routes/functions.tsx:30-33`).
- **Server.** Four overloads cover both schemas, input only, output only, or none (`on-call.ts:71-104`). With an input schema the handler gets `(decodedInput, CallableContext)`; without one it gets the raw `(request, response)`. The return type is `CallableFunction<Schema.Codec.Encoded<I>, Promise<Schema.Codec.Encoded<O>>>`, so the wire types sit on the exported value. Effects run on a `ManagedRuntime` passed as `runtime`; a factory form builds and disposes a runtime per call (`run.ts`).
- **Errors.** Input decode failure becomes `HttpsError('invalid-argument', <schema message>)`. Output encode failure becomes `HttpsError('internal', 'Failed to encode function output')`. Both can be overridden with an `onSetupError` option (`recover-callable-setup-error.ts`). The handler's own failure is `Cause.squash`ed and rethrown as is (`on-call.ts:170-181`). So a typed `E` in the handler does **not** become an `HttpsError` unless the handler already built one. Anything else reaches the client as `internal`. Errors that are `HttpsError` or carry `ErrorReporter.ignore` are not logged as defects (`report.ts`).
- **Errors in practice.** The example app catches all errors and returns them as data: `Output = Schema.Union([PostModel.json, ErrorSchema])`, with a `SerializeError` / `ErrorHandler` pair (`example/backend/src/lib/error-handler.ts`). This works around the fact that typed failures cannot travel as `HttpsError`.
- **Auth.** `CallableContext` copies `auth`, `app`, `rawRequest`, `instanceIdToken`, `acceptsStreaming` and `response` (`on-call-helpers.ts:7-37`). Auth is not a service and not narrowed.
- **Streaming.** `onCallStreamEffect` takes `inputSchema` and `chunkSchema`. The handler returns a `Stream`, and each element is sent with `sendChunk`. The collected chunks are also returned as the final `data` for clients that do not stream. The stream is interrupted when `response.signal` aborts (`on-call-stream.ts`).
- **Testing.** `makeCallableRequest` and `streamCallable` build a fake request/response for unit tests (`callable-testing.ts`).
- **Deploy.** It returns the real `onCall(...)` value, so plain `firebase deploy` works.
- **Weaknesses.** It covers the server only: no client derivation, and no compile-time link between the function name, the export key and the client call. There is no error channel in the contract. Schemas are optional, so the untyped `request` path stays open.

### trpc-firebase-functions (EdRW/trpc-adapters)

- **Contract.** A tRPC router.
- **Server.** `createFirebaseHandler({ router, createContext })` returns an Express-style handler for **`onRequest`**, which forwards to tRPC's `nodeHTTPRequestHandler` with `path = req.path.slice(1)` (`packages/firebase-functions/src/index.ts`). The README lists `onCall` support as "🤔 … please consider opening an issue or a PR".
- **Client.** Any tRPC client over HTTP, not `httpsCallable`.
- **Errors.** tRPC's HTTP error format. No `HttpsError`.
- **Auth.** Not automatic. The auth example reads `Authorization: Bearer`, calls `getAuth().verifyIdToken()` and puts the result in tRPC context (`examples/v2-https-function-auth/src/lib/auth.ts`). This is exactly the work the callable protocol does for free.
- **Deploy.** Works, as one `onRequest` function for the whole router.
- **Weaknesses.** It is not a callable, so it falls outside the map's scope. Its peer range is `firebase-functions ^6`.

### tRPC v12 Firebase callable recipe

[trpc/trpc#6388](https://github.com/trpc/trpc/issues/6388) asked for a callable adapter. One contributor got a server working by routing a single `onCall` through the router (`data.function` naming the procedure). He stopped on the client because "the way firebase does monorepo doesn't cleanly fit with trpc" (separate `package.json`/`tsconfig.json`, CJS server, ESM client). The maintainers answered with a recipe in the unreleased v12 docs.

- **Contract.** A tRPC procedure.
- **Server.** A hand-written `onCall(async (request) => t.call(appRouter.post.create, request.data, { ctx: { uid: request.auth?.uid ?? null } }))` per procedure. The procedure validates its own input.
- **Client.** Not covered.
- **Errors.** A literal table from tRPC codes to `FunctionsErrorCode`: `BAD_REQUEST` and `UNPROCESSABLE_CONTENT` → `invalid-argument`, `UNAUTHORIZED` → `unauthenticated`, `FORBIDDEN` → `permission-denied`, `NOT_FOUND` → `not-found`, `CONFLICT` → `already-exists`, `PRECONDITION_FAILED` → `failed-precondition`, `TOO_MANY_REQUESTS` → `resource-exhausted`, `TIMEOUT` → `deadline-exceeded`, `CLIENT_CLOSED_REQUEST` → `cancelled`, `NOT_IMPLEMENTED` → `unimplemented`, `SERVICE_UNAVAILABLE` → `unavailable`. A mapped error is rethrown as `new HttpsError(code, error.message, error.data)`. Anything unmapped is rethrown unchanged, so Firebase masks it as `internal`.
- **Why a recipe and not an adapter** (from the decision record): an adapter "would have to import `firebase-functions` (for `HttpsError`, which Firebase checks with `instanceof`) or take the class as an option, for about ten lines of glue". The callable protocol "is plain JSON, so it can't carry the serializer's types either way". What they gave up: "a typed `firebaseCallable(procedure)` one-liner".
- **Wire encoding.** The docs say outputs lose `Date`s, `Map`s and other transformer types, and to return strings or numbers instead.
- **Deploy.** Plain `onCall`, so it works.
- **Weaknesses.** Server only, and the name and export are wired by hand per procedure.

### FireCall + FireCaller (tylim88)

The closest match to "one contract, server and client derived from it". The project has been dormant since 2022 and targets the v1 `functions.https.onCall` API. The README opens with "API interface not quite good to be honest, will redesign the API in V3".

- **Contract.** A plain object shared by both sides: `{ req: ZodType, res: ZodType, name: string }` (`FireCall/src/exp.ts`). The name is part of the contract, so the client cannot call the wrong function.
- **Server.** `onCall(schema, { route, func?, onErrorLogging?, changeBuiltInErrorCodeAndMessage? }, handler)` returns `{ onCall, schema, config }`, not the function itself. `exp({...})` checks names are unique at load time, and the user writes `exports[name] = onCall` in a loop (`exp.ts`, README "Export Functions"). Deploy discovery still works because the loader reads the populated `exports`.
- **Errors.** The handler must return `{ code: 'ok', data }` or `{ code: <FunctionsErrorCode>, message, err? }`. A non-`ok` return becomes an `HttpsError`. A thrown error becomes `unknown`, input zod failure `invalid-argument`, output zod failure `internal`, and missing auth on a private route `unauthenticated`. All built-in codes and messages can be overridden (`onCall.ts:98-170`).
- **Client.** `callable(schema, functions?)` wraps `httpsCallable<z.infer<req>, z.infer<res>>(functions, schema.name)`. It **never throws**: it resolves to `{ code: 'ok', data } | { code: 'functions/<code>', message } | { code: 'schema-out-of-sync', message }`. Its reason: "it is impossible to type-safe rejected promise" (FireCaller README "Calling", `src/index.ts`). The client re-validates the response against `res` and reports `schema-out-of-sync` on mismatch.
- **Auth.** `route: 'private'` makes `context.auth` non-nullable in the handler type and rejects unauthenticated calls before the handler runs.
- **Weaknesses.**
  - Both sides `parse` for validation only and **throw the parsed result away**. The server hands the handler `data as z.infer<...>` (`onCall.ts:102,118`), and the client returns `result.data` (`FireCaller/src/index.ts:75-83`). So zod transforms, defaults and coercions never apply. Decoded and encoded types are treated as the same.
  - The error channel is only Firebase's fixed code set plus a free-form `message`. There are no typed, tagged domain errors on the client, and `details` is not used.
  - It needs `exports[name] = ...` boilerplate, and the duplicate-name check runs at runtime only.

### fireschema (yarnaimo)

A typed Firestore framework that also covers Cloud Functions. Last released 2022, on the v1 `FunctionBuilder` API.

- **Contract.** There is no separate contract value. The server module is the contract: `export const callable = { createUser: typedFunctions.callable({ schema: { input, output }, builder, handler }) }` (README "Usage - Cloud Functions"). Types are attached with a phantom `withType<FunTypes.Callable.Meta<SI, SO>>()` on the `onCall` result (`src/core/functions/factory/_TypedFunctions.ts:24-56`).
- **Client.** `new TypedCaller<typeof import('./functions')>(functionsApp).call('createUser', data)`. This is a **type-only import of the server module**. The function name is derived from the export group: `['callable', functionPath].join('-')` (`src/core/functions/client/TypedCaller.ts:25-30`), which matches the loader's `-`-joined group naming. It returns `{ data } | { error }` and never throws. It strips `undefined` keys before sending.
- **Errors.** Input `safeParse` failure becomes `HttpsError('invalid-argument', …)`. Everything else is untouched.
- **Weaknesses.**
  - Like FireCall, it validates but passes the **raw** `data` to the handler (`_TypedFunctions.ts:40-49`). Output is **not** validated or encoded at all, despite the `output` schema.
  - `typeof import` of the server module drags server types (`firebase-admin`, `firebase-functions`) into the client's type check. That is the same packaging friction the tRPC contributor hit.
  - Every callable must live under the `callable` export group.

### firebase-functions-extended (ftzi)

Zod schema declaration and validation for `onCall`, with a matching `firebase-functions-extended-client`. The README says it is used in production but "currently I have no will to better prepare it to publicly publish it", and its roadmap item is "Write this README". It was last pushed in 2022. The one fact worth keeping from it is the `undefined` → `null` warning above.

## Patterns across the survey

1. **Where the contract lives.**
   - A standalone shared value (FireCall: `{ req, res, name }`) keeps server-only imports out of the client. It does need a name in the contract and a convention or check that ties it to the export key.
   - Deriving from the server module (fireschema's `typeof import`) needs no name in the contract. It leaks server types into the client build.
   - Schemas used only on the server ([fwal], tRPC recipe) give no client typing.
2. **Name binding.** The deployed name is always the export path (`-`-joined for groups). No library can enforce at compile time that the contract's name equals the export key. FireCall checks duplicates at runtime, and fireschema fixes one export group.
3. **Decode vs. validate.** The zod-era libraries validate and discard the parse result, so transforms never apply. Only [fwal] actually decodes input and encodes output with the schema, and types the exported function with the **encoded** types.
4. **Error mapping.**
   - Everyone ends at `HttpsError`, because anything else becomes a masked `internal`.
   - The approaches differ. Some return errors as data ([fwal] example, FireCaller's never-throw client, fireschema's `{ error }`). Some return a code union from the handler (FireCall). Some map a fixed table of codes (tRPC recipe).
   - **None carries a typed, schema-encoded domain error through `HttpsError.details` and decodes it on the client.** `details` is the only open slot in the protocol for that.
5. **Client error shape.** Both client libraries chose a never-throw result union because a rejected promise cannot be typed. In Effect, the error channel removes that reason.
6. **Auth.**
   - FireCall narrows `auth` with a `route: 'private'` flag, so it is typed and checked before the handler.
   - The others pass raw `request.auth`.
   - Firebase's own `authPolicy` / `isSignedIn` / `hasClaim` is deprecated.
7. **Deploy.** Every library that targets callables returns or exports the real `onCall(...)` value and works with plain `firebase deploy`. None needs its own tooling.
8. **Wire encoding.** JSON only. `Date` becomes an ISO string one way, and `undefined` becomes `null`. The tRPC maintainers name this as the reason a transformer-based protocol cannot sit on callables.
9. **Streaming.** Only [fwal] supports v2 streaming (`onCallStreamEffect`, `chunkSchema`, interruption on abort). The client-side `.stream()` is still untyped there.
