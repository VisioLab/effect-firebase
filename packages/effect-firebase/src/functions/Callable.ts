/**
 * Callables: server functions the client calls by name, declared once and
 * shared by the server and the client.
 *
 * A {@link Callable} is a contract: its name, its Payload and what it succeeds
 * with. The server implements it with {@link toLayer} and serves it with
 * `CallableFunction` from `@visiolab/effect-firebase-functions`. The client
 * calls it with `CallableClient` from `@visiolab/effect-firebase-client`. This
 * module imports neither SDK, so the contract can live in code shared with the
 * browser.
 *
 * Values cross the wire as `Schema.toCodecJson` output, on both sides, so a
 * `Date` or a `bigint` arrives as itself.
 *
 * @example Declaring a Callable and implementing it
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 *
 * const Greet = Callable.make("greet", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 *
 * const GreetLive = Callable.toLayer(Greet, ({ name }) => Effect.succeed(`Hello, ${name}!`));
 * ```
 *
 * @stability unstable
 * @since 0.3.0
 */
import { type Context, type Effect, type Layer, type Pipeable, Schema } from "effect";
import type * as CallableError from "./CallableError.ts";
import type * as CallableGroup from "./CallableGroup.ts";
import type * as CallableMiddleware from "./CallableMiddleware.ts";
import type * as CallableRequest from "./CallableRequest.ts";
import * as internal from "./internal/callable.ts";
import type * as internalGroup from "./internal/callableGroup.ts";
import { isCallableGroup } from "./internal/callableGroup.ts";
import type * as internalMiddleware from "./internal/callableMiddleware.ts";

const TypeId = internal.TypeId;

/**
 * The group and the Callable that the arguments of an overload taking
 * `(callable, ...)` or `(group, name, ...)` name.
 */
const target = (
  args: ReadonlyArray<unknown>,
): readonly [internalGroup.Fields | undefined, internal.Fields] =>
  isCallableGroup(args[0])
    ? [args[0], args[0].callables[args[1] as string]!]
    : [undefined, args[0] as internal.Fields];

/**
 * A Callable: a server function's name, its Payload and what it succeeds with.
 *
 * **Details**
 *
 * The name is the Callable's identity. A Callable in no group is deployed
 * under its name, so it is a literal type that the server's exports and the
 * client's functions are keyed on.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Callable<
  out Name extends string,
  out Payload extends Schema.Top = Schema.Void,
  out Success extends Schema.Top = Schema.Void,
  out Error extends Schema.Top = never,
  out Middleware = never,
  out MiddlewareServices = never,
>
  extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId;
  /** The Callable's name, which a Callable in no group is deployed under. */
  readonly name: Name;
  /** The schema of what the client sends. */
  readonly payload: Payload;
  /** The schema of what the handler succeeds with. */
  readonly success: Success;
  /** The schemas of the errors the handler can fail with. */
  readonly error: ReadonlySet<Error>;
  /** The Callable's own middleware, in the order it was attached. */
  readonly middlewares: ReadonlySet<CallableMiddleware.AnyKey>;
  /** The middleware attached to the Callable, as a union. Types only. */
  readonly "~Middleware": Middleware;
  /** What the middleware chain still requires. Types only. */
  readonly "~MiddlewareServices": MiddlewareServices;

  /**
   * Attaches a Callable Middleware to the Callable.
   *
   * **Details**
   *
   * Returns a new Callable. The middleware runs around every call, before
   * the Payload is decoded. A middleware attached later wraps the ones
   * attached before it, so it can provide what they require. A Callable
   * Group carries no middleware, so a member of a group runs only its own.
   *
   * Its `provides` are removed from what the handler's Layer requires, and
   * its errors join the Callable's error union. Its implementation is
   * required where the chain runs: by `CallableFunction` and by
   * {@link handler}.
   *
   * The Payload is decoded inside the chain, so a middleware that catches
   * every failure also catches a Payload that doesn't decode, and the caller
   * then no longer gets `invalid-argument`.
   *
   * @see {@link CallableMiddleware.Service} for declaring a middleware
   */
  middleware<I extends CallableMiddleware.AnyId, S>(
    middleware: Context.Key<I, S>,
  ): Callable<
    Name,
    Payload,
    Success,
    Error,
    Middleware | I,
    CallableMiddleware.ApplyServices<I, MiddlewareServices>
  >;
}

