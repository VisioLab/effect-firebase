/**
 * Callable Groups: named sets of Callables that deploy under the group's name
 * as a prefix, and that are served, implemented and called as one.
 *
 * A member `create` of the group `users` deploys as `users-create`. The server
 * implements it with `Callable.toLayer(Users, "create", handler)` and serves
 * the whole group with `CallableFunction.group` from
 * `@visiolab/effect-firebase-functions`. The client calls it through
 * `CallableClient.make(Users)` from `@visiolab/effect-firebase-client`.
 *
 * @example Declaring a group
 * ```ts
 * import { Schema } from "effect";
 * import { Callable, CallableGroup } from "@visiolab/effect-firebase/functions";
 *
 * const CreateUser = Callable.make("create", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 * const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });
 *
 * class Users extends CallableGroup.make("users").add(CreateUser, DeleteUser) {}
 * ```
 *
 * @stability unstable
 * @since 0.3.0
 */
import type { Context, Pipeable } from "effect";
import type * as Callable from "./Callable.ts";
import type * as CallableMiddleware from "./CallableMiddleware.ts";
import * as internal from "./internal/callableGroup.ts";
import type * as internalMiddleware from "./internal/callableMiddleware.ts";

const TypeId = internal.TypeId;

/**
 * A Callable Group: a name and the Callables it serves under that name.
 *
 * **Details**
 *
 * A group is a class, so `class Users extends CallableGroup.make("users")` gives
 * it a name of its own in types and in hovers. Its name is `identifier`, since
 * a class already has a `name` of its own.
 *
 * A Callable's name is unique within its group. `.add` checks this when the
 * module loads; the types don't. A Callable can be in more than one group,
 * and each group serves and implements it separately. Groups don't nest.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface CallableGroup<
  out Identifier extends string,
  in out Callables extends Callable.Any = never,
  out Middleware = never,
  out MiddlewareServices = never,
>
  extends Pipeable.Pipeable {
  new (_: never): {};
  readonly [TypeId]: typeof TypeId;
  /** The group's name: the prefix its members deploy under. */
  readonly identifier: Identifier;
  /** The group's members, keyed by their names. */
  readonly callables: { readonly [C in Callables as C["name"]]: C };
  /** The group's own middleware, in the order it was attached. */
  readonly middlewares: ReadonlySet<CallableMiddleware.AnyKey>;
  /** The middleware attached to the group, as a union. Types only. */
  readonly "~Middleware": Middleware;
  /** What the group's middleware chain still requires. Types only. */
  readonly "~MiddlewareServices": MiddlewareServices;

  /**
   * Adds Callables to the group.
   *
   * **Details**
   *
   * Returns a new group that keeps the group's middleware. Throws when a
   * Callable's name is already taken in the group, so a clash fails when the
   * module loads, before anything deploys. The types don't catch a clash.
   */
  add<const A extends ReadonlyArray<Callable.Any>>(
    ...callables: A
  ): CallableGroup<Identifier, Callables | A[number], Middleware, MiddlewareServices>;

  /**
   * Attaches a Callable Middleware to every member of the group.
   *
   * **Details**
   *
   * Returns a new group. The middleware is stored on the group, not copied
   * onto its members, so it also covers members added after it. The same
   * Callable in another group, or on its own, is served without it.
   *
   * Group middleware runs outside each member's own middleware, so a
   * member's middleware may require what the group's provides. A group
   * middleware attached later wraps the ones attached before it.
   *
   * Its `provides` are removed from what each member's handler Layer
   * requires, and its errors join each member's error union, on the server
   * and in the client. Its implementation is required where the chain runs:
   * by `CallableFunction.group` and by {@link Callable.handler}.
   *
   * Middleware isn't deduplicated: the same middleware on the group and on a
   * member runs twice for that member.
   *
   * @see {@link CallableMiddleware.Service} for declaring a middleware
   * @see {@link Callable.Callable.middleware} for attaching one to a single Callable
   */
  middleware<I extends CallableMiddleware.AnyId, S>(
    middleware: Context.Key<I, S>,
  ): CallableGroup<
    Identifier,
    Callables,
    Middleware | I,
    CallableMiddleware.ApplyServices<I, MiddlewareServices>
  >;
}

