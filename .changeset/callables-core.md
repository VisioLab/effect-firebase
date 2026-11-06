---
"@visiolab/effect-firebase": minor
---

Add the `functions` entry with `Callable` and `CallableError`. `Callable.make` declares a Callable once, as its name, its Payload and its success value, in code shared by server and client. `Callable.toLayer` implements it as a Layer.

A Callable declares the errors it can fail with in `error`. `Callable.errorCode` and the `callableErrorCode` annotation give an error its Firebase error code, and `CallableError` adds built-in errors such as `NotFound` and `PermissionDenied`.
