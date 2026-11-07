/**
 * Functions: what every kind of server function shares, whatever runs it.
 *
 * A Function is declared once by its name and what runs it. A
 * {@link Callable.Callable} is one kind of Function, run by a call from the
 * client. Each kind has a module of its own, which owns its declaration, its
 * handler and how it serves. This module holds only what they share: the
 * kind, the name, and the {@link Handler} key a handler is provided under.
 *
 * Functions are deployed with `Functions.make` for a Function in no group,
 * and `Functions.group` for the members of a
 * {@link FunctionGroup.FunctionGroup}, from `@visiolab/effect-firebase-functions`.
 *
 * @stability unstable
 * @since 0.3.0
 */
import type * as internal from "./internal/firebaseFunction.ts";

/**
 * A Function: a server function's kind and its name.
 *
 * **Details**
 *
 * The name is the Function's identity. A Function in no group is deployed
 * under its name, and a member of a group under `<group>-<name>`. It is a
 * literal type that exports and group members are keyed on.
 *
 * The kind says what runs the Function, such as `"Callable"`, and decides how
 * it is served and deployed.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface FirebaseFunction<out Kind extends string, out Name extends string> {
  /** What runs the Function, such as `"Callable"`. */
  readonly kind: Kind;
  /** The Function's name, which a Function in no group is deployed under. */
  readonly name: Name;
}

/**
 * Any {@link FirebaseFunction}, whatever its kind and name.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Any extends FirebaseFunction<string, string> {}

/**
 * Marks the {@link Handler} of a Function in no group.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface NoGroup {
  readonly [internal.NoGroupTypeId]: typeof internal.NoGroupTypeId;
}

/**
 * The service that holds the handler of the Function `Name`, as served in
 * `Group`, whatever its kind.
 *
 * **Details**
 *
 * A handler is keyed by its group and its name, so the handler of `greet` in
 * no group is `Handler<NoGroup, "greet">`, and that of `create` in the group
 * `users` is `Handler<"users", "create">`. A Layer that serves a Function must
 * provide its handler under exactly that key. Each kind's `toLayer`, such as
 * {@link Callable.toLayer}, builds such a Layer.
 *
 * @see {@link HandlerFor} for the handler of a Function in no group
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
 * The {@link Handler} of a Function in no group.
 *
 * @see {@link Handler} for the handler of a member of a group
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type HandlerFor<F extends Any> = Handler<NoGroup, F["name"]>;