/**
 * Any {@link Callable}, whatever its name, schemas and middleware.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Any {
  readonly [TypeId]: typeof TypeId;
  readonly name: string;
  readonly payload: Schema.Top;
  readonly success: Schema.Top;
  readonly error: ReadonlySet<Schema.Top>;
  readonly middlewares: ReadonlySet<CallableMiddleware.AnyKey>;
}

/**
 * The middleware attached to a {@link Callable}, as a union of the middleware
 * service types.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Middleware<C> = internalMiddleware.Attached<C>;

/**
 * What the middleware chain of a {@link Callable} still requires: the
 * `requires` of each middleware that no middleware outside it provides.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type MiddlewareServices<C> = Exclude<
  internalMiddleware.AttachedServices<C>,
  CallableRequest.CallableRequest
>;

/**
 * What the middleware of a {@link Callable} provides to its handler.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type MiddlewareProvides<C> = CallableMiddleware.Provides<Middleware<C>>;

/**
 * The Payload type of a {@link Callable}: what its handler receives.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Payload<C extends Any> = C["payload"]["Type"];

/**
 * The success type of a {@link Callable}: what its handler succeeds with.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Success<C extends Any> = C["success"]["Type"];

/**
 * The union of the error schemas of a {@link Callable}.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type ErrorSchema<C extends Any> =
  | (C["error"] extends ReadonlySet<infer S extends Schema.Top> ? S : never)
  | CallableMiddleware.ErrorSchema<Middleware<C>>;

/**
 * The error type of a {@link Callable}: what its handler can fail with, and
 * what its client decodes back. It includes the errors of its middleware.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Error<C extends Any> = ErrorSchema<C>["Type"];

/**
 * Options for {@link make}.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface MakeOptions<
  Payload extends Schema.Top | Schema.Struct.Fields,
  Success extends Schema.Top,
  Error extends Schema.Top | ReadonlyArray<Schema.Top> = never,
> {
  /**
   * What the client sends: a schema, or the fields of a struct. Leave it out
   * for a Callable that takes nothing.
   */
  readonly payload?: Payload | undefined;
  /**
   * What the handler succeeds with. Leave it out for a Callable that answers
   * with nothing.
   */
  readonly success?: Success | undefined;
  /**
   * The errors the handler can fail with: one schema or an array. Leave it
   * out for a Callable that never fails with an error of its own.
   */
  readonly error?: Error | undefined;
}

