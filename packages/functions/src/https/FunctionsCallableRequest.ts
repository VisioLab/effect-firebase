/**
 * The call a Callable Function is answering, as `firebase-functions` hands it
 * over: the portable `CallableRequest` and the rest of Firebase's request.
 *
 * `CallableFunction` provides it on every call, under its own key and under
 * the portable `CallableRequest`'s. Portable middleware reads the portable
 * one. Read this one only for what Firebase alone has, such as the raw HTTP
 * request.
 *
 * @example Reading a header in a middleware
 * ```ts
 * import { Effect, Layer } from "effect";
 * import { CallableMiddleware } from "@visiolab/effect-firebase/functions";
 * import { FunctionsCallableRequest } from "@visiolab/effect-firebase-functions/https";
 *
 * class LogUserAgent extends CallableMiddleware.Service<
 *   LogUserAgent,
 *   { requires: FunctionsCallableRequest.FunctionsCallableRequest }
 * >()("LogUserAgent") {}
 *
 * const LogUserAgentLive = Layer.succeed(LogUserAgent, (effect) =>
 *   Effect.gen(function* () {
 *     const { rawRequest } = yield* Effect.service(FunctionsCallableRequest.FunctionsCallableRequest);
 *     yield* Effect.logInfo("Called by", rawRequest.headers["user-agent"]);
 *     return yield* effect;
 *   }),
 * );
 * ```
 *
 * @stability unstable
 * @since 0.1.0
 */
import { Context } from "effect";
import * as CallableRequest from "@visiolab/effect-firebase/functions/CallableRequest";
import type * as Https from "firebase-functions/v2/https";

const TypeId = "~@visiolab/effect-firebase-functions/https/FunctionsCallableRequest";

/**
 * The call a Callable Function is answering: the portable request's fields,
 * plus Firebase's raw HTTP request and whether the client accepts a stream.
 *
 * **Details**
 *
 * It extends the portable `CallableRequest.Base`, not `CallableRequest`
 * itself, so providing a portable request alone doesn't satisfy a requirement
 * on this one (ADR-0001). The object `CallableFunction` provides is both.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface FunctionsCallableRequest extends CallableRequest.Base {
  readonly [TypeId]: typeof TypeId;
  /** The HTTP request the call arrived in. */
  readonly rawRequest: Https.Request;
  /** Whether the client asked for a streamed answer. */
  readonly acceptsStreaming: boolean;
}

/**
 * The service key of the {@link FunctionsCallableRequest}.
 *
 * **Details**
 *
 * Every call of a Callable Function provides it, but Callable Middleware that
 * reads it must list it in `requires`, since `Callable.handler` doesn't
 * provide it. Portable middleware reads `CallableRequest.CallableRequest`
 * instead.
 *
 * @stability unstable
 * @category services
 * @since 0.1.0
 */
export const FunctionsCallableRequest: Context.Service<
  FunctionsCallableRequest,
  FunctionsCallableRequest & CallableRequest.CallableRequest
> = Context.Service<
  FunctionsCallableRequest,
  FunctionsCallableRequest & CallableRequest.CallableRequest
>("@visiolab/effect-firebase-functions/https/FunctionsCallableRequest");

/**
 * Makes the request service of a call from what `firebase-functions` hands
 * over.
 *
 * **When to use**
 *
 * Use when calling `Callable.serve` from an `onCall` of your own.
 * `CallableFunction` does this on every call.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const make = (
  request: Https.CallableRequest,
): FunctionsCallableRequest & CallableRequest.CallableRequest =>
  CallableRequest.make({
    [TypeId]: TypeId,
    auth: request.auth,
    app: request.app,
    instanceIdToken: request.instanceIdToken,
    data: request.data,
    rawRequest: request.rawRequest,
    acceptsStreaming: request.acceptsStreaming,
  });

/**
 * The context of a call: the request under its own key and under the portable
 * `CallableRequest`'s.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const context = (
  request: FunctionsCallableRequest & CallableRequest.CallableRequest,
): Context.Context<FunctionsCallableRequest | CallableRequest.CallableRequest> =>
  Context.make(FunctionsCallableRequest, request).pipe(
    Context.add(CallableRequest.CallableRequest, request),
  );
