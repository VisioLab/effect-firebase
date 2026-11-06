---
"@visiolab/effect-firebase": minor
---

Add the `functions` entry with `Callable` and `CallableError`. `Callable.make` declares a Callable once, as its name, its Payload and its success value, in code shared by server and client. `Callable.toLayer` implements it as a Layer.

Add `CallableGroup`. `CallableGroup.make("users").add(CreateUser)` collects Callables that deploy as `users-<name>`, and `Callable.toLayer(Users, "create", handler)` implements a member in that group.

A Callable declares the errors it can fail with in `error`. `Callable.errorCode` and the `callableErrorCode` annotation give an error its Firebase error code, and `CallableError` adds built-in errors such as `NotFound` and `PermissionDenied`.

Add `CallableMiddleware`, `CallableRequest` and `Caller`. `.middleware(M)` attaches Callable Middleware, which runs before the Payload is decoded; its `provides` leave the handler's Layer and its errors join the Callable's. The built-in `Caller.Authenticated` provides the `Caller` and fails a signed-out call with `Unauthenticated`. `Callable.handler` runs a handler behind its middleware chain in process.
