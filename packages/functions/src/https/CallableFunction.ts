/**
 * Serves Callables as Callable Functions, which plain `firebase deploy`
 * deploys. {@link make} serves a Callable in no group under
 * its name, and {@link group} serves each member of a Callable Group as
 * `<group>-<name>`.
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
 * Every call runs in a `kind: "server"` span named `CallableFunction.<deployed
 * name>`, such as `CallableFunction.users-create`, with the attributes
 * `rpc.system: "firebase_callable"`, `rpc.method` (the Callable's name),
 * `rpc.service` (the group, for a member) and `faas.name` (the deployed name).
 * The span covers the Payload decoding, the handler and the encoding of the
 * answer, and the Layer build on the call that triggers it. Spans the handler
 * or the build open are its children. The span is always on, and is exported
 * only when the Layer provides a `Tracer`.
 *
 * The span's parent is the trace context Firebase reads from the request: the
 * `X-Cloud-Trace-Context` header, else `traceparent`. With neither, as in the
 * emulator, the span is a root span. The client's span of the same call is not
 * linked to it, so the two land in separate traces. The span carries no uid;
 * add one in the handler with `Effect.annotateCurrentSpan`.
 *
 * Every call logs through `CloudLogging.layer`, provided beneath the Layer you
 * serve: Effect logs land in Cloud Logging as structured entries tied to the
 * current span, so concurrent calls on one instance each log under their own
 * trace. A `Logger.layer` in the Layer replaces it. Logs of a first call's
 * Layer build are written once the build is done, when the spans they were
 * logged under have their final ids. Entries carry no timestamp, so Cloud
 * Logging stamps them with the time the build finished. Entries carry no uid; add one in the
 * handler with `Effect.annotateLogs`.
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
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import type * as CallableGroup from "@visiolab/effect-firebase/functions/CallableGroup";
import type * as Https from "firebase-functions/v2/https";
import type * as FunctionsCallableRequest from "./FunctionsCallableRequest.ts";
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
 * The exports of {@link group}: one Callable Function per member, keyed by the
 * member's name, under the group's name.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type GroupExports<G extends CallableGroup.Any> = {
  readonly [K in G["identifier"]]: { readonly [N in CallableGroup.Names<G>]: Export };
};

/**
 * The options of {@link group}: Firebase's `CallableOptions` per member, keyed
 * by the member's name. Members left out get none.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type GroupOptions<G extends CallableGroup.Any> = {
  readonly [N in CallableGroup.Names<G>]?: Https.CallableOptions;
};

/**
 * The Layer {@link make} and {@link group} serve: it provides `Services`
 * except the {@link FunctionsCallableRequest.FunctionsCallableRequest}, and may
 * leave that one required.
 *
 * **Details**
 *
 * Every call provides the `FunctionsCallableRequest`, as it does the portable
 * `CallableRequest`, so a handler or middleware may require it and `Live`
 * needn't provide it. It is provided to calls only, not while the Layer is
 * built: an Effect that builds a handler can't read it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Live<Services, E> = Layer.Layer<
  Exclude<Services, FunctionsCallableRequest.FunctionsCallableRequest>,
  E,
  FunctionsCallableRequest.FunctionsCallableRequest
>;

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
 * the implementation of each of its middleware, such as
 * `Caller.Authenticated.layer`, and leave nothing required but the
 * {@link FunctionsCallableRequest.FunctionsCallableRequest}, which every call
 * provides (see {@link Live}). It may provide more. `CallableFunction` provides no middleware itself. Give each export a
 * Layer of its own where you can: a cold instance then builds only what its
 * own function needs.
 *
 * `options` is Firebase's `CallableOptions`, passed to `onCall` unchanged.
 *
 * The export is exactly what `onCall` returns, so its `__endpoint` and `run`
 * work as for any `onCall` function.
 *
 * Each call runs the Callable's middleware chain, the one `Callable.handler`
 * runs, with Firebase's request provided as both `CallableRequest` and
 * {@link FunctionsCallableRequest.FunctionsCallableRequest}. The Payload is
 * decoded inside the chain, after the middleware.
 *
 * A failed call answers with an `HttpsError`:
 *
 * - A declared error, or an error of a middleware, is sent with its schema's
 *   code, the error's `message` (else its `_tag`) and the error encoded with
 *   `Schema.toCodecJson` as `details`, so the client decodes it back into its
 *   class. A middleware that rejects the call answers before the Payload is
 *   decoded.
 * - A Payload that doesn't decode is answered with `invalid-argument`, a
 *   generic message and no details. It is logged at Debug.
 * - A defect, or a success or error value that doesn't encode, is answered
 *   with a bare `internal`. Its Cause is logged at Error, with the logger of
 *   `live` if it provides one.
 * - A Layer that fails to build answers the call with a bare `internal` and
 *   is logged at Error. The next call builds it again.
 * - An interrupt of the handler is answered with `unavailable`. When the
 *   client disconnects, the handler is interrupted and the call is answered
 *   with `cancelled`, as far as the platform reports the disconnect.
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
 * @see {@link group} for serving the members of a Callable Group
 * @see {@link Callable.serve} for serving from a transport of your own
 * @see {@link Callable.handler} for running the handler in process
 * @see {@link CallableClient.make} for calling it from the client
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = <C extends Callable.Any, E>(
  callable: C,
  live: Live<Callable.ChainServices<C, Callable.HandlerFor<C>>, E>,
  options?: Https.CallableOptions,
): Exports<C> =>
  ({
    [callable.name]: internal.onCall(
      Callable.deployment(callable),
      Callable.serve(callable),
      live,
      options,
    ),
  }) as Exports<C>;

/**
 * Serves the members of a Callable Group, each as a Callable Function of its
 * own.
 *
 * **When to use**
 *
 * Use to export a Callable Group. Destructure the result into the module's
 * exports, so `export const { users } = CallableFunction.group(Users, Live)`
 * deploys `users-create`, `users-delete` and so on.
 *
 * **Details**
 *
 * `live` must provide the handler of every member, each from
 * `Callable.toLayer(Users, name, handler)`, and the implementation of every
 * member's middleware, and leave nothing required but the
 * `FunctionsCallableRequest` (see {@link Live}). A
 * handler from `Callable.toLayer` of the Callable on its own doesn't serve it
 * in the group. `live` may provide more, such as the handlers of other groups.
 *
 * Each member is its own function, with a worker of its own. A worker builds
 * `live` on the first call to its own function, and never for another
 * member's. One `live` per group is fine. Split it when members need very
 * different services, so a cold instance builds only what its function needs.
 *
 * `options` holds Firebase's `CallableOptions` per member, keyed by the
 * member's name, each passed to that member's `onCall` unchanged. The group has
 * no options of its own: set those once with `setGlobalOptions`.
 *
 * Each export is exactly what `onCall` returns, and fails as one from
 * {@link make} does.
 *
 * @example Exporting a Callable Group
 * ```ts
 * import { Effect, Layer, Schema } from "effect";
 * import { Callable, CallableGroup } from "@visiolab/effect-firebase/functions";
 * import { CallableFunction } from "@visiolab/effect-firebase-functions/https";
 *
 * const CreateUser = Callable.make("create", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 * const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });
 *
 * class Users extends CallableGroup.make("users").add(CreateUser, DeleteUser) {}
 *
 * const UsersLive = Layer.mergeAll(
 *   Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name)),
 *   Callable.toLayer(Users, "delete", () => Effect.void),
 * );
 *
 * // Deploys `users-create` and `users-delete`.
 * export const { users } = CallableFunction.group(Users, UsersLive, {
 *   delete: { region: "europe-west1" },
 * });
 * ```
 *
 * @see {@link make} for serving a Callable in no group
 * @see {@link CallableClient.make} for calling the members from the client
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const group = <G extends CallableGroup.Any, E>(
  group: G,
  live: Live<CallableGroup.ChainServices<G>, E>,
  options?: GroupOptions<G>,
): GroupExports<G> => {
  const exports: Record<string, Export> = {};
  for (const name of Object.keys(group.callables)) {
    exports[name] = internal.onCall(
      Callable.deployment(group, name),
      Callable.serve(group, name),
      live,
      (options as Record<string, Https.CallableOptions | undefined> | undefined)?.[name],
    );
  }
  return { [group.identifier]: exports } as GroupExports<G>;
};
