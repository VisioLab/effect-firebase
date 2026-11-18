# What a gRPC Firestore transport on Node needs

Research for [#261](https://github.com/VisioLab/effect-firebase/issues/261), under the map [#259 Effect-native Firestore engine](https://github.com/VisioLab/effect-firebase/issues/259).

Question: what does speaking Firestore's gRPC API from Node take (HTTP/2, binary protobuf framing, metadata headers, service-account and emulator auth), how do `@google-cloud/firestore` and `@firebase/firestore`'s Node build do it, and what do Effect and `@effect/platform-node` offer for HTTP/2 client streams?

## Sources

All claims below cite one of these. Versions are the ones installed in this repo's `node_modules/.pnpm` (or downloaded from the npm registry where noted), read in November 2026.

| Tag       | Source                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SPEC]    | gRPC over HTTP/2: <https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md>                                                                                                                                                                                                                                                                         |
| [PROTO]   | `google/firestore/v1/firestore.proto`: <https://github.com/googleapis/googleapis/blob/master/google/firestore/v1/firestore.proto>                                                                                                                                                                                                                          |
| [GCF]     | `@google-cloud/firestore@9.1.0`, `build/src/index.js` (published build of `googleapis/nodejs-firestore` `dev/src/index.ts`)                                                                                                                                                                                                                                |
| [GCF-API] | `@google-cloud/firestore-api@0.2.0`, `build/src/v1/firestore_client.js` (the generated GAPIC client that `@google-cloud/firestore` 9 depends on)                                                                                                                                                                                                           |
| [GAX]     | `google-gax@6.3.0`, `build/src/grpc.js`, `build/src/routingHeader.js`                                                                                                                                                                                                                                                                                      |
| [GAL]     | `google-auth-library@11.3.0`, `build/src/auth/jwtclient.js`, `build/src/auth/jwtaccess.js`, `build/src/gtoken/getToken.js`                                                                                                                                                                                                                                 |
| [FB]      | `@firebase/firestore@4.18.0`, `src/platform/node/grpc_connection.ts`, `load_protos.ts`, `connection.ts`, `src/remote/persistent_stream.ts`, `src/api/credentials.ts` (TypeScript sources embedded in the package's `dist/common-*.node.mjs.map`; upstream at <https://github.com/firebase/firebase-js-sdk/tree/main/packages/firestore/src/platform/node>) |
| [GRPCJS]  | `@grpc/grpc-js@1.14.6`, `build/src/transport.js`, `compression-filter.js`, `stream-decoder.js`, `subchannel-call.js`                                                                                                                                                                                                                                       |
| [EFFECT]  | `effect@4.1.0` `src/` (`http/`, `rpc/`, `socket/`, `encoding/`, `crypto/`, `observability/internal/protobuf.ts`)                                                                                                                                                                                                                                           |
| [PN]      | `@effect/platform-node@4.1.0` `src/NodeHttpClient.ts`, `NodeHttpServer.ts` (tarball from the npm registry; not installed in this repo)                                                                                                                                                                                                                     |
| [UNDICI]  | `undici@8.12.4` `lib/dispatcher/client.js`, `client-h2.js`, `types/client.d.ts`, `types/dispatcher.d.ts`, `docs/docs/api/Client.md` (tarball from the npm registry; `@effect/platform-node@4.1.0` depends on `undici ^8.12.2`)                                                                                                                             |

## 1. Wire framing

- A gRPC call is one HTTP/2 stream. The request is `Request-Headers *Length-Prefixed-Message EOS`; the response is `(Response-Headers *Length-Prefixed-Message Trailers) / Trailers-Only` [SPEC "Outline"].
- Required request headers: `:method POST`, `:scheme http|https`, `:path /<Service-Name>/<method>`, `te: trailers`, `content-type: application/grpc[+proto]`; optional `:authority`, `grpc-timeout`, `grpc-encoding`, `grpc-accept-encoding`, `user-agent` [SPEC "Requests"]. For Firestore the service name is `google.firestore.v1.Firestore` (proto `package google.firestore.v1; service Firestore`) [PROTO], so Listen is `POST /google.firestore.v1.Firestore/Listen`.
- grpc-js sends exactly these: it sets `:authority`, `user-agent` (`grpc-node-js/<version>`), `content-type: application/grpc`, `:method POST`, `:path`, `te: trailers` on every call, and opens the session with `http2.connect(...)` from Node's built-in `node:http2` [GRPCJS `transport.js` L20, L77-80, L405-412, L592].
- Each message is a **Length-Prefixed-Message**: 1-byte Compressed-Flag (0/1), 4-byte big-endian Message-Length, then the protobuf bytes [SPEC "Length-Prefixed-Message"]. grpc-js writes it with `writeUInt8(compress ? 1 : 0, 0)` and `writeUInt32BE(length, 1)` [GRPCJS `compression-filter.js` L40-41, L66-67] and reads the length with `readUInt32BE` [GRPCJS `stream-decoder.js` L60].
- DATA frame boundaries are unrelated to message boundaries, so the reader must reassemble across chunks [SPEC "Data Frames"].
- Custom metadata travels as HTTP/2 headers; names ending in `-bin` carry base64 values [SPEC "Requests", L47 and L68].
- The call status is in **trailers**: `grpc-status` (0-16), `grpc-message` (percent-encoded), optional `grpc-status-details-bin`. Status is sent in trailers even on success; an immediate error may arrive as Trailers-Only (a single HEADERS frame with `:status 200`, content-type and status) [SPEC "Responses"]. Clients must synthesize a status when a broken proxy returns non-200 or omits `grpc-status` [SPEC "Responses"]. grpc-js reads `grpc-status`/`grpc-message` from the `trailers` event of the HTTP/2 stream [GRPCJS `subchannel-call.js` L127, L430-448].
- `RST_STREAM` is an immediate full close, mapped to a gRPC error code [SPEC "Errors"].
- Listen and Write are bidirectional streams (`rpc Write(stream WriteRequest) returns (stream WriteResponse)`, same for Listen), "only available via gRPC or WebChannel (not REST)" [PROTO L204-221]. All other RPCs are unary or server-streaming (`RunQuery`, `BatchGetDocuments`, `RunAggregationQuery`, `ExecutePipeline` stream responses) [PROTO; GCF-API `descriptors.stream`].

## 2. Metadata headers

### `@google-cloud/firestore` (admin path)

- `google-cloud-resource-prefix: projects/{projectId}/databases/{databaseId}` on every call, merged with user `customHeaders` [GCF L101 `CLOUD_RESOURCE_HEADER`, L712-714 `formattedName`, `createCallOptions` L1261-1275].
- `x-goog-request-params` is set by the GAPIC client per method from the request's routing field, URL-encoded with `querystring.stringify` [GAX `routingHeader.js` `fromParams`]: `name=` for GetDocument/DeleteDocument, `document.name=` for UpdateDocument, `database=` for BeginTransaction/Commit/Rollback/BatchWrite/BatchGetDocuments, `parent=` for CreateDocument/RunQuery/RunAggregationQuery/ListDocuments/PartitionQuery/ListCollectionIds [GCF-API L332-1519]. ExecutePipeline instead extracts `project_id` and `database_id` from `database`, matching the `google.api.routing` annotation in the proto [GCF-API L829-860; PROTO L153-160].
- **Listen and Write get no `x-goog-request-params`** from the GAPIC client: `listen(options)` and `write(options)` take no request, so there is nothing to route on [GCF-API L950-977]. Only the resource-prefix header identifies the database for those streams on this path.
- `x-goog-api-client: gax/<v> gapic/<v> gl-node/<node> grpc/<grpc-js v> gccl/<firestore v>[ fire/<v>][ fire-admin/<v>]` [GCF-API L153-168, L200; GCF L490-500]. gax converts all headers into a `grpc.Metadata` and never lets per-call headers override `x-goog-api-client` [GAX `metadataBuilder` L288-313].
- Default channel options: `grpc-node.flow_control_window: 256 KiB`, `grpc.use_local_subchannel_pool: 1` [GCF L533-536]; gax adds unlimited `grpc.max_receive_message_length`/`max_send_message_length` and `grpc.initial_reconnect_backoff_ms: 1000` [GAX L380-382]. Endpoint `firestore.googleapis.com:443` [GCF-API L120, `port` 443; PROTO `default_host`].

### `@firebase/firestore` Node build (client path)

`createMetadata` sets, on every unary call and stream [FB `grpc_connection.ts` L43-83]:

- the auth token's headers (`Authorization: Bearer <id token>` from `OAuthToken` [FB `credentials.ts` L83-92]) and App Check token headers;
- `X-Firebase-GMPID: <appId>`;
- `X-Goog-Api-Client: gl-node/<node> fire/<sdk> grpc/<grpc-js>`;
- `Google-Cloud-Resource-Prefix: projects/{p}/databases/{d}` (kept, per the source comment, until the emulator understands the newer header);
- `x-goog-request-params: projects/{p}/databases/{d}` — the raw database path, **not** the `database=...` key/value form the GAPIC client uses;
- `X-Goog-Api-Key` when an API key is configured, then any `_customHeaders`.

It also injects `database: projects/{p}/databases/{d}` into every unary and server-streaming request body [FB L155, L217]. Channel options: flow control window 256 KiB (configurable), max send/receive 17 MiB [FB L123-128].

## 3. Auth

### Production, service account (admin)

- gax builds channel credentials as `combineChannelCredentials(createSsl(), createFromGoogleCredential({ getRequestHeaders }))`, where `getRequestHeaders` calls `google-auth-library`'s client for the current `Authorization` header per call [GAX `_getCredentials` L184-200]. The GAPIC client sets `auth.useJWTAccessWithScope = true`, `auth.defaultServicePath = firestore.googleapis.com` and default scopes `cloud-platform` + `datastore` [GCF-API L144-152, L315-320].
- With a service-account key, `JWT.getRequestMetadataAsync` then takes the **self-signed JWT** path: it signs a JWT locally (`scope`, `iat`, `exp`) with the key and sends it directly as `Bearer`, without calling the token endpoint [GAL `jwtclient.js` L71-111, `jwtaccess.js` L78-112]. The token-exchange path (JWT-bearer grant `urn:ietf:params:oauth:grant-type:jwt-bearer` to `https://oauth2.googleapis.com/token`) is used when user scopes are set and `useJWTAccessWithScope` is off [GAL `gtoken/getToken.js` L19-30; `jwtclient.js` L112-113].
- On GCP runtimes without a key file, `GoogleAuth` resolves Application Default Credentials (metadata server via `gcp-metadata`) [GAL dependencies: `gcp-metadata`, `gaxios`, `jws`].
- Project id: if unset, `@google-cloud/firestore` asks the auth client (`gapicClient.getProjectId()` → `auth.getProjectId()`) during `initializeIfNeeded` [GCF L1226-1252; GCF-API `getProjectId`].

### Production, end user (client)

The Firebase client sends the user's Firebase Auth ID token as `Authorization: Bearer` per call as gRPC metadata, not channel credentials; the channel itself is `createSsl()` or `createInsecure()` by `databaseInfo.ssl` [FB L57-59, L120-122].

### Emulator

- `@google-cloud/firestore`: when `FIRESTORE_EMULATOR_HOST` is set it overrides `host` and forces `ssl: false` [GCF L606-613]; with `ssl: false` it uses `grpc.credentials.createInsecure()` (plaintext HTTP/2, h2c) [GCF L543-546] and adds `Authorization: Bearer owner` unless the user supplied an `Authorization` header, so the emulator treats the caller as admin [GCF L1226-1239].
- `@firebase/firestore`: insecure channel when `ssl` is false; auth headers come from whatever credentials provider is configured — `EmulatorAuthCredentialsProvider` when a mock user token is supplied [FB `credentials.ts` L157].
- The emulator serves gRPC on the same host:port both SDKs use for it (this repo: `127.0.0.1:8080`, `firebase.json`).

## 4. How the SDKs open calls

### `@google-cloud/firestore`

- **Loading**: GAPIC client from `@google-cloud/firestore-api`, protos via protobufjs/`@grpc/proto-loader` inside gax; `createStub(new Firestore(...))` per channel [GCF-API L219-222; GAX `createStub` L353-399].
- **Pool**: a `ClientPool` of GAPIC clients, at most 100 concurrent requests per client, 1 idle channel kept by default [GCF L115, L122, L512-556].
- **Unary**: `request(methodName, request)` → `gapicClient[methodName](request, callOptions)` with the resource-prefix header [GCF L1412-1428]. Writes go through unary `Commit` / `BatchWrite`, transactions through `BeginTransaction` / `Rollback` [GCF `write-batch.js` L444-483, `bulk-writer.js` L175-176, `transaction.js` L441].
- **Server streaming**: `requestStream(...)` for `runQuery`, `batchGetDocuments`, `runAggregationQuery`, `partitionQueryStream` [GCF `reference/query-util.js` L191, `document-reader.js` L122, `reference/aggregate-query.js` L169, `collection-group.js` L76].
- **Listen**: the only bidi stream it uses. `requestStream('listen', bidirectional=true, request)` calls `gapicClient.listen(callOptions)`, writes the initial `ListenRequest` once the stream is open, and returns the stream paused; an error before the first byte rejects and is retried with exponential backoff [GCF L1445-1500, `_initializeStream` L1338-1400; `watch.js` L320]. It never uses the **Write** stream.
- **REST fallback**: with `preferRest` (or `FIRESTORE_PREFER_REST`) non-streaming-bidi calls use `google-gax/fallback` over HTTP/1.1; a call that needs a bidi stream (Listen) always gets a gRPC client [GCF L512-531, L595-602].

### `@firebase/firestore` Node build

- **Loading**: `protoLoader.fromJSON(protos.json, { longs: String, enums: String, defaults: true, oneofs: false })` then `grpc.loadPackageDefinition` — the JSON protos ship inside the package [FB `load_protos.ts` L32-47]. `newConnection` returns a `GrpcConnection` [FB `connection.ts`].
- **Stub**: one cached `new firestore.Firestore(host, credentials, options)` [FB L117-136].
- **Unary**: `invokeRPC` → `stub[rpcName](request, metadata, callback)`; errors mapped from gRPC code to `FirestoreError` [FB L138-190].
- **Server streaming**: `invokeStreamingRPC` collects `data` events until `end` or an expected count [FB L192-253].
- **Bidi (Listen and Write)**: `openStream(rpcName)` → `stub[rpcName](metadata)`, wrapped in a `StreamBridge`. `onOpen` is simulated with `setTimeout(0)` because gRPC has no explicit open event; `onConnected` fires on the first received message; `end` / `error` close the bridge; `close()` calls `grpcStream.end()` [FB L255-362]. The persistent streams open `'Listen'` and `'Write'` [FB `persistent_stream.ts` L656, L801], send `addTarget`/`removeTarget` on Listen [L684, L701], and on Write do a handshake then carry the server's `streamToken` on every `writes` request [L727-737, L852-880]. Streams idle-close after 60 s [L145].

## 5. What Effect offers today

### `effect@4.1.0` (in this repo)

- `effect/http`: `HttpClient`, `HttpClientRequest`, `HttpClientResponse`, `HttpBody` (including `HttpBody.stream`), `FetchHttpClient` [EFFECT `src/http/`]. `HttpClientResponse` has no trailers member — `grep trailers src/http/*.ts` returns nothing [EFFECT].
- `effect/rpc`: protocols are HTTP, socket and worker (`makeProtocolHttp`, `makeProtocolSocket`, `makeProtocolWorker`); serializations are JSON, NDJSON, JSON-RPC and `SchemaBinary` [EFFECT `rpc/RpcClient.ts` L1002-1717, `rpc/RpcSerialization.ts` L141-698]. No gRPC protocol and no protobuf serialization.
- `effect/encoding/SchemaBinary` is Effect's own compact binary format, not protobuf [EFFECT `encoding/SchemaBinary.ts` header].
- The only protobuf code is an **internal**, encode-only wire helper for OTLP export (`observability/internal/protobuf.ts`: varint, fixed32/64, length-delimited fields) [EFFECT]. No decoder, not exported.
- `effect/socket` is TCP/WebSocket-oriented; nothing HTTP/2 [EFFECT `src/socket/`].

### `@effect/platform-node@4.1.0` (not installed here; latest on npm is 4.1.4)

- `NodeHttpClient` has two backends: `node:http`/`node:https` agents (`layerNodeHttp`, HTTP/1.1) and undici (`layerUndici`, `Dispatcher` service built from `new Undici.Agent(options)`, with `layerUndiciOptions` / `layerDispatcherOptions` to pass agent options) [PN `NodeHttpClient.ts` L97-172, L208-245, L539-573, L632-1048]. No `node:http2` client; `node:http2` appears only on the server side (`NodeHttpServer` accepts an `http2` server) [PN `NodeHttpServer.ts` L4-16, `NodeHttpServerRequest.ts`].
- The undici backend streams request bodies (`HttpBody.Stream` → `NodeStream.toReadable`) and response bodies (`NodeStream.fromReadable`) [PN L360-361, L425], calls `dispatcher.request(...)` with `headersTimeout` 1 h and `bodyTimeout` 0 [PN L208-245]. Its `UndiciResponseSource` keeps `statusCode`, `headers`, `body` — **trailers from undici are dropped** [PN L247-252].
- undici 8: `allowH2` defaults to **true** (h2 when ALPN picks it), `h2Options.useH2c` forces cleartext HTTP/2 for `http:` origins [UNDICI `docs/.../Client.md` L112-128, `types/client.d.ts` L89-93, `client.js` L225-240]. Its h2 path opens the stream with `endStream: false` and writes the body while independently listening for `response`, `trailers` and `end` on the Node `ClientHttp2Stream` [UNDICI `client-h2.js` L1235-1249, L1351-1390], and `Dispatcher.ResponseData` exposes `trailers: Record<string,string>` [UNDICI `types/dispatcher.d.ts` L179, L192]. Sending request trailers is not supported (`TODO` in source) [UNDICI `client-h2.js` L1340]; gRPC clients do not send trailers.

### What is missing for gRPC

1. **Response trailers through `HttpClient`.** `grpc-status` lives in trailers [SPEC], and neither `HttpClientResponse` [EFFECT] nor the platform-node undici adapter [PN] surfaces them. Reading status needs either an `HttpClient` extension or bypassing it (raw undici `dispatch`/`request`, or `node:http2` directly).
2. **Verified full duplex over `HttpClient`.** Listen/Write need to keep writing requests after response messages start. undici's h2 code path is structured for it [UNDICI], but `HttpClient.execute` resolves on response headers and nothing in Effect's tests or docs claims bidi streaming works through it. Not verified here.
3. **gRPC message framing** (5-byte prefix encode, reassembling decoder across DATA chunks) — absent from Effect.
4. **Protobuf codec** for `google.firestore.v1` messages — absent from Effect (internal OTLP encoder only). Options outside Effect: protobufjs (3.1 MB) or generated code.
5. **Status mapping**: `grpc-status` / `grpc-message` (percent-decoding) / Trailers-Only / non-200 synthesis / `RST_STREAM` → error [SPEC].
6. **Channel concerns grpc-js handles today**: connection reuse per session, reconnect backoff, keepalive pings (off unless `grpc.keepalive_time_ms` is set) [GRPCJS `transport.js` L85-92], flow-control window tuning (both SDKs set 256 KiB [GCF; FB]), max message size.
7. **Service-account auth**: JWT assembly and ADC lookup that `google-auth-library` provides [GAL]. The signing primitive exists: `effect/crypto/Signature` supports RSASSA-PKCS1-v1_5 with SHA-256 (JOSE RS256) over PKCS#8 keys [EFFECT `crypto/Signature.ts` L1-22, L245]; JWT encoding, key-file parsing and the metadata-server path do not.
8. **No `@effect/platform-node` dependency in this repo yet.**

## 6. Dependency weight

Unpacked sizes on disk in this repo's pnpm store:

| Package                             | Size                             | Pulled in by                                                                                                                                                          |
| ----------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@grpc/grpc-js@1.14.6`              | 4.3 MB                           | gax; deps `@grpc/proto-loader`, `@js-sdsl/ordered-map`                                                                                                                |
| `@grpc/proto-loader@0.8.1`          | 140 KB                           | grpc-js, gax                                                                                                                                                          |
| `protobufjs@7.6.6`                  | 3.1 MB                           | proto-loader, gax, `@google-cloud/firestore`                                                                                                                          |
| `google-gax@6.3.0`                  | 3.7 MB                           | `@google-cloud/firestore`; deps also `google-auth-library`, `duplexify`, `node-fetch`, `object-hash`, `proto3-json-serializer`, `retry-request`, `@opentelemetry/api` |
| `google-auth-library@11.3.0`        | 800 KB                           | gax; deps `gaxios`, `gcp-metadata`, `jws`, `ecdsa-sig-formatter`, `base64-js`, `google-logging-utils`                                                                 |
| `@google-cloud/firestore-api@0.2.0` | 4.1 MB                           | `@google-cloud/firestore` (GAPIC client + protos)                                                                                                                     |
| `@google-cloud/firestore@9.1.0`     | 4.9 MB                           | `firebase-admin`                                                                                                                                                      |
| `@firebase/firestore@4.18.0`        | 66 MB (all builds, maps, protos) | `firebase`; pins `@grpc/grpc-js ~1.9.0` (3.6 MB) and `@grpc/proto-loader ^0.7.8`                                                                                      |
| `undici@8.x`                        | —                                | `@effect/platform-node`                                                                                                                                               |

Package manifests: [GCF `package.json`], [GAX `package.json`], [GAL `package.json`], [GRPCJS `package.json`], [FB `package.json`].

`@grpc/grpc-js` has only two runtime dependencies and uses Node's built-in `node:http2` [GRPCJS]; most of the weight on the admin path is gax, the GAPIC client and the auth library around it.

## Implications for the native engine

- A Node gRPC transport has to produce: HTTP/2 `POST /google.firestore.v1.Firestore/<Method>` with `te: trailers` and `content-type: application/grpc`, 5-byte-prefixed protobuf messages, and read status from trailers [SPEC; GRPCJS].
- Both SDKs send `google-cloud-resource-prefix` and an `x-goog-api-client`. They disagree on `x-goog-request-params`: the GAPIC client sends per-method `key=urlencoded-value` and nothing on Listen/Write; the Firebase client sends the raw database path on every call including streams [GCF-API; FB]. Both are accepted by production today.
- The admin SDK never uses the Write stream; it writes through unary Commit/BatchWrite and only streams Listen [GCF]. The client SDK uses both Listen and Write bidi streams with a `streamToken` handshake [FB].
- Emulator access is plaintext HTTP/2 to `FIRESTORE_EMULATOR_HOST` with `Authorization: Bearer owner` for admin rights [GCF]. A transport has to support h2c (grpc-js `createInsecure`, undici `h2Options.useH2c`).
- Service-account auth in the official path is a locally signed JWT per call (no token endpoint round-trip), supplied through `google-auth-library` [GAL; GCF-API]. ADC on GCP needs the metadata server.
- Effect 4.1 has no HTTP/2 client abstraction with trailers, no gRPC framing, and no public protobuf codec. `@effect/platform-node`'s undici backend speaks HTTP/2 by default but drops trailers. A gRPC transport built on Effect needs either changes to `HttpClient` (trailers, confirmed duplex), a direct `node:http2` or undici layer, or wrapping `@grpc/grpc-js` in Effect.
- Wrapping `@grpc/grpc-js` + `@grpc/proto-loader` + protobufjs costs about 7.5 MB unpacked and two dependencies beyond protobuf; going through `@google-cloud/firestore-api` + gax adds about 9 MB more plus the auth library tree.
- Both SDKs isolate the gRPC code in a Node-only platform module (`platform/node/*` in Firebase, the whole package for `@google-cloud/firestore`) so browser bundles never import `@grpc/grpc-js` [FB; GCF].

## Not settled

- Whether `HttpClient` over the undici backend carries a long-lived bidi stream correctly end to end (request body still writable after the response starts). Needs a prototype against the emulator.
- Whether production Firestore requires `x-goog-request-params` on Listen/Write for non-default databases; the two SDKs differ and no Google doc states a requirement.
- Whether `effect/crypto/Signature` imports a service-account `private_key` PEM directly (it takes PKCS#8 DER; PEM unwrapping was not checked).