/**
 * Declares a Callable.
 *
 * **When to use**
 *
 * Use to declare a server function once, in code that the server and the
 * client share.
 *
 * **Details**
 *
 * `payload` takes a schema or the fields of a struct, and defaults to
 * `Schema.Void`. `success` defaults to `Schema.Void`. `error` takes one
 * schema or an array; without it the Callable never fails with an error of
 * its own, and its client fails only with `CallableError`.
 *
 * All of them are sent through `Schema.toCodecJson`, so they must round-trip
 * through JSON. `Schema.Unknown` is the safe choice for "any JSON".
 * `Schema.Any` skips every check and is an escape hatch. A schema that can't
 * round-trip fails at runtime, not at compile time.
 *
 * An error is sent with the Firebase error code of its schema, `internal`
 * unless {@link errorCode} or its `callableErrorCode` annotation sets one.
 *
 * @example Declaring a Callable with a Payload and a success value
 * ```ts
 * import { Schema } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 *
 * const Greet = Callable.make("greet", {
 *   payload: { name: Schema.String, at: Schema.Date },
 *   success: Schema.Struct({ message: Schema.String }),
 * });
 * ```
 *
 * @example Declaring the errors a Callable can fail with
 * ```ts
 * import { Schema } from "effect";
 * import { Callable, CallableError } from "@visiolab/effect-firebase/functions";
 *
 * class NameTaken extends Schema.TaggedError<NameTaken>()(
 *   "NameTaken",
 *   { name: Schema.String },
 *   { callableErrorCode: "already-exists" },
 * ) {}
 *
 * const Register = Callable.make("register", {
 *   payload: { name: Schema.String },
 *   error: [NameTaken, CallableError.PermissionDenied],
 * });
 * ```
 *
 * @see {@link toLayer} for implementing the Callable on the server
 * @see {@link errorCode} for giving an error schema its code
 * @see {@link CallableGroup.make} for collecting Callables under one prefix
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const make = <
  const Name extends string,
  Payload extends Schema.Top | Schema.Struct.Fields = Schema.Void,
  Success extends Schema.Top = Schema.Void,
  const Error extends Schema.Top | ReadonlyArray<Schema.Top> = never,
>(
  name: Name,
  options?: MakeOptions<Payload, Success, Error>,
): Callable<
  Name,
  Payload extends Schema.Top
    ? Payload
    : Payload extends Schema.Struct.Fields
      ? Schema.Struct<Payload>
      : never,
  Success,
  Error extends ReadonlyArray<Schema.Top> ? Error[number] : Error
> => {
  const payload = options?.payload;
  const error: Schema.Top | ReadonlyArray<Schema.Top> | undefined = options?.error;
  return internal.make({
    error: new Set(error === undefined ? [] : Schema.isSchema(error) ? [error] : error),
    middlewares: new Set(),
    name,
    payload:
      payload === undefined
        ? Schema.Void
        : Schema.isSchema(payload)
          ? payload
          : Schema.Struct(payload as Schema.Struct.Fields),
    success: options?.success ?? Schema.Void,
  }) as never;
};

/**
 * Marks the {@link Handler} of a Callable in no group.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface NoGroup {
  readonly [internal.NoGroupTypeId]: typeof internal.NoGroupTypeId;
}

/**
 * The service a {@link toLayer} Layer provides: the Callable Handler of the
 * Callable `Name`, as served in `Group`.
 *
 * **Details**
 *
 * A handler is keyed by its group and its name, so the handler of `greet` in
 * no group is `Handler<NoGroup, "greet">`. A Layer that serves a Callable must
 * provide the handler under exactly that key.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Handler<Group, Name extends string> {
  readonly [internal.HandlerTypeId]: {
    readonly group: Group;
    readonly name: Name;
  };
}

/**
 * The {@link Handler} of a Callable in no group.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type HandlerFor<C extends Any> = Handler<NoGroup, C["name"]>;

/**
 * What implements a Callable: a function from the decoded Payload to an
 * Effect of the success value, failing only with the Callable's declared
 * errors.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type HandlerFunction<C extends Any, R> = (
  payload: Payload<C>,
) => Effect.Effect<Success<C>, Error<C>, R>;

/**
 * What a handler that requires `R` leaves for its {@link toLayer} Layer to
 * require: `R` without what the Callable's middleware provides and without
 * the {@link CallableRequest.CallableRequest}, which every call provides.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type HandlerServices<C, R> = Exclude<
  R,
  MiddlewareProvides<C> | CallableRequest.CallableRequest
>;

/**
 * What {@link handler} yields: the Callable's handler behind its middleware
 * chain, run in process.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type HandlerCall<C extends Any> = (
  payload: Payload<C>,
  request: CallableRequest.Input,
) => Effect.Effect<Success<C>, Error<C>>;

/**
 * What running the middleware chain of a {@link Callable} requires: its
 * handler, each middleware implementation, and what the chain still
 * requires.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type ChainServices<C extends Any, H> = H | Middleware<C> | MiddlewareServices<C>;

/**
 * Implements a Callable as a Layer.
 *
 * **When to use**
 *
 * Use to write the server side of a Callable. The Layer is what
 * `CallableFunction.make` or `CallableFunction.group` from
 * `@visiolab/effect-firebase-functions` serves.
 *
 * **Details**
 *
 * Pass the Callable for a Callable in no group. Pass its group and its name
 * for a member of a {@link CallableGroup.CallableGroup}: the Layer then
 * provides `Handler<"users", "create">`, which serves the member in that group
 * only. A Layer from the Callable on its own doesn't serve it in a group, and
 * a Callable in two groups needs a Layer for each.
 *
 * Takes the handler itself, or an Effect that builds it. The Effect runs once,
 * when the Layer is built, so do per-instance setup there.
 *
 * The Layer requires what the handler needs on each call and what building it
 * needs. Both are provided where the Layer is built: services built with the
 * Layer are shared by every call. What the Callable's middleware provides,
 * such as the `Caller`, and the {@link CallableRequest.CallableRequest} are
 * provided per call instead, so the Layer doesn't require them. Nor does it
 * require the middleware's implementations: those are required where the
 * chain runs.
 *
 * @example Implementing a Callable
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 *
 * const Greet = Callable.make("greet", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 *
 * const GreetLive = Callable.toLayer(Greet, ({ name }) => Effect.succeed(`Hello, ${name}!`));
 * ```
 *
 * @example Building the handler once per instance
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 *
 * const Greet = Callable.make("greet", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 *
 * const GreetLive = Callable.toLayer(
 *   Greet,
 *   Effect.gen(function* () {
 *     const greeting = yield* Effect.succeed("Hello");
 *     return ({ name }) => Effect.succeed(`${greeting}, ${name}!`);
 *   }),
 * );
 * ```
 *
 * @example Implementing a member of a group
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Callable, CallableGroup } from "@visiolab/effect-firebase/functions";
 *
 * const CreateUser = Callable.make("create", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 *
 * class Users extends CallableGroup.make("users").add(CreateUser) {}
 *
 * const CreateUserLive = Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name));
 * ```
 *
 * @see {@link make} for declaring the Callable
 * @see {@link serve} for running a call against the handler
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const toLayer: {
  <C extends Any, R = never, EB = never, RB = never>(
    callable: C,
    handler: HandlerFunction<C, R> | Effect.Effect<HandlerFunction<C, R>, EB, RB>,
  ): Layer.Layer<HandlerFor<C>, EB, HandlerServices<C, R> | RB>;
  <
    G extends CallableGroup.Any,
    const Name extends CallableGroup.Names<G>,
    R = never,
    EB = never,
    RB = never,
  >(
    group: G,
    name: Name,
    handler:
      | HandlerFunction<CallableGroup.Member<G, Name>, R>
      | Effect.Effect<HandlerFunction<CallableGroup.Member<G, Name>, R>, EB, RB>,
  ): Layer.Layer<
    Handler<G["identifier"], Name>,
    EB,
    HandlerServices<CallableGroup.Member<G, Name>, R> | RB
  >;
} = ((...args: ReadonlyArray<unknown>) => {
  const [group, callable] = target(args);
  // The handler's requirements are checked by the signatures, and provided
  // where the Layer is built.
  return internal.toLayer(
    group?.identifier,
    callable.name,
    args[group === undefined ? 1 : 2] as internal.HandlerInput,
  );
}) as never;

/**
 * Runs one call to a Callable, as it arrives on the wire. A building block for
 * the functions package. Most apps don't need it.
 *
 * **When to use**
 *
 * Use to serve Callables from a transport of your own. `CallableFunction`
 * from `@visiolab/effect-firebase-functions` serves them through
 * `firebase-functions`.
 *
 * **Details**
 *
 * Pass the Callable for a Callable in no group, or its group and its name for
 * a member of a {@link CallableGroup.CallableGroup}.
 *
 * Returns a function of the call's {@link CallableRequest.CallableRequest}. It
 * runs the middleware chain, the same one {@link handler} runs. Inside it, it
 * decodes the raw `data` with the Payload's `Schema.toCodecJson` and runs the
 * handler. It then encodes the success value with the success schema's
 * `Schema.toCodecJson`, so its result is plain JSON. The request is provided
 * to the chain. Give it a `rawRequest` built from your transport's HTTP
 * request, with `HttpServerRequest.fromWeb` from `effect/http/HttpServerRequest`.
 *
 * Requires the handler, every middleware implementation, and what the chain
 * still requires. They are read once, so a call needs nothing else.
 *
 * Every failure is a `CallableError` whose `ResponseError` reason is what to
 * answer with:
 *
 * - A declared error, or an error of a middleware, is sent with its schema's
 *   code, the error's `message` if it is a non-empty string, else its `_tag`,
 *   and the error encoded with its schema's `Schema.toCodecJson` as
 *   `details`.
 * - A raw Payload that doesn't decode is sent as `invalid-argument` with a
 *   generic message and no details. The `Schema.SchemaError` is logged at
 *   Debug.
 *
 * A defect, or a success or error value that doesn't encode, is a defect.
 * Answer it with a bare `internal`, so nothing of it reaches the caller.
 *
 * The `CallableError`'s `callable` is the deployed name: the Callable's name,
 * or `<group>-<name>` for a member of a group.
 *
 * @see {@link toLayer} for providing the handler
 * @see {@link handler} for running the handler in process, with typed values
 * @see {@link CallableFunction.make} for serving through `firebase-functions`
 * @see {@link deployment} for the name and span attributes a transport uses
 *
 * @stability unstable
 * @category serving
 * @since 0.3.0
 */
