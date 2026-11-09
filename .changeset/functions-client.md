---
"@visiolab/effect-firebase-client": minor
---

Add the `functions` entry with `ClientFunctions` and `CallableClient`. `CallableClient.make(Greet)` calls a Callable through `httpsCallable`, with its Payload and success value typed and sent through `Schema.toCodecJson`.

`CallableClient.make(Users)` builds the client of a Function Group: one function per Callable member, each calling `<group>-<name>`. Members of other kinds, such as Document Triggers, get none.

A declared error comes back as its own class, so `Effect.catchTag` recovers from it, and so do the errors of a Callable's middleware, such as `Unauthenticated` from `Caller.Authenticated`. Every other failure is a `CallableError` with a `TransportError`, `ResponseError`, `DecodeError` or `EncodeError` reason. A `TransportError` means no answer arrived: a network failure, the SDK's own timeout, or a cancelled call. A `deadline-exceeded` the server sends is a `ResponseError`.

Every `CallableClient` call runs in a `kind: "client"` span named `CallableClient.<deployed name>`.
