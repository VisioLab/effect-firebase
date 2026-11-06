---
"@visiolab/effect-firebase-client": minor
---

Add the `functions` entry with `ClientFunctions` and `CallableClient`. `CallableClient.make(Greet)` calls a Callable through `httpsCallable`, with its Payload and success value typed and sent through `Schema.toCodecJson`.

`CallableClient.make(Users)` builds the client of a Callable Group: one function per member, each calling `<group>-<name>`.

A declared error comes back as its own class, so `Effect.catchTag` recovers from it. Every other failure is a `CallableError` with a `TransportError`, `ResponseError`, `DecodeError` or `EncodeError` reason.
