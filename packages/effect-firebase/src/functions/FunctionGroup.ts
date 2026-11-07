/**
 * Function Groups: named sets of Functions of any kind that deploy under the
 * group's name as a prefix.
 *
 * A member `create` of the group `users` deploys as `users-create`, whatever
 * its kind. The server implements a member with its kind's `toLayer`, such as
 * `Callable.toLayer(Users, "create", handler)`, and deploys the whole group
 * with `Functions.group` from `@visiolab/effect-firebase-functions`. The
 * client calls the group's Callables through `CallableClient.make(Users)`
 * from `@visiolab/effect-firebase-client`.
 *
 * @example Declaring a group
 * ```ts
 * import { Schema } from "effect";
 * import { Callable, FunctionGroup } from "@visiolab/effect-firebase/functions";
 *
 * const CreateUser = Callable.make("create", {
 *   payload: { name: Schema.String },
 *   success: Schema.String,
 * });
 * const DeleteUser = Callable.make("delete", { payload: { id: Schema.String } });
 *
 * class Users extends FunctionGroup.make("users").add(CreateUser, DeleteUser) {}
 * ```
 *
 * @stability unstable
 * @since 0.3.0
 */
import type { Pipeable } from "effect";
import type * as FirebaseFunction from "./FirebaseFunction.ts";
import * as internal from "./internal/functionGroup.ts";

const TypeId = internal.TypeId;

/**
 * A Function Group: a name and the Functions it deploys under that name.
 *
 * **Details**
 *
 * A group is a class, so `class Users extends FunctionGroup.make("users")`
 * gives it a name of its own in types and in hovers. Its name is
 * `identifier`, since a class already has a `name` of its own.
 *
 * A group holds Functions of any kind, so a group can follow a domain, such
 * as `posts`, rather than a kind. A Function's name is unique within its
 * group. `.add` checks this when the module loads; the types don't. A
 * Function can be in more than one group, and each group serves and
 * implements it separately. Groups don't nest.
 *
 * A group is only a name and its members. It carries no middleware: attach a
 * Callable Middleware to each Callable that needs it with
 * {@link Callable.Callable.middleware}.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface FunctionGroup<
  out Identifier extends string,
  in out Functions extends FirebaseFunction.Any = never,
>
  extends Pipeable.Pipeable {
  new (_: never): {};
  readonly [TypeId]: typeof TypeId;
  /** The group's name: the prefix its members deploy under. */
  readonly identifier: Identifier;
  /** The group's members, keyed by their names. */
  readonly functions: { readonly [F in Functions as F["name"]]: F };

  /**
   * Adds Functions of any kind to the group.
   *
   * **Details**
   *
   * Returns a new group. Throws when a Function's name is already taken in
   * the group, so a clash fails when the module loads, before anything
   * deploys. The types don't catch a clash.
   */
  add<const A extends ReadonlyArray<FirebaseFunction.Any>>(
    ...functions: A
  ): FunctionGroup<Identifier, Functions | A[number]>;
}

/**
 * Any {@link FunctionGroup}, whatever its name and members.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Any {
  readonly [TypeId]: typeof TypeId;
  readonly identifier: string;
  readonly functions: { readonly [name: string]: FirebaseFunction.Any };
}

/**
 * The members of a {@link FunctionGroup}, as a union of Functions.
 *
 * **When to use**
 *
 * Use to read every member of a group. Pass the `Any` of a kind as `K`, such
 * as `Members<typeof Users, Callable.Any>`, to keep only the members of that
 * kind.
 *
 * @see {@link Names} for the names of the members
 * @see {@link Member} for the member of one name
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Members<G, K extends FirebaseFunction.Any = FirebaseFunction.Any> = G extends {
  readonly functions: infer Record;
}
  ? Extract<Record[keyof Record], K>
  : never;

/**
 * The names of the members of a {@link FunctionGroup}.
 *
 * **When to use**
 *
 * Use to key something on a group's members. Pass the `Any` of a kind as `K`
 * to keep only the names of the members of that kind.
 *
 * @see {@link Members} for the members themselves
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Names<G, K extends FirebaseFunction.Any = FirebaseFunction.Any> = Members<G, K>["name"];

/**
 * The member of a {@link FunctionGroup} named `Name`.
 *
 * **When to use**
 *
 * Use to read one member's type by its name. Pass the `Any` of a kind as `K`
 * to get `never` unless the member is of that kind.
 *
 * @see {@link Members} for every member
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Member<
  G,
  Name extends string,
  K extends FirebaseFunction.Any = FirebaseFunction.Any,
> = Extract<Members<G, K>, { readonly name: Name }>;

/**
 * The {@link FirebaseFunction.Handler}s that serving a {@link FunctionGroup}
 * needs: one per member, keyed by the group.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Handlers<G extends Any> =
  Names<G> extends infer Name
    ? Name extends string
      ? FirebaseFunction.Handler<G["identifier"], Name>
      : never
    : never;

/**
 * Checks whether a value is a {@link FunctionGroup}. A building block for the
 * functions and client packages, which take a Function or a group. Most apps
 * don't need it.
 *
 * @stability unstable
 * @category guards
 * @since 0.3.0
 */
export const isFunctionGroup: (u: unknown) => u is Any = internal.isFunctionGroup as never;

/**
 * Starts a Function Group with no members.
 *
 * **When to use**
 *
 * Use to collect related Functions, of any kind, under one prefix, and to
 * deploy them as one. A Function that stands alone needs no group.
 *
 * **Details**
 *
 * Add members with `.add`. Extend the result as a class, so the group has a
 * name of its own. Each member deploys as `<identifier>-<name>`.
 *
 * A client built from a Callable on its own, rather than from its group,
 * calls the name without the prefix and fails with `not-found`. Nothing
 * checks this at runtime.
 *
 * @example Serving one Callable in two groups
 * ```ts
 * import { Schema } from "effect";
 * import { Callable, FunctionGroup } from "@visiolab/effect-firebase/functions";
 *
 * const GetUser = Callable.make("get", {
 *   payload: { id: Schema.String },
 *   success: Schema.String,
 * });
 *
 * // Deploys as `users-get` and `admins-get`, each with a handler of its own.
 * class Users extends FunctionGroup.make("users").add(GetUser) {}
 * class Admins extends FunctionGroup.make("admins").add(GetUser) {}
 * ```
 *
 * @see {@link Callable.make} for declaring a Callable member
 * @see {@link Callable.toLayer} for implementing a Callable member
 * @see {@link DocumentTrigger.created} for declaring a Document Trigger member
 * @see {@link DocumentTrigger.toLayer} for implementing a Document Trigger member
 * @see {@link Functions.group} for deploying the group
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const make = <const Identifier extends string>(
  identifier: Identifier,
): FunctionGroup<Identifier> => internal.make({ identifier, functions: {} }) as never;