export const serve: {
  <C extends Any>(
    callable: C,
  ): Effect.Effect<
    (
      request: CallableRequest.CallableRequest,
    ) => Effect.Effect<unknown, CallableError.CallableError>,
    never,
    ChainServices<C, HandlerFor<C>>
  >;
  <G extends CallableGroup.Any, const Name extends CallableGroup.Names<G>>(
    group: G,
    name: Name,
  ): Effect.Effect<
    (
      request: CallableRequest.CallableRequest,
    ) => Effect.Effect<unknown, CallableError.CallableError>,
    never,
    ChainServices<CallableGroup.Member<G, Name>, Handler<G["identifier"], Name>>
  >;
} = ((...args: ReadonlyArray<unknown>) => internal.serve(...target(args))) as never;

/**
 * Runs a Callable's handler in process, behind its middleware chain.
 *
 * **When to use**
 *
 * Use to test a handler and its middleware without the emulator and without
 * `firebase-functions`. Provide the same Layers you serve it with, or stub a
 * middleware with a Layer of your own.
 *
 * **Details**
 *
 * Pass the Callable for a Callable in no group, or its group and its name for
 * a member of a {@link CallableGroup.CallableGroup}.
 *
 * Requires the handler, every middleware implementation, and what the chain
 * still requires. A middleware whose
 * `requires` no middleware outside it provides leaves that requirement here,
 * so a chain in the wrong order is a type error where the Layers are
 * provided.
 *
 * Yields a function of the Payload and a {@link CallableRequest.Input}: `{}`
 * for a signed-out call, `{ auth: { uid, token } }` for a signed-in one. It
 * encodes the Payload with `Schema.toCodecJson` as the request's raw `data`,
 * so middleware sees what it would see on the wire. The request's
 * `rawRequest` is the input's, or else a JSON `POST` of the encoded Payload to
 * `http://localhost/<deployed name>` (see
 * {@link CallableRequest.Input.rawRequest}). It runs the chain that
 * `CallableFunction` runs, and fails with the Callable's declared errors and
 * those of its middleware. The success value is the handler's, not encoded.
 *
 * @example Running a handler behind Authenticated
 * ```ts
 * import { Effect, Layer, Schema } from "effect";
 * import { Callable, Caller } from "@visiolab/effect-firebase/functions";
 *
 * const WhoAmI = Callable.make("whoAmI", { success: Schema.String }).middleware(
 *   Caller.Authenticated,
 * );
 *
 * const WhoAmILive = Callable.toLayer(WhoAmI, () =>
 *   Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
 * );
 *
 * const program = Effect.gen(function* () {
 *   const whoAmI = yield* Callable.handler(WhoAmI);
 *   // "ada"
 *   return yield* whoAmI(undefined, { auth: { uid: "ada", token: {} } });
 * }).pipe(Effect.provide(Layer.merge(WhoAmILive, Caller.Authenticated.layer)));
 * ```
 *
 * @see {@link serve} for running a call as it arrives on the wire
 * @see {@link toLayer} for providing the handler
 * @see {@link CallableFunction.make} for serving the same chain through `firebase-functions`
 *
 * @stability unstable
 * @category serving
 * @since 0.3.0
 */
