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
import type { Pipeable } from "effect";
import type * as Callable from "./Callable.ts";
import * as internal from "./internal/callableGroup.ts";

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
 * A group carries no middleware. Attach a Callable Middleware to each member
 * that needs it with {@link Callable.Callable.middleware}.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface CallableGroup<
  out Identifier extends string,
  in out Callables extends Callable.Any = never,
>
  extends Pipeable.Pipeable {
  new (_: never): {};
  readonly [TypeId]: typeof TypeId;
  /** The group's name: the prefix its members deploy under. */
  readonly identifier: Identifier;
  /** The group's members, keyed by their names. */
  readonly callables: { readonly [C in Callables as C["name"]]: C };

  /**
   * Adds Callables to the group.
   *
   * **Details**
   *
   * Returns a new group. Throws when a
   * Callable's name is already taken in the group, so a clash fails when the
   * module loads, before anything deploys. The types don't catch a clash.
   */
  add<const A extends ReadonlyArray<Callable.Any>>(
    ...callables: A
  ): CallableGroup<Identifier, Callables | A[number]>;
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
 * The member of a {@link CallableGroup} named `Name`.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Member<G, Name extends string> = Extract<Callables<G>, { readonly name: Name }>;

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
 * @see {@link Callable.make} for declaring the members
 * @see {@link Callable.toLayer} for implementing a member
 * @see {@link Callable.handler} for running a member in process
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const make = <const Identifier extends string>(
  identifier: Identifier,
): CallableGroup<Identifier> => internal.make({ identifier, callables: {} }) as never;
