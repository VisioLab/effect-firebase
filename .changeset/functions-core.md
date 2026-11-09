---
"@visiolab/effect-firebase": minor
---

Add the `functions` entry, which declares server Functions in code shared by server and client, with no Firebase SDK import. A Function is a `FirebaseFunction` of a kind: a Callable or a Document Trigger.

- `Callable.make` declares a Callable once, as its name, its Payload and its success value. `Callable.toLayer` implements it as a Layer, and `Callable.handler` runs a handler behind its middleware chain in process.
- A Callable declares the errors it can fail with in `error`. `Callable.errorCode` and the `callableErrorCode` annotation give an error its Firebase error code, and `CallableError` adds built-in errors such as `NotFound` and `PermissionDenied`.
- `CallableMiddleware`, `CallableRequest` and `Caller`: `.middleware(M)` attaches Callable Middleware to a Callable. It runs before the Payload is decoded; its `provides` leave the handler's Layer and its errors join the Callable's. The built-in `Caller.Authenticated` provides the `Caller` and fails a signed-out call with `Unauthenticated`. `CallableRequest.rawRequest` is the HTTP request a call came in, as Effect's `HttpServerRequest`, for middleware that reads headers or the caller's `remoteAddress`.
- `FunctionGroup.make("users").add(...)` collects Functions of any kind, Callables and Document Triggers together, that deploy as `users-<name>`. `Callable.toLayer(Users, "create", handler)` and `DocumentTrigger.toLayer(Users, "onCreated", handler)` implement a member. `FunctionGroup.Members`, `Names` and `Member` take an optional kind, such as `FunctionGroup.Members<typeof Users, Callable.Any>`, to keep only the members of that kind. A group carries no middleware: attach it to each Callable that needs it.
- `Callable.deployment` gives a Callable's deployed name and span attributes, which the functions and client packages share. `DocumentTrigger.deployment` gives a trigger's deployed name and document path pattern.

Document Triggers run when a document of a collection changes:

- `DocumentTrigger.created`, `deleted`, `updated` and `written(name, collection)` declare a trigger from a name and a `Collection` definition. Each event carries the document's typed Document Reference (`ref`, whose `ancestors` and `id` hold the path's ids) and the CloudEvent's `id` and `time`. A `created` or `deleted` event hands over the document as an existing Document Snapshot (`snapshot`), as it was just before it was deleted for `deleted`. An `updated` event hands over `before` and `after`, both existing. A `written` event runs on a create, an update and a delete: `before` is `Missing` on a create and `after` is `Missing` on a delete, narrowed with `DocumentSnapshot.isExisting` or `DocumentSnapshot.isMissing`. Snapshot data decodes through the collection's model when it is read.
- `DocumentTrigger.toLayer(trigger, handler | Effect<handler>)` implements a trigger, and `DocumentTrigger.serve` runs an event through its handler in process. Build test events with `DocumentTrigger.createdEvent`, `deletedEvent`, `updatedEvent` or `writtenEvent` and `DocumentSnapshot.existing`.

Firebase delivers each event at least once, so make handlers idempotent, keyed on the event's `id`.
