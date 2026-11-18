# Generating Firestore protocol schemas

Research for [Generating Firestore protocol schemas](https://github.com/VisioLab/effect-firebase/issues/263) (map [Effect-native Firestore engine](https://github.com/VisioLab/effect-firebase/issues/259)). This note records facts. It makes no design decisions.

## Answer in short

- **`tools/firestore-codegen` (branch `prototype-rest-api`)** is a buf/protoc plugin on `@bufbuild/protoplugin` that emits one TypeScript file per service: Effect `Schema` codecs for the **proto3 JSON** form of every message the REST surface reaches, plus an `effect/http-api` `HttpApi` built from the `google.api.http` annotations. It produces nothing for binary protobuf, and it skips the two bidi-streaming RPCs, `Listen` and `Write`. It is a throwaway prototype that covers only what Firestore v1 needs. [P1, P3]
- **`protoc-gen-effect` (Effect-TS/effect#10717, open)** emits one module per `.proto` file: a resolved `FileDescriptor`, a TypeScript interface plus a `MessageDescriptor` per message, enums as number objects, and service descriptors. Values go through `effect/protobuf`'s `ProtobufMessage.encode/decode`, which is **binary only** and not `Schema`-based. Generated `Schema` codecs per message are explicitly left for later, and ProtoJSON is "deferred pending a concrete interoperability requirement". `effect/protobuf` is `@since 4.1.5` and unreleased (npm `latest` is 4.1.4). [E1, E2, E3, E4]
- **One source for both formats:** neither generator does it today. The `.proto` files (via descriptors) are one source for both, and `protobuf-es` shows the pattern: one generated schema with `toBinary`/`fromBinary` and `toJson`/`fromJson`. Effect's descriptors keep the raw `FieldDescriptorProto` (with `json_name`), so a JSON codec could be derived from them, but none exists. [B1, E5]
- **WebChannel JSON vs REST JSON:** both are proto3 JSON. The browser SDK uses `useProto3Json = true` on the browser, browser-lite, React Native and Node-lite builds, and `false` only on full Node, which talks gRPC through protobuf.js objects. Within proto3 JSON the SDK's outputs differ from the generated prototype schemas in a few places (`doubleValue: "-0"`, lenient parsing). [F1–F5]

## Sources

| Id   | Source                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P1] | `tools/firestore-codegen/src/protoc-gen-effect-http-api.ts` on branch `prototype-rest-api` (commit `9b513ad`)                                                                                                                                                                                                                                                                                                                                  |
| [P2] | `tools/firestore-codegen/buf.gen.yaml` and `package.json`, same branch                                                                                                                                                                                                                                                                                                                                                                         |
| [P3] | `packages/admin/tests/rest-prototype/generated/FirestoreRestApi.ts`, same branch (5,020 lines)                                                                                                                                                                                                                                                                                                                                                 |
| [P4] | `packages/admin/tests/rest-prototype/FirestoreCodec.ts` and `FirestoreCodec.test.ts`, `FirestoreRestGenerated.test.ts`, same branch                                                                                                                                                                                                                                                                                                            |
| [W1] | `packages/client/prototypes/WebChannelFrames.ts` and `webchannel-direct.demo.ts` on branch `prototype-webchannel-spike`                                                                                                                                                                                                                                                                                                                        |
| [E1] | [Effect-TS/effect#10717](https://github.com/Effect-TS/effect/pull/10717) "Add @effect/protobuf-generator, a self-hosted protoc plugin for effect/protobuf", open, head `45e47e7`; its `packages/tools/protobuf-generator/README.md` and `test/generated/acme/shop/v1/order.proto.ts`                                                                                                                                                           |
| [E2] | `packages/effect/src/protobuf/ProtobufMessage.ts` on Effect `main` (module docs, lines 1–68)                                                                                                                                                                                                                                                                                                                                                   |
| [E3] | [Effect-TS/effect#9454](https://github.com/Effect-TS/effect/pull/9454) "Add ProtobufDescriptor and ProtobufMessage: protobuf messages by descriptor, without Schema", merged 2026-11-17                                                                                                                                                                                                                                                        |
| [E4] | npm registry `effect` dist-tags (`latest: 4.1.4`); `packages/effect/src/protobuf/index.ts` on `main` (`@stability experimental`, `@since 4.1.5`); this repo's catalog pins `effect: 4.1.0` (`pnpm-workspace.yaml`)                                                                                                                                                                                                                             |
| [E5] | `packages/effect/src/protobuf/ProtobufDescriptor.ts` on `main`, `interface FieldBase` (line 198)                                                                                                                                                                                                                                                                                                                                               |
| [E6] | Earlier Effect protobuf PRs: [#9450](https://github.com/Effect-TS/effect/pull/9450) (closed prototype: binary + JSON codecs, Connect RPC), [#9545](https://github.com/Effect-TS/effect/pull/9545) (closed: `Protobuf.toCodecJson`), [#9950](https://github.com/Effect-TS/effect/pull/9950) (merged into feature branch `feat/effect-protobuf`, not `main`), [#10718](https://github.com/Effect-TS/effect/pull/10718) (open, stacked on #10717) |
| [B1] | protobuf-es docs: `docs/src/content/docs/guides/serialization.md`, `reference/json-types.md`, `reference/generated-code/index.md`, `reference/generated-code/field-types.md` in [bufbuild/protobuf-es](https://github.com/bufbuild/protobuf-es); `@bufbuild/protobuf` 2.17.0 on npm                                                                                                                                                            |
| [J1] | [ProtoJSON format](https://protobuf.dev/programming-guides/json/) (`content/programming-guides/json.md` in protocolbuffers.github.io)                                                                                                                                                                                                                                                                                                          |
| [G1] | [googleapis `google/firestore/v1/firestore.proto`](https://github.com/googleapis/googleapis/blob/14a161a98ef045be80c12ab69d924504a756f109/google/firestore/v1/firestore.proto) at the commit the prototype pins                                                                                                                                                                                                                                |
| [F1] | firebase-js-sdk `packages/firestore/src/remote/serializer.ts` (`main`): `JsonProtoSerializer`, lines 157–300                                                                                                                                                                                                                                                                                                                                   |
| [F2] | firebase-js-sdk `packages/firestore/src/platform/{browser,browser_lite,rn,node,node_lite}/serializer.ts`                                                                                                                                                                                                                                                                                                                                       |
| [F3] | firebase-js-sdk `packages/firestore/src/remote/number_serializer.ts`, lines 30–40                                                                                                                                                                                                                                                                                                                                                              |
| [F4] | firebase-js-sdk `packages/firestore/src/model/normalize.ts`, `normalizeTimestamp`, `normalizeNumber`, `normalizeByteString`                                                                                                                                                                                                                                                                                                                    |
| [F5] | firebase-js-sdk `packages/firestore/src/platform/node/load_protos.ts`, `protoLoaderOptions`                                                                                                                                                                                                                                                                                                                                                    |

## The prototype: `tools/firestore-codegen`

### How it runs

- `buf generate` reads `google/firestore/v1` straight from the googleapis Git repository, pinned to commit `14a161a`, because the BSR `googleapis` module carries only the shared protos. The plugin is a local Node script; output goes into `packages/admin/tests/rest-prototype/generated` and is then formatted with `vp fmt`. [P2]
- Dependencies: `@bufbuild/buf`, `@bufbuild/protobuf`, `@bufbuild/protoplugin` (dev only). The generated file imports only `effect` and `effect/http-api`. [P2, P3]

### What it produces

One file per service, `FirestoreRestApi.ts` [P1 `generateTs`, P3]:

- **Enums** as a string-literal type plus `Schema.Literals([...names])`. [P1 `printEnum`]
- **Messages** as a `type` plus `Schema.Codec<T>`, for every message reachable from the REST endpoints' inputs and outputs. Keys are `jsonName` (lowerCamelCase). [P1 `fieldProp`, `reachable`]
- **Scalars** in proto3 JSON form: 64-bit integers and bytes as `Schema.String`, `double`/`float` as `Finite | "NaN" | "Infinity" | "-Infinity"`, other ints as `Schema.Int`. [P1 `scalar`]
- **Well-known types** mapped to their JSON forms: `Timestamp`, `Duration`, `FieldMask` as strings; wrappers unwrapped; `Struct`/`Any` as records; `Value` as `Unknown`; `NullValue` as `Schema.Null`. [P1 `wellKnown`, `enumExpr`]
- **Optionality** from `google.api.field_behavior = REQUIRED`: every other field is `optionalKey`, because proto3 JSON leaves defaults out. [P1 `fieldProp`]
- **Oneofs** as a union of struct shapes, one per member, with the other members typed `never`. A hard-coded set of nine oneofs (`Value.value_type`, `Write.operation`, …) is treated as always set; the rest also get an "all absent" shape. Shapes multiply across oneofs in a message (cartesian product). The generated `Value` has 15 shapes of 15 keys each. [P1 `requiredOneofs`, `shapesOf`; P3 lines 223–589]
- **Recursion** through `Schema.suspend`. [P1 `messageExpr`]
- **`HttpApi`**: one `HttpApiEndpoint` per `google.api.http` binding (path templates turned into `:param` with regex checks; `body: "*"` gives a `…Body` schema without path-bound fields; GET requests get query params, with nested messages flattened as `field.subfield`), server-streaming responses as `Schema.Array(...)`, and one `GoogleApiError` class registered for twelve HTTP statuses. 16 endpoints in total (`getDocument` … `createDocument`). [P1 `printService`, `endpointsOf`, `queryOf`; P3 lines 4745–5005]

### Status and limits

- Labelled a prototype: "enough of the proto3 JSON mapping and of HTTP transcoding for the Firestore v1 API, not for any proto there is". [P1 header]
- Only unary and server-streaming methods become endpoints ("A REST client cannot stream requests"), so `Listen` and `Write` (bidi streaming, [G1] lines 206–219) and their messages (`ListenRequest`, `ListenResponse`, `TargetChange`, `WriteRequest`) are not generated. [P1 `printService`; P3, no matches]
- No binary codec. Schemas describe proto3 JSON only. [P1]
- Encoded side is stricter than the ProtoJSON parser rules: only lowerCamelCase keys, int64 only as string, enums only as names, doubles only as numbers or the three special strings, no `null` for absent fields. [P1 vs J1 "Field names as JSON keys", "Null values", and the scalar table]
- Tested against the emulator: REST get/query through the generated `HttpApi` [P4 `FirestoreRestGenerated.test.ts`], and a hand-written `toCodecFirestore` (model ↔ `Value` / `Write` JSON) that round-trips with the Admin SDK [P4 `FirestoreCodec.test.ts`]. `FirestoreCodec.ts` imports only the generated _types_ `Value` and `DocumentTransform_FieldTransform`; its `Value` codec is hand-written, not the generated one. [P4 line 18, `StoredValue`]

## Effect's `protoc-gen-effect` (#10717)

### What exists on Effect `main`

- `effect/protobuf` with `ProtobufDescriptor`, `ProtobufDescriptorProto`, `ProtobufMessage`, `ProtobufReader`, `ProtobufWriter`, all `@stability experimental`, `@since 4.1.5`. [E4]
- `ProtobufMessage` converts plain values to and from **binary** protobuf from a descriptor. Value shape: keyed by original proto field name (snake_case); implicit-presence fields always present (zero value); oneofs as `{ _tag, value }`; 64-bit ints as `bigint` (unless `jstype`); enums as numbers; bytes as `Uint8Array`; unknown fields kept under a symbol. Errors come back as `Result` with a field path. [E2]
- #9454 states: "A general `.proto` generator, Schema integration, and RPC adapters are outside this PR. ProtoJSON is deferred pending a concrete interoperability requirement." [E3]
- Resolved field descriptors keep their `FieldDescriptorProto` (`proto`), which carries `json_name`, but expose no JSON name or JSON codec of their own. [E5; generated descriptors include `json_name`, E1 `order.proto.ts`]

### What #10717 adds (open, created 2026-11-18)

- `@effect/protobuf-generator` with bin `protoc-gen-effect`, run through `protoc --effect_out` or `buf generate`. Self-hosted: it decodes its own `CodeGeneratorRequest` with Effect's generated `plugin.proto` module; `@bufbuild/protoplugin` was used only for the stage-0 bootstrap. No third-party protobuf runtime. [E1 body, README]
- Output per `.proto` file (`acme/v1/user.proto` → `acme/v1/user.proto.ts`) [E1 README, `order.proto.ts`]:
  - the resolved `FileDescriptor`, linked against the modules of its imports;
  - per message, an `interface` with all fields `readonly …?`, snake_case keys, oneofs as `_tag` unions, `bigint`, `Uint8Array`, enum fields as `number`, plus a `MessageDescriptor` constant of the same name;
  - per enum, a `const` object of numbers and its value type;
  - descriptors for extensions and services (no client or server stubs).
- Use: `ProtobufMessage.encode(User.User)(value)` / `decode(...)`; the README's example casts the decoded value (`as User.User`). "Generated codecs per message type, and typed descriptors (`decode` returning `Order` without a cast), are left for a separate effort." [E1]
- Only option: `import_extension=js|ts|none`. [E1 README]
- Stacked #10718 speeds up the descriptor-derived binary codec (1.07–1.68× protobuf-es decode, 1.13–1.61× encode in its benchmark) and defers generated per-message codecs. [E6]
- History: a closed prototype (#9450) had binary + JSON codecs and Connect RPC; a closed PR (#9545) proposed `Protobuf.toCodecJson`; #9950 (an earlier `protoc-gen-effect` with `timestamp=parts` options) merged into a feature branch, not `main`. [E6]

### What it does not give

- No proto3 JSON codec, no `Schema` codecs, no `HttpApi`/HTTP transcoding, no gRPC transport. [E1, E2, E3]
- Not released; depends on `effect` > 4.1.4, while this repo pins `effect` 4.1.0. [E4]

## Can one source yield proto3 JSON and binary codecs?

- **The `.proto` descriptors carry everything both need.** ProtoJSON is defined as a mapping of the same messages: lowerCamelCase or `json_name` keys, int64 as strings, bytes as base64, enums as names, well-known types as special forms, default-valued implicit fields omitted. [J1]
- **protobuf-es does it from one generated schema:** "Protobuf-ES uses the same generated schema for wire-compatible binary and ProtoJSON". `toBinary`/`fromBinary` and `toJson`/`fromJson` take the same `XSchema`; JSON options include `alwaysEmitImplicit`, `enumAsInteger`, `useProtoFieldName`, `ignoreUnknownFields`. Optional `json_types=true` generates a `XJson` type matching `toJson` output. Message types use camelCase properties, `bigint` for 64-bit ints, and a `$typeName`. [B1]
- **The prototype** only reads descriptors at generation time, and only emits JSON schemas. Binary would need either a second emitter or a runtime descriptor; it emits neither. [P1]
- **Effect's generator** emits the runtime descriptor (which has `json_name` via `proto`) and binary codecs come from it. A ProtoJSON codec from the same descriptor would be new code; none exists or is planned in a linked PR. [E1, E3, E5]
- **The decoded shapes differ between the two Effect-side codecs.** Prototype JSON schemas: camelCase keys, int64 `string`, enum name strings, bytes base64 `string`, `Timestamp` RFC 3339 `string`, oneofs as flat keys. `ProtobufMessage`: snake_case keys, `bigint`, enum numbers, `Uint8Array`, `Timestamp` as `{ seconds, nanos }` message, oneofs as `{ _tag, value }`. A shared domain value would need a transform from each. [P1, P3, E2, J1]

## WebChannel JSON vs REST JSON

- `JsonProtoSerializer(databaseId, useProto3Json)` "supports both Protobuf.js and Proto3 JSON formats". [F1 lines 157–174]
- Platform choice [F2]:
  - `browser`: `useProto3Json = true` (WebChannel for streams, and REST-style JSON).
  - `browser_lite`, `node_lite`, `rn`: re-export the browser serializer, so `true`.
  - `node` (full SDK, gRPC): `false`.
- What `useProto3Json` switches [F1, F3]:

  | Item                                                                    | `true` (proto3 JSON: WebChannel, REST)    | `false` (Node gRPC, protobuf.js objects) |
  | ----------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
  | `google.protobuf.Int32Value` (`StructuredQuery.limit`, `expectedCount`) | bare number                               | `{ value: n }`                           |
  | `Timestamp`                                                             | RFC 3339 string, always 9 fraction digits | `{ seconds: "<string>", nanos }`         |
  | `bytes` (`resumeToken`, `bytesValue`)                                   | base64 string                             | `Uint8Array`                             |
  | `doubleValue` NaN / ±Infinity                                           | `"NaN"`, `"Infinity"`, `"-Infinity"`      | the number                               |

- On Node, protobuf.js is loaded with `longs: String, enums: String, defaults: true, oneofs: false`, so even the gRPC path hands the serializer string int64s and enum names. [F5]
- Same in both modes: `integerValue` is always sent as a decimal string, and negative zero as `doubleValue: "-0"` (a string). ProtoJSON accepts numeric strings for floats [J1 scalar table]; the prototype's double schema (`Finite | "NaN" | "Infinity" | "-Infinity"`) does not accept `"-0"`, and a plain JSON number cannot carry `-0` (`JSON.stringify(-0) === "0"`). [F3 lines 30–40, P1 `double`]
- Reading is lenient in the SDK: `normalizeTimestamp` accepts a string or `{seconds, nanos}`, `normalizeNumber` a number or string, `normalizeByteString` base64 or `Uint8Array`. A missing `targetChangeType` is read as `NO_CHANGE` because "proto3 default value is unset in JSON". [F4; F1 lines 564–567]
- So WebChannel and REST share one JSON form (proto3 JSON); the differences the SDK handles are between proto3 JSON and the Node gRPC object form, not between WebChannel and REST. WebChannel adds its own framing around the JSON (`<length>\n<json>` back-channel frames, `reqN___data__` form fields on send), which the spike handles separately from the message schemas. [W1]
- The WebChannel spike hand-writes partial `ListenRequest` / `ListenResponse` schemas in proto3 JSON form (`resumeToken` and `readTime` as strings, `targetChangeType` as optional literals). [W1 `webchannel-direct.demo.ts` lines 212–250]

## Gaps

- **Listen and Write messages:** no generator here emits schemas for them. The prototype skips bidi RPCs; Effect's generator would emit descriptors and interfaces, but binary only. [P1, E1]
- **ProtoJSON in Effect:** deferred upstream, no open PR. [E3, E6]
- **Lenient parsing:** the prototype's schemas reject inputs the ProtoJSON spec says parsers accept (proto names as keys, numeric int64, enum numbers, `null`, `"-0"`). Whether the Firestore server ever sends these was not checked. [P1, J1]
- **Optionality:** the prototype relies on `field_behavior = REQUIRED` plus a hand-kept list of always-set oneofs; protos cannot express the latter. [P1 `requiredOneofs`]
- **Output size:** oneof shapes multiply per message; `Value` alone is 15 × 15 keys and the REST surface generates 5,020 lines. [P3]
- **Release and version:** `effect/protobuf` needs an `effect` release after 4.1.4; this repo is on 4.1.0. [E4]
- **Not settled here:** whether the Firestore server's proto3 JSON output (REST or WebChannel) contains any of the lenient forms above, and how `Listen` is exposed over plain REST (the proto declares `post …/documents:listen`, [G1] line 217) versus WebChannel.

## Implications for the native engine

- A WebChannel transport and a REST transport can share one set of proto3 JSON schemas: the browser SDK sends the same JSON form over both. [F1, F2]
- A gRPC transport needs binary codecs. Of the two generators, only Effect's produces anything usable for binary today, and it is unreleased and not `Schema`-based. [E1–E4]
- No existing generator yields both proto3 JSON and binary Effect codecs from one source. protobuf-es does this outside Effect; Effect's descriptors hold the data a JSON codec would need, but the code does not exist. [B1, E5]
- The two formats decode to different value shapes (keys, int64, enums, bytes, timestamps, oneofs), so an engine fed by both sees two protocol-level representations unless something maps them to one. [P1, E2, J1]
- The prototype's generator already gives a typed REST `HttpApi` and covers everything except `Listen` and `Write`, which are exactly the messages WebChannel and gRPC streaming carry. [P1, G1]
- `FirestoreCodec.ts`'s model ↔ `Value` mapping is hand-written over proto3 JSON and independent of which generator produces the message types. [P4]