export const handler: {
  <C extends Any>(
    callable: C,
  ): Effect.Effect<HandlerCall<C>, never, ChainServices<C, HandlerFor<C>>>;
  <G extends CallableGroup.Any, const Name extends CallableGroup.Names<G>>(
    group: G,
    name: Name,
  ): Effect.Effect<
    HandlerCall<CallableGroup.Member<G, Name>>,
    never,
    ChainServices<CallableGroup.Member<G, Name>, Handler<G["identifier"], Name>>
  >;
} = ((...args: ReadonlyArray<unknown>) => internal.handler(...target(args))) as never;

/**
 * Sets the Firebase error code a Callable answers with when it fails with
 * errors of this schema.
 *
 * **When to use**
 *
 * Use to give a code to an error schema you don't own. For an error class of
 * your own, set `callableErrorCode` in its annotations instead, so every
 * Callable that lists it uses the same code.
 *
 * **Details**
 *
 * An error schema without a code is sent as `internal`. The client reads the
 * code to find the declared errors to decode the answer against, so the code
 * is part of the contract.
 *
 * @example Giving codes to error schemas
 * ```ts
 * import { Schema } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 *
 * class NameTaken extends Schema.TaggedError<NameTaken>()(
 *   "NameTaken",
 *   { name: Schema.String },
 *   { callableErrorCode: "already-exists" },
 * ) {}
 *
 * class Banned extends Schema.TaggedError<Banned>()("Banned", {}) {}
 *
 * const Register = Callable.make("register", {
 *   payload: { name: Schema.String },
 *   error: [NameTaken, Banned.pipe(Callable.errorCode("permission-denied"))],
 * });
 * ```
 *
 * @see {@link getErrorCode} for reading the code back
 *
 * @stability unstable
 * @category errors
 * @since 0.3.0
 */
