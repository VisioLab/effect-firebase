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
import { type Pipeable, Schema } from "effect";
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
