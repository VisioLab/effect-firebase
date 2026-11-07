/**
 * Deploys Functions, of any kind, as Cloud Functions for Firebase, which plain
 * `firebase deploy` deploys. {@link make} deploys a Function in no group under
 * its name, and {@link group} deploys each member of a Function Group as
 * `<group>-<name>`. Each dispatches on the Function's kind: a Callable is
 * served with `onCall`, and a Document Trigger with `onDocumentCreated`.
 *
 * Each export is built at once and synchronously, and builds nothing: the
 * Layer that implements it is built on the first call or event, so discovery
 * and deploy never run your setup. Every Layer is built through one memo map
 * per process, so a Layer shared by several exports is built once, and
 * concurrent first calls share one build.
 *
 * Where it differs from a plain `firebase-functions` function:
 *
 * - Finalizers of the Layer don't run when the instance shuts down. Release
 *   what must be released within the call.
 * - `minInstances` keeps an instance alive, but its Layer is still built on the
 *   first call.
 * - Call `setGlobalOptions` before any function is defined, as Firebase
 *   requires.
 *
 * Every call or event logs through `CloudLogging.layer`, provided beneath the
 * Layer you serve: Effect logs land in Cloud Logging as structured entries
 * tied to the current span, so concurrent calls on one instance each log under
 * their own trace. A `Logger.layer` in the Layer replaces it. Logs of a first
 * call's Layer build are written once the build is done, when the spans they
 * were logged under have their final ids. Entries carry no timestamp, so
 * Cloud Logging stamps them with the time the build finished. Entries carry
 * no uid; add one in the handler with `Effect.annotateLogs`.
 *
 * Its span's parent is the trace context Firebase reads from the request or
 * event. With none, as in the emulator, the span is a root span. The span is
 * always on, and is exported only when the Layer provides a `Tracer`.
 *
 * **Callables**
 *
 * A Callable's Payload and success value cross the wire as
 * `Schema.toCodecJson` output, so a `Date` arrives as a `Date`.
 *
 * Every call runs in a `kind: "server"` span named `CallableFunction.<deployed
 * name>`, such as `CallableFunction.users-create`, with the attributes
 * `rpc.system: "firebase_callable"`, `rpc.method` (the Callable's name),
 * `rpc.service` (the group, for a member) and `faas.name` (the deployed name).
 * The span covers the Payload decoding, the handler and the encoding of the
 * answer, and the Layer build on the call that triggers it. Spans the handler
 * or the build open are its children. The trace context comes from the
 * `X-Cloud-Trace-Context` header, else `traceparent`. The client's span of
 * the same call is not linked to it, so the two land in separate traces. The
 * span carries no uid; add one in the handler with `Effect.annotateCurrentSpan`.
 *
 * **Document Triggers**
 *
 * A Document Trigger listens to the `(default)` database, at the path
 * pattern of its collection. Each event runs in a `kind: "server"` span named
 * `DocumentTrigger.<deployed name>`. Firebase delivers each event at least
 * once, so make the handler idempotent, keyed on the event's `id`.
 *
 * @example Deploying a Callable
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 * import { Functions } from "@visiolab/effect-firebase-functions";
 *
 * const Greet = Callable.make("greet", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 *
 * const GreetLive = Callable.toLayer(Greet, ({ name }) => Effect.succeed(`Hello, ${name}!`));
 *
 * export const { greet } = Functions.make(Greet, GreetLive, { region: "europe-west1" });
 * ```
 *
 * @stability unstable
 * @since 0.3.0
 */
import type { Layer } from "effect";
import type * as Callable from "@visiolab/effect-firebase/functions/Callable";
import type * as DocumentTrigger from "@visiolab/effect-firebase/functions/DocumentTrigger";
import type * as FirebaseFunction from "@visiolab/effect-firebase/functions/FirebaseFunction";
import type * as FunctionGroup from "@visiolab/effect-firebase/functions/FunctionGroup";
import type { CloudFunction } from "firebase-functions/v2";
import type * as Firestore from "firebase-functions/v2/firestore";
import type * as Https from "firebase-functions/v2/https";
import * as kinds from "./internal/kinds.ts";

