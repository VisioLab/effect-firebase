/**
 * Serves Callables as Callable Functions: real `onCall` exports that plain
 * `firebase deploy` deploys.
 *
 * Each export is built at once and synchronously, and builds nothing: the
 * Layer that implements it is built on the first call, so discovery and deploy
 * never run your setup. Every Layer is built through one memo map per process,
 * so a Layer shared by several exports is built once, and concurrent first
 * calls share one build.
 *
 * Where it differs from a plain `onCall` function:
 *
 * - The Payload and the success value cross the wire as `Schema.toCodecJson`
 *   output, so a `Date` arrives as a `Date`.
 * - Finalizers of the Layer don't run when the instance shuts down. Release
 *   what must be released within the call.
 * - `minInstances` keeps an instance alive, but its Layer is still built on the
 *   first call.
 * - Call `setGlobalOptions` before any function is defined, as Firebase
 *   requires.
 *
 * @example Serving a Callable
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 * import { CallableFunction } from "@visiolab/effect-firebase-functions/https";
 *
 * const Greet = Callable.make("greet", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 *
 * const GreetLive = Callable.toLayer(Greet, ({ name }) => Effect.succeed(`Hello, ${name}!`));
 *
 * export const { greet } = CallableFunction.make(Greet, GreetLive, { region: "europe-west1" });
 * ```
 *
 * @stability unstable
 * @since 0.1.0
 */
import type { Layer } from "effect";
import type * as Callable from "@visiolab/effect-firebase/functions/Callable";
import type * as Https from "firebase-functions/v2/https";
import * as internal from "./internal/callableFunction.ts";

/**
 * The value `onCall` returns for a Callable: what firebase-tools discovers and
 * deploys.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Export = Https.CallableFunction<unknown, Promise<unknown>>;

/**
 * The exports of {@link make}: one Callable Function under the Callable's name.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Exports<C extends Callable.Any> = { readonly [K in C["name"]]: Export };

/**
 * Serves a Callable in no group as a Callable Function.
 *
 * **When to use**
 *
 * Use to export a Callable in no group. Destructure the result into the
 * module's exports, so the export's name is the Callable's.
 *
 * **Details**
 *
 * `live` must provide the Callable's handler, from `Callable.toLayer`, and
 * leave nothing required. It may provide more. Give each export a Layer of its
 * own where you can: a cold instance then builds only what its own function
 * needs.
 *
 * `options` is Firebase's `CallableOptions`, passed to `onCall` unchanged.
 *
 * The export is exactly what `onCall` returns, so its `__endpoint` and `run`
 * work as for any `onCall` function.
 *
 * If the Payload doesn't decode, the handler fails or dies, or the Layer fails
 * to build, the call fails with a bare `internal` error and the cause is
 * logged.
 *
 * @example Exporting a Callable Function
 * ```ts
 * import { Effect } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 * import { CallableFunction } from "@visiolab/effect-firebase-functions/https";
 *
 * const Ping = Callable.make("ping");
 *
 * export const { ping } = CallableFunction.make(Ping, Callable.toLayer(Ping, () => Effect.void));
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = <C extends Callable.Any, E>(
  callable: C,
  live: Layer.Layer<Callable.HandlerFor<C>, E>,
  options?: Https.CallableOptions,
): Exports<C> =>
  ({
    [callable.name]: internal.onCall(callable, live, options),
  }) as Exports<C>;
