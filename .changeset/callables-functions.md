---
"@visiolab/effect-firebase-functions": minor
---

Add `CallableFunction.make`, which serves a Callable as a real `onCall` export and builds its Layer on the first call.

A declared failure is sent as an `HttpsError` with the encoded error in `details`. A defect is a bare `internal`, a Payload that does not decode is `invalid-argument`, and a Layer that fails to build is built again on the next call.
