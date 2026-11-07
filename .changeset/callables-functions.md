---
"@visiolab/effect-firebase-functions": minor
---

Add `CallableFunction.make`, which serves a Callable as a Callable Function and builds its Layer on the first call.

Add `CallableFunction.group`, which serves each member of a Callable Group as its own `onCall` export, deployed as `<group>-<name>`, with `CallableOptions` per member.

A declared failure is sent as an `HttpsError` with the encoded error in `details`. A defect is a bare `internal`, a Payload that does not decode is `invalid-argument`, and a Layer that fails to build is built again on the next call.

Each call runs the Callable's middleware chain, whose implementations `Live` must provide. Add `FunctionsCallableRequest`, Firebase's request as a service that extends the portable `CallableRequest`. Every call provides it, so `Live` needn't, even when a handler or middleware requires it.

Every call of a Callable Function runs in a `kind: "server"` span named `CallableFunction.<deployed name>`, parented on the trace context Firebase reads from the request. Spans are exported when the Layer provides a `Tracer`.

`CallableFunction.group` runs the group's middleware around each member's own, so `Live` must provide its implementation too.

Add the `CloudLogging` logger and `layer` (`@visiolab/effect-firebase-functions/logger`), which write Effect logs as Cloud Logging entries tied to the trace of the current span. Every Callable Function call logs through it, unless its Layer provides a logger of its own. The trace's project comes from `GCLOUD_PROJECT`, else `GOOGLE_CLOUD_PROJECT`; without either, entries carry no trace fields.
