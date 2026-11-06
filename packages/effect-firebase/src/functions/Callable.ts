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
import { type Effect, type Layer, type Pipeable, Schema } from "effect";
import type * as CallableError from "./CallableError.ts";
import * as internal from "./internal/callable.ts";

const TypeId = internal.TypeId;

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
>
  extends Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId;
  /** The Callable's name, which a Callable in no group is deployed under. */
  readonly name: Name;
  /** The schema of what the client sends. */
  readonly payload: Payload;
  /** The schema of what the handler succeeds with. */
  readonly success: Success;
}

/**
 * Any {@link Callable}, whatever its name and schemas.
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
}

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
 * Options for {@link make}.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface MakeOptions<
  Payload extends Schema.Top | Schema.Struct.Fields,
  Success extends Schema.Top,
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
 * `Schema.Void`. `success` defaults to `Schema.Void`.
 *
 * Both are sent through `Schema.toCodecJson`, so they must round-trip through
 * JSON. `Schema.Unknown` is the safe choice for "any JSON". `Schema.Any` skips
 * every check and is an escape hatch. A schema that can't round-trip fails at
 * runtime, not at compile time.
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
 * @see {@link toLayer} for implementing the Callable on the server
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const make = <
  const Name extends string,
  Payload extends Schema.Top | Schema.Struct.Fields = Schema.Void,
  Success extends Schema.Top = Schema.Void,
>(
  name: Name,
  options?: MakeOptions<Payload, Success>,
): Callable<
  Name,
  Payload extends Schema.Top
    ? Payload
    : Payload extends Schema.Struct.Fields
      ? Schema.Struct<Payload>
      : never,
  Success
> => {
  const payload = options?.payload;
  return internal.make({
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
 * Effect of the success value.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type HandlerFunction<C extends Any, R> = (
  payload: Payload<C>,
) => Effect.Effect<Success<C>, never, R>;

/**
 * Implements a Callable as a Layer.
 *
 * **When to use**
 *
 * Use to write the server side of a Callable in no group. The Layer is what
 * `CallableFunction.make` from `@visiolab/effect-firebase-functions` serves.
 *
 * **Details**
 *
 * Takes the handler itself, or an Effect that builds it. The Effect runs once,
 * when the Layer is built, so do per-instance setup there.
 *
 * The Layer requires what the handler needs on each call and what building it
 * needs. Both are provided where the Layer is built: services built with the
 * Layer are shared by every call.
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
 * @see {@link make} for declaring the Callable
 * @see {@link serve} for running a call against the handler
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const toLayer = <C extends Any, R = never, EB = never, RB = never>(
  callable: C,
  handler: HandlerFunction<C, R> | Effect.Effect<HandlerFunction<C, R>, EB, RB>,
): Layer.Layer<HandlerFor<C>, EB, R | RB> =>
  // The handler's requirements are checked here, by the signature, and
  // provided where the Layer is built.
  internal.toLayer(callable.name, handler as unknown as internal.HandlerInput) as never;

/**
 * Runs one call to a Callable in no group, as it arrives on the wire.
 *
 * **When to use**
 *
 * Use to serve Callables from a transport of your own. `CallableFunction`
 * from `@visiolab/effect-firebase-functions` serves them through
 * `firebase-functions`.
 *
 * **Details**
 *
 * Returns a function that decodes the raw Payload with the Payload's
 * `Schema.toCodecJson`, runs the handler, and encodes the success value with
 * the success schema's `Schema.toCodecJson`. Its result is plain JSON.
 *
 * Fails with the `Schema.SchemaError` when the raw Payload doesn't decode. A
 * success value that doesn't encode is a defect.
 *
 * @see {@link toLayer} for providing the handler
 *
 * @stability unstable
 * @category serving
 * @since 0.3.0
 */
export const serve = <C extends Any>(
  callable: C,
): Effect.Effect<
  (data: unknown) => Effect.Effect<unknown, Schema.SchemaError>,
  never,
  HandlerFor<C>
> => internal.serve(callable) as never;

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
 * its `callableErrorCode` annotation set, else `internal`.
 *
 * **When to use**
 *
 * Use when serving or calling Callables from a transport of your own.
 *
 * @see {@link errorCode} for setting the code
 *
 * @stability unstable
 * @category errors
 * @since 0.3.0
 */
export const getErrorCode = (schema: Schema.Top): CallableError.ErrorCode =>
  Schema.resolveAnnotations(schema)?.callableErrorCode ?? "internal";