/**
 * Any {@link CallableGroup}, whatever its name and members.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Any {
  readonly [TypeId]: typeof TypeId;
  readonly identifier: string;
  readonly callables: { readonly [name: string]: Callable.Any };
  readonly middlewares: ReadonlySet<CallableMiddleware.AnyKey>;
}

/**
 * The members of a {@link CallableGroup}, as a union of Callables.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Callables<G> = G extends { readonly callables: infer Record }
  ? Record[keyof Record]
  : never;

/**
 * The names of the members of a {@link CallableGroup}.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Names<G> = Callables<G>["name"];

/**
 * The middleware attached to a {@link CallableGroup}, as a union of the
 * middleware service types.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Middleware<G> = internalMiddleware.Attached<G>;

/**
 * What the middleware of a {@link CallableGroup} still requires: the
 * `requires` of each group middleware that no group middleware outside it
 * provides.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type MiddlewareServices<G> = internalMiddleware.AttachedServices<G>;

/**
 * The member of a {@link CallableGroup} named `Name`, as the group serves it:
 * with the group's middleware outside its own.
 *
 * **Details**
 *
 * The group's middleware joins the member's {@link Callable.Middleware}, and
 * its errors join {@link Callable.Error}. What the group's middleware
 * provides is removed from what the member's own middleware still requires,
 * and what the group's middleware requires is added.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Member<G, Name extends string> = WithMiddleware<
  Extract<Callables<G>, { readonly name: Name }>,
  Middleware<G>,
  MiddlewareServices<G>
>;

/** A Callable with a group's middleware wrapped around its own. */
type WithMiddleware<C, GroupMiddleware, GroupServices> =
  C extends Callable.Callable<
    infer Name,
    infer Payload,
    infer Success,
    infer Error,
    infer Middleware,
    infer Services
  >
    ? Callable.Callable<
        Name,
        Payload,
        Success,
        Error,
        Middleware | GroupMiddleware,
        Exclude<Services, CallableMiddleware.Provides<GroupMiddleware>> | GroupServices
      >
    : never;

/**
 * The {@link Callable.Handler}s that serving a {@link CallableGroup} needs: one
 * per member, keyed by the group.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Handlers<G extends Any> =
  Names<G> extends infer Name
    ? Name extends string
      ? Callable.Handler<G["identifier"], Name>
      : never
    : never;

/**
 * What serving every member of a {@link CallableGroup} requires: each
 * member's {@link Callable.Handler}, its middleware implementations and what
 * its middleware chain still requires.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type ChainServices<G extends Any> =
  Names<G> extends infer Name
    ? Name extends string
      ? Callable.ChainServices<Member<G, Name>, Callable.Handler<G["identifier"], Name>>
      : never
    : never;

/**
 * Checks whether a value is a {@link CallableGroup}. A building block for the
 * functions and client packages, which take a Callable or a group. Most apps
 * don't need it.
 *
 * @stability unstable
 * @category guards
 * @since 0.3.0
 */
export const isCallableGroup: (u: unknown) => u is Any = internal.isCallableGroup as never;

/**
 * Starts a Callable Group with no members.
 *
 * **When to use**
 *
 * Use to collect related Callables under one prefix, and to serve, implement
 * and call them as one. A Callable that stands alone needs no group.
 *
 * **Details**
 *
 * Add members with `.add`. Extend the result as a class, so the group has a
 * name of its own. Each member deploys as `<identifier>-<name>`.
 *
 * A client built from a member on its own, rather than from its group, calls
 * the name without the prefix and fails with `not-found`. Nothing checks this
 * at runtime.
 *
 * @example Serving one Callable in two groups
 * ```ts
 * import { Schema } from "effect";
 * import { Callable, CallableGroup } from "@visiolab/effect-firebase/functions";
 *
 * const GetUser = Callable.make("get", {
 *   payload: { id: Schema.String },
 *   success: Schema.String,
 * });
 *
 * // Deploys as `users-get` and `admins-get`, each with a handler of its own.
 * class Users extends CallableGroup.make("users").add(GetUser) {}
 * class Admins extends CallableGroup.make("admins").add(GetUser) {}
 * ```
 *
 * @example Requiring sign-in for every member
 * ```ts
 * import { Effect, Layer, Schema } from "effect";
 * import { Callable, CallableGroup, Caller } from "@visiolab/effect-firebase/functions";
 *
 * const Me = Callable.make("me", { success: Schema.String });
 *
 * // Covers `me`, though it is added after the middleware.
 * class Accounts extends CallableGroup.make("accounts").middleware(Caller.Authenticated).add(Me) {}
 *
 * const program = Effect.gen(function* () {
 *   const me = yield* Callable.handler(Accounts, "me");
 *   // "ada"
 *   return yield* me(undefined, { auth: { uid: "ada", token: {} } });
 * }).pipe(
 *   Effect.provide(
 *     Layer.merge(
 *       Callable.toLayer(Accounts, "me", () =>
 *         Effect.map(Effect.service(Caller.Caller), ({ uid }) => uid),
 *       ),
 *       Caller.Authenticated.layer,
 *     ),
 *   ),
 * );
 * ```
 *
 * @see {@link Callable.make} for declaring the members
 * @see {@link Callable.toLayer} for implementing a member
 * @see {@link Callable.handler} for running a member behind the group's middleware
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const make = <const Identifier extends string>(
  identifier: Identifier,
): CallableGroup<Identifier> =>
  internal.make({ identifier, callables: {}, middlewares: new Set() }) as never;
