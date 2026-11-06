/**
 * Callables: server functions declared once and shared by server and client.
 *
 * @stability unstable
 * @since 0.3.0
 */
export * as Callable from "./Callable.ts";
/**
 * The error a Callable Client fails with when a call goes wrong in a way the
 * contract doesn't declare.
 *
 * @stability unstable
 * @since 0.3.0
 */
export * as CallableError from "./CallableError.ts";
/**
 * Callable Groups: named sets of Callables that deploy under the group's name
 * as a prefix.
 *
 * @stability unstable
 * @since 0.3.0
 */
export * as CallableGroup from "./CallableGroup.ts";