/**
 * The value `onCall` returns for a Callable: what firebase-tools discovers and
 * deploys.
 *
 * @see {@link Export} for the export of a Function of any kind
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type CallableExport = Https.CallableFunction<unknown, Promise<unknown>>;

/**
 * The value `onDocumentCreated` returns for a Document Trigger, by the change
 * it runs on: what firebase-tools discovers and deploys.
 *
 * @see {@link Export} for the export of a Function of any kind
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type DocumentTriggerExport<T extends DocumentTrigger.Any> = T["event"] extends "created"
  ? CloudFunction<Firestore.FirestoreEvent<Firestore.QueryDocumentSnapshot | undefined>>
  : never;

/**
 * The deploy options of a Document Trigger: Firebase's `DocumentOptions`
 * without what the library derives from the trigger. That leaves the options
 * every Function shares, such as `region`, `memory` and `timeoutSeconds`,
 * plus `retry`.
 *
 * **Details**
 *
 * The `document` path pattern comes from the trigger's collection, and the
 * database is always `(default)`, the one `Firestore` reads and writes, so
 * `document`, `database` and `namespace` are left out, as are the event
 * filter options.
 *
 * With `retry: true`, Firebase delivers a failed event again until it
 * succeeds or its retry window ends. Without it, a failed event is dropped.
 * The library adds no retry of its own.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type DocumentTriggerOptions = Omit<
  Firestore.DocumentOptions,
  | "document"
  | "database"
  | "namespace"
  | "eventType"
  | "eventFilters"
  | "eventFilterPathPatterns"
  | "channel"
>;

/**
 * The export of a Function, by its kind: a {@link CallableExport} for a
 * Callable, a {@link DocumentTriggerExport} for a Document Trigger.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Export<F extends FirebaseFunction.Any> = F extends Callable.Any
  ? CallableExport
  : F extends DocumentTrigger.Any
    ? DocumentTriggerExport<F>
    : never;

/**
 * The deploy options of a Function, by its kind: Firebase's `CallableOptions`
 * for a Callable, passed to `onCall` unchanged, and
 * {@link DocumentTriggerOptions} for a Document Trigger.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Options<F extends FirebaseFunction.Any> = F extends Callable.Any
  ? Https.CallableOptions
  : F extends DocumentTrigger.Any
    ? DocumentTriggerOptions
    : never;

/**
 * What serving a Function under the handler key `H` requires, by its kind.
 * For a Callable: its handler, the implementation of each of its middleware,
 * and what its middleware chain still requires. For a Document Trigger: its
 * handler.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Services<F extends FirebaseFunction.Any, H> = F extends Callable.Any
  ? Callable.ChainServices<F, H>
  : F extends DocumentTrigger.Any
    ? H
    : never;

/**
 * What serving every member of a {@link FunctionGroup.FunctionGroup}
 * requires: what each member requires, by its kind, under its handler key in
 * the group.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type GroupServices<G extends FunctionGroup.Any> =
  FunctionGroup.Names<G> extends infer Name
    ? Name extends string
      ? Services<FunctionGroup.Member<G, Name>, FirebaseFunction.Handler<G["identifier"], Name>>
      : never
    : never;

/**
 * The exports of {@link make}: one export under the Function's name.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type Exports<F extends FirebaseFunction.Any> = { readonly [K in F["name"]]: Export<F> };

/**
 * The exports of {@link group}: one export per member, keyed by the member's
 * name, under the group's name.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type GroupExports<G extends FunctionGroup.Any> = {
  readonly [K in G["identifier"]]: {
    readonly [N in FunctionGroup.Names<G>]: Export<FunctionGroup.Member<G, N>>;
  };
};

/**
 * The options of {@link group}: each member's {@link Options}, typed by its
 * kind and keyed by its name. Members left out get none.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type GroupOptions<G extends FunctionGroup.Any> = {
  readonly [N in FunctionGroup.Names<G>]?: Options<FunctionGroup.Member<G, N>>;
};

/**
 * Deploys a Function in no group, whatever its kind.
 *
 * **When to use**
 *
 * Use to export a Function in no group. Destructure the result into the
 * module's exports, so the export's name is the Function's.
 *
 * **Details**
 *
 * `live` must provide what the Function's kind needs and leave nothing
 * required. It may provide more. Give each export a Layer of its own where you
 * can: a cold instance then builds only what its own function needs.
 *
 * `options` are typed by the Function's kind (see {@link Options}).
 *
 * For a Callable, `live` provides its handler, from `Callable.toLayer`, and
 * the implementation of each of its middleware, such as
 * `Caller.Authenticated.layer`. `Functions` provides no middleware itself.
 * `options` is Firebase's `CallableOptions`, and the export is exactly what
 * `onCall` returns, so its `__endpoint` and `run` work as for any `onCall`
 * function.
 *
 * For a Document Trigger, `live` provides its handler, from
 * `DocumentTrigger.toLayer`. `options` are {@link DocumentTriggerOptions}:
 * the shared options plus `retry`. The export is what `onDocumentCreated`
 * returns for the `(default)` database and the path pattern of the trigger's
 * collection. Each event is converted into the trigger's event, its data read
 * into Firestore Values as a read does, and run through
 * `DocumentTrigger.serve`, in a `kind: "server"` span named
 * `DocumentTrigger.<deployed name>` with `faas.name` and
 * `faas.trigger: "datasource"`, logging through `CloudLogging.layer`. Any
 * failure, whether a typed error, a defect, an interrupt or a Layer that
 * fails to build, is logged at Error in that span and makes the function
 * throw, so Firebase delivers the event again when `retry` is set. A Layer
 * that failed to build is built again on the next event.
 *
 * Each call runs the Callable's middleware chain, the one `Callable.handler`
 * runs, with Firebase's request provided as the portable `CallableRequest`.
 * Its `rawRequest` is Firebase's Express request as Effect's
 * `HttpServerRequest`, with the caller's IP address as `remoteAddress`. Its
 * body streams Firebase's buffered bytes without copying them. The Payload is
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
 * @example Exporting a Callable
 * ```ts
 * import { Effect } from "effect";
 * import { Callable } from "@visiolab/effect-firebase/functions";
 * import { Functions } from "@visiolab/effect-firebase-functions";
 *
 * const Ping = Callable.make("ping");
 *
 * export const { ping } = Functions.make(Ping, Callable.toLayer(Ping, () => Effect.void));
 * ```
 *
 * @example Exporting a Document Trigger
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 * import { Functions } from "@visiolab/effect-firebase-functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const OnPostCreated = DocumentTrigger.created("onPostCreated", Collection.make("posts", Post));
 *
 * export const { onPostCreated } = Functions.make(
 *   OnPostCreated,
 *   DocumentTrigger.toLayer(OnPostCreated, (event) =>
 *     Effect.flatMap(event.snapshot.data, (post) => Effect.log(`New post: ${post.title}`)),
 *   ),
 *   { retry: true },
 * );
 * ```
 *
 * @see {@link group} for deploying the members of a Function Group
 * @see {@link Callable.serve} for serving a Callable from a transport of your own
 * @see {@link Callable.handler} for running a Callable's handler in process
 * @see {@link DocumentTrigger.serve} for running a Document Trigger's event in process
 * @see {@link CallableClient.make} for calling a Callable from the client
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const make = <F extends FirebaseFunction.Any, E>(
  fn: F,
  live: Layer.Layer<Services<F, FirebaseFunction.HandlerFor<F>>, E>,
  options?: Options<F>,
): Exports<F> =>
  ({
    [fn.name]: kinds.deploy(undefined, fn, live, options),
  }) as Exports<F>;

/**
 * Deploys the members of a Function Group, each as a function of its own,
 * whatever their kinds.
 *
 * **When to use**
 *
 * Use to export a Function Group. Destructure the result into the module's
 * exports, so `export const { users } = Functions.group(Users, Live)` deploys
 * `users-create`, `users-delete` and so on.
 *
 * **Details**
 *
 * `live` must provide what every member needs, by its kind, and leave nothing
 * required. For a Callable member, that is its handler, from
 * `Callable.toLayer(Users, name, handler)`, and the implementation of each of
 * its middleware. A handler from `Callable.toLayer` of the Callable on its
 * own doesn't serve it in the group. `live` may provide more, such as the
 * handlers of other groups.
 *
 * Each member is its own function, with a worker of its own. A worker builds
 * `live` on the first call to its own function, and never for another
 * member's. One `live` per group is fine. Split it when members need very
 * different services, so a cold instance builds only what its function needs.
 *
 * `options` holds each member's {@link Options}, keyed by the member's name
 * and typed by its kind. A Callable member's are Firebase's `CallableOptions`,
 * passed to its `onCall` unchanged. The group has no options of its own: set
 * those once with `setGlobalOptions`.
 *
 * Each export is what the member's kind deploys, and fails as one from
 * {@link make} does.
 *
 * @example Exporting a Function Group
 * ```ts
 * import { Effect, Layer, Schema } from "effect";
 * import { Callable, FunctionGroup } from "@visiolab/effect-firebase/functions";
 * import { Functions } from "@visiolab/effect-firebase-functions";
 *
 * const CreateUser = Callable.make("create", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 * const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });
 *
 * class Users extends FunctionGroup.make("users").add(CreateUser, DeleteUser) {}
 *
 * const UsersLive = Layer.mergeAll(
 *   Callable.toLayer(Users, "create", ({ name }) => Effect.succeed(name)),
 *   Callable.toLayer(Users, "delete", () => Effect.void),
 * );
 *
 * // Deploys `users-create` and `users-delete`.
 * export const { users } = Functions.group(Users, UsersLive, {
 *   delete: { region: "europe-west1" },
 * });
 * ```
 *
 * @see {@link make} for deploying a Function in no group
 * @see {@link FunctionGroup.make} for declaring the group
 * @see {@link CallableClient.make} for calling the group's Callables from the client
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const group = <G extends FunctionGroup.Any, E>(
  group: G,
  live: Layer.Layer<GroupServices<G>, E>,
  options?: GroupOptions<G>,
): GroupExports<G> => {
  const exports: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(group.functions)) {
    exports[name] = kinds.deploy(
      group,
      fn,
      live,
      (options as Record<string, object | undefined> | undefined)?.[name],
    );
  }
  return { [group.identifier]: exports } as GroupExports<G>;
};
