/**
 * Serves Callables as Callable Functions: real `onCall` exports that plain
 * `firebase deploy` deploys.
 *
 * @stability unstable
 * @since 0.1.0
 */
export * as CallableFunction from "./CallableFunction.ts";
/**
 * The call a Callable Function is answering, as `firebase-functions` hands it
 * over.
 *
 * @stability unstable
 * @since 0.1.0
 */
export * as FunctionsCallableRequest from "./FunctionsCallableRequest.ts";
