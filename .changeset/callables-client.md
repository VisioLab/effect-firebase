---
"@visiolab/effect-firebase-client": minor
---

Add the `functions` entry with `ClientFunctions` and `CallableClient`. `CallableClient.make(Greet)` calls a Callable through `httpsCallable`, with its Payload and success value typed and sent through `Schema.toCodecJson`.

`CallableClient.make(Users)` builds the client of a Callable Group: one function per member, each calling `<group>-<name>`.

A declared error comes back as its own class, so `Effect.catchTag` recovers from it. Every other failure is a `CallableError` with a `TransportError`, `ResponseError`, `DecodeError` or `EncodeError` reason. A `TransportError` means no answer arrived: a network failure, the SDK's own timeout, or a cancelled call. A `deadline-exceeded` the server sends is a `ResponseError`.

The errors of a Callable's middleware, such as `Unauthenticated` from `Caller.Authenticated`, come back as their own classes too.

Every `CallableClient` call runs in a `kind: "client"` span named `CallableClient.<deployed name>`.

The errors of a Callable Group's middleware join the errors of every member's client function.
