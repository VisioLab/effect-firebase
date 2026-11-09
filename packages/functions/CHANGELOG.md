# @visiolab/effect-firebase-functions

## 0.3.1

### Patch Changes

- [#195](https://github.com/VisioLab/effect-firebase/pull/195) [`eeed4ff`](https://github.com/VisioLab/effect-firebase/commit/eeed4ff505188865bdcc946f5b83f6a7bc93277a) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - The npm pages link to the docs at https://visiolab.github.io/effect-firebase/, and the install command for `@visiolab/effect-firebase-functions` now adds its `@visiolab/effect-firebase-admin` and `firebase-admin` peers.
- Updated dependencies [[`eeed4ff`](https://github.com/VisioLab/effect-firebase/commit/eeed4ff505188865bdcc946f5b83f6a7bc93277a)]:
  - @visiolab/effect-firebase@0.3.1
  - @visiolab/effect-firebase-admin@0.3.1

## 0.3.0

### Minor Changes

- [#193](https://github.com/VisioLab/effect-firebase/pull/193) [`9c7e0d5`](https://github.com/VisioLab/effect-firebase/commit/9c7e0d53ac16feca7195d73dc5979409568a8e46) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Add `@visiolab/effect-firebase-functions`, which deploys the Functions of `@visiolab/effect-firebase/functions` through `firebase-functions`. It takes `@visiolab/effect-firebase`, `@visiolab/effect-firebase-admin`, `effect`, `firebase-admin` and `firebase-functions` as peer dependencies.

  - `Functions.make(fn, live, options?)` deploys a Function in no group, and `Functions.group(group, live, options?)` deploys each member of a Function Group as its own export, deployed as `<group>-<name>`. Each export builds `live` on its first call or event, and builds it again on the next one if it failed. Each member's options are typed by its kind.
  - A Callable deploys as an `onCall` export (`Functions.CallableExport`), with Firebase's `CallableOptions`. A declared failure is sent as an `HttpsError` with the encoded error in `details`. A defect is a bare `internal`, and a Payload that does not decode is `invalid-argument`. Each call runs the Callable's middleware chain, whose implementations `live` must provide, and provides the portable `CallableRequest`, whose `rawRequest` is Firebase's Express request as Effect's `HttpServerRequest`, with the caller's IP address as `remoteAddress`.
  - A Document Trigger deploys with `onDocumentCreated`, `onDocumentDeleted`, `onDocumentUpdated` or `onDocumentWritten` (`Functions.DocumentTriggerExport`) on the `(default)` database, at a path pattern derived from its collection. Its options are the shared `firebase-functions` options plus `retry`; `document`, `database`, `namespace` and the event filter options are not exposed. A failing handler is logged and makes the function throw, so Firebase delivers the event again when `retry` is set.
  - Every call or event runs in a `kind: "server"` span, `CallableFunction.<deployed name>` or `DocumentTrigger.<deployed name>`, parented on the trace context Firebase hands over. Spans are exported when the Layer provides a `Tracer`.
  - The `CloudLogging` logger and `layer` (`@visiolab/effect-firebase-functions/logger`) write Effect logs as Cloud Logging entries tied to the trace of the current span. Every Function logs through it, unless its Layer provides a logger of its own. The trace's project comes from `GCLOUD_PROJECT`, else `GOOGLE_CLOUD_PROJECT`; without either, entries carry no trace fields.

### Patch Changes

- [#185](https://github.com/VisioLab/effect-firebase/pull/185) [`bd7d20a`](https://github.com/VisioLab/effect-firebase/commit/bd7d20a6d49a82004c5dc78d04267a5e13629259) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - All packages now release together under one version, so `@visiolab/effect-firebase-client` and `@visiolab/effect-firebase-functions` skip ahead to 0.3.0. Install every `@visiolab/effect-firebase*` package at the same version: each one works with the core version it shares a number with.

- [#194](https://github.com/VisioLab/effect-firebase/pull/194) [`303319c`](https://github.com/VisioLab/effect-firebase/commit/303319c6aac7b17def21ea650e8141dca9897d79) Thanks [@Kaeldehta](https://github.com/Kaeldehta)! - Packages now publish publicly to npmjs.com instead of GitHub Packages, so installing them needs no token or `.npmrc` mapping. Remove any `@visiolab:registry=https://npm.pkg.github.com` line from your `.npmrc`.
- Updated dependencies [[`ebb0378`](https://github.com/VisioLab/effect-firebase/commit/ebb03785572affe1112bf6a6b1088500b7fefa11), [`eb017af`](https://github.com/VisioLab/effect-firebase/commit/eb017af4cc16c2c05bc0c481f15a22ae9b1fe1ac), [`ebb0378`](https://github.com/VisioLab/effect-firebase/commit/ebb03785572affe1112bf6a6b1088500b7fefa11), [`bd7d20a`](https://github.com/VisioLab/effect-firebase/commit/bd7d20a6d49a82004c5dc78d04267a5e13629259), [`9c7e0d5`](https://github.com/VisioLab/effect-firebase/commit/9c7e0d53ac16feca7195d73dc5979409568a8e46), [`303319c`](https://github.com/VisioLab/effect-firebase/commit/303319c6aac7b17def21ea650e8141dca9897d79), [`ebb0378`](https://github.com/VisioLab/effect-firebase/commit/ebb03785572affe1112bf6a6b1088500b7fefa11)]:
  - @visiolab/effect-firebase-admin@0.3.0
  - @visiolab/effect-firebase@0.3.0