export const errorCode =
  (code: CallableError.ErrorCode) =>
  <S extends Schema.Top>(self: S): S["Rebuild"] =>
    self.annotate({ callableErrorCode: code });

/**
 * Reads the Firebase error code of an error schema: what {@link errorCode} or
 * its `callableErrorCode` annotation set, else `internal`. A building block
 * for the functions and client packages. Most apps don't need it.
 *
 * **When to use**
 *
 * Use when serving or calling Callables from a transport of your own.
 *
 * @see {@link errorCode} for setting the code
 * @see {@link errorSchemas} for the schemas a call can be answered with
 *
 * @stability unstable
 * @category errors
 * @since 0.3.0
 */
export const getErrorCode: (schema: Schema.Top) => CallableError.ErrorCode = internal.getErrorCode;

/**
 * The schemas of every error a call can be answered with: the Callable's
 * declared errors, then those of its middleware. A building block for the
 * client package. Most apps don't need it.
 *
 * **When to use**
 *
 * Use when calling Callables from a transport of your own, to decode an
 * error's `details` against the schemas that carry its code.
 *
 * **Details**
 *
 * Pass the Callable for a Callable in no group, or its group and its name for
 * a member of a {@link CallableGroup.CallableGroup}.
 *
 * @see {@link getErrorCode} for the code of each schema
 * @see {@link deployment} for the name a transport calls
 *
 * @stability unstable
 * @category errors
 * @since 0.3.0
 */
export const errorSchemas: {
  (callable: Any): ReadonlyArray<Schema.Top>;
  <G extends CallableGroup.Any>(group: G, name: CallableGroup.Names<G>): ReadonlyArray<Schema.Top>;
} = ((...args: ReadonlyArray<unknown>) => internal.errorSchemas(target(args)[1])) as never;

/**
 * Where a Callable is served: the name it is deployed under and the
 * attributes of each call's spans.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Deployment {
  /**
   * The name the Callable Function is exported under and the client calls:
   * the Callable's name, or `<group>-<name>` for a member of a group.
   */
  readonly name: string;
  /**
   * The attributes of the server's and the client's span of a call:
   * `rpc.system: "firebase_callable"`, `rpc.method` (the Callable's name),
   * `rpc.service` (the group, for a member) and `faas.name` (the deployed
   * name).
   */
  readonly attributes: Readonly<Record<string, string>>;
}

/**
 * Returns the {@link Deployment} of a Callable: its deployed name and its span
 * attributes. A building block of the functions and client packages, which
 * agree on both through it. Most apps don't need it.
 *
 * **When to use**
 *
 * Use when serving or calling Callables from a transport of your own.
 * `CallableFunction` and `CallableClient` already use it.
 *
 * **Details**
 *
 * Pass the Callable for a Callable in no group, or its group and its name for
 * a member of a {@link CallableGroup.CallableGroup}.
 *
 * @example Reading the deployed name of a member
 * ```ts
 * import { Schema } from "effect";
 * import { Callable, CallableGroup } from "@visiolab/effect-firebase/functions";
 *
 * const CreateUser = Callable.make("create", { payload: { name: Schema.String } });
 *
 * class Users extends CallableGroup.make("users").add(CreateUser) {}
 *
 * // "users-create"
 * const { name } = Callable.deployment(Users, "create");
 * ```
 *
 * @see {@link serve} for running a call on the server
 * @see {@link errorSchemas} for the errors a call can be answered with
 *
 * @stability unstable
 * @category serving
 * @since 0.3.0
 */
export const deployment: {
  (callable: Any): Deployment;
  <G extends CallableGroup.Any>(group: G, name: CallableGroup.Names<G>): Deployment;
} = ((...args: ReadonlyArray<unknown>) => {
  const [group, callable] = target(args);
  return {
    name: internal.deployedName(group, callable),
    attributes: internal.spanAttributes(group, callable),
  };
}) as never;
