/**
 * The Callable kind's runtime: serves one Callable as an `onCall` export.
 *
 * @internal
 */
import { Cause, Effect, Exit, type Layer, Option } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import type * as CallableRequest from "@visiolab/effect-firebase/functions/CallableRequest";
import type * as FunctionGroup from "@visiolab/effect-firebase/functions/FunctionGroup";
import * as Https from "firebase-functions/v2/https";
import * as Runtime from "./runtime.ts";

const internalError = () => new Https.HttpsError("internal", "INTERNAL");

/**
 * Firebase's Express request as Effect's `HttpServerRequest`: the same method,
 * URL, headers and body, with the caller's address as `remoteAddress`. The
 * body streams Firebase's bytes rather than copying them, as a `Buffer` body
 * would.
 */
const toHttpServerRequest = (raw: Https.Request): HttpServerRequest.HttpServerRequest => {
  const headers: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(raw.headers)) {
    if (value === undefined) continue;
    headers.push([name, Array.isArray(value) ? value.join(", ") : value]);
  }
  const method = raw.method.toUpperCase();
  const bytes = raw.rawBody;
  const init: RequestInit =
    // A GET or HEAD request can't have a body. Callables are POSTs.
    method === "GET" || method === "HEAD"
      ? { method, headers }
      : {
          method,
          headers,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          // Required of a stream body.
          duplex: "half",
        };
  return HttpServerRequest.fromWeb(
    new Request(`${raw.protocol}://${raw.get("host") ?? "localhost"}${raw.originalUrl}`, init),
  ).modify({ remoteAddress: Option.fromNullishOr(raw.ip) });
};

/**
 * The portable `CallableRequest` of a call, from what `firebase-functions`
 * hands over.
 */
const toCallableRequest = (request: Https.CallableRequest): CallableRequest.CallableRequest => ({
  auth: request.auth,
  app: request.app,
  instanceIdToken: request.instanceIdToken,
  data: request.data,
  rawRequest: toHttpServerRequest(request.rawRequest),
});

/**
 * The answer `Callable.serve` already chose for a failed call, if `cause`
 * carries one.
 */
const answerOf = <E>(cause: Cause.Cause<E>): CallableError.ResponseError | undefined => {
  const failure = cause.reasons.find(Cause.isFailReason)?.error;
  return failure instanceof CallableError.CallableError && failure.reason._tag === "ResponseError"
    ? failure.reason
    : undefined;
};

/**
 * Logs the Cause of a call that failed unexpectedly: a defect, or a failure
 * that isn't an answer. Answers and interrupts aren't logged.
 */
const logUnexpected =
  (message: string) =>
  <E>(cause: Cause.Cause<E>) =>
    answerOf(cause) !== undefined || Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : Effect.logError(message, cause);

/**
 * The `HttpsError` a failed call answers with. A failure is already the
 * answer `Callable.serve` chose. An interrupt is `cancelled` when the client
 * went away and `unavailable` otherwise. Anything else, logged in the call's
 * span by {@link logUnexpected}, is a bare `internal`.
 */
const toHttpsError = (cause: Cause.Cause<unknown>, aborted: boolean) => {
  const answer = answerOf(cause);
  if (answer !== undefined)
    return new Https.HttpsError(answer.code, answer.message, answer.details);
  if (Cause.hasInterruptsOnly(cause)) {
    return aborted
      ? new Https.HttpsError("cancelled", "CANCELLED")
      : new Https.HttpsError("unavailable", "UNAVAILABLE");
  }
  return internalError();
};

/**
 * `Callable.serve` of one Callable, with its requirements erased, since the
 * public signatures check that `live` meets them.
 */
type Serve = Effect.Effect<
  (request: CallableRequest.CallableRequest) => Effect.Effect<unknown, CallableError.CallableError>,
  never,
  unknown
>;

/**
 * What `onCall` returns for a Callable.
 *
 * @internal
 */
export type Export = Https.CallableFunction<unknown, Promise<unknown>>;

/**
 * The Callable Function of `callable` in `group`, or in no group: an `onCall`
 * export that runs `Callable.serve` under the deployed name and span
 * attributes of `Callable.deployment`. It builds `live` on its own first call.
 *
 * @internal
 */
export const deploy = <R, E>(
  group: FunctionGroup.Any | undefined,
  callable: Callable.Any,
  live: Layer.Layer<R, E>,
  options: Https.CallableOptions = {},
): Export => {
  const deployment =
    group === undefined
      ? Callable.deployment(callable)
      : Callable.deployment(group, callable.name as never);
  const serve: Serve =
    group === undefined ? Callable.serve(callable) : Callable.serve(group, callable.name as never);
  const run = Runtime.make(live, {
    span: `CallableFunction.${deployment.name}`,
    attributes: deployment.attributes,
    onBuildFailure: logUnexpected("The Layer of a Callable failed to build"),
  });
  return Https.onCall<unknown, Promise<unknown>>(options, async (request, response) => {
    const signal = response?.signal;
    const callRequest = toCallableRequest(request);
    const exit = await run(
      serve.pipe(
        Effect.flatMap((run) => run(callRequest)),
        // Logged with the services of `live`, so a logger it provides is used.
        Effect.onError(logUnexpected("A Callable failed")),
      ),
      signal,
    );
    if (Exit.isSuccess(exit)) return exit.value;
    throw toHttpsError(exit.cause, signal?.aborted === true);
  });
};
