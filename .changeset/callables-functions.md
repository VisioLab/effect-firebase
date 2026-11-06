---
"@visiolab/effect-firebase-functions": minor
---

Add `CallableFunction.make`, which serves a Callable as a real `onCall` export and builds its Layer on the first call.

Add `CallableFunction.group`, which serves each member of a Callable Group as its own `onCall` export, deployed as `<group>-<name>`, with `CallableOptions` per member.

A declared failure is sent as an `HttpsError` with the encoded error in `details`. A defect is a bare `internal`, a Payload that does not decode is `invalid-argument`, and a Layer that fails to build is built again on the next call.

Each call runs the Callable's middleware chain, whose implementations `Live` must provide. Add `FunctionsCallableRequest`, Firebase's request as a service that extends the portable `CallableRequest`.
