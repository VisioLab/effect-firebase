/**
 * The call a Callable is answering: who made it, from which app, the raw
 * Payload as it arrived and the HTTP request it came in.
 *
 * Every call runs with a {@link CallableRequest} in scope. Callable Middleware
 * reads it to decide whether the call may go on, and a handler may read it
 * too. It is portable: `Functions` from
 * `@visiolab/effect-firebase-functions` provides it from Firebase's request,
 * and `Callable.handler` provides it from a {@link Input} of your own.
 *
 * @example Rate limiting by the caller's address
 * ```ts
 * import { Effect, Layer, Option } from "effect";
 * import { CallableError, CallableMiddleware, CallableRequest } from "@visiolab/effect-firebase/functions";
 *
 * class RateLimit extends CallableMiddleware.Service<RateLimit>()("RateLimit", {
 *   error: CallableError.ResourceExhausted,
 * }) {}
 *
 * const RateLimitLive = Layer.sync(RateLimit, () => {
 *   const calls = new Map<string, number>();
 *   return (effect) =>
 *     Effect.gen(function* () {
 *       const { rawRequest } = yield* CallableRequest.CallableRequest;
 *       const address = Option.getOrElse(rawRequest.remoteAddress, () => "unknown");
 *       const count = (calls.get(address) ?? 0) + 1;
 *       calls.set(address, count);
 *       if (count > 100) return yield* new CallableError.ResourceExhausted();
 *       return yield* effect;
 *     });
 * });
 * ```
 *
 * @stability unstable
 * @since 0.3.0
 */
import type { Context } from "effect";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as internal from "./internal/callableRequest.ts";

/**
 * Who made a call: the signed-in user's uid, the claims of their ID token and
 * the raw ID token.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Auth {
  /** The signed-in user's uid. */
  readonly uid: string;
  /** The decoded claims of the user's ID token. */
  readonly token: Readonly<Record<string, unknown>>;
  /** The ID token as the client sent it. */
  readonly rawToken: string;
}

/**
 * The app a call came from, as App Check attested it.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface App {
  /** The app ID of the attested Firebase app. */
  readonly appId: string;
  /** The decoded claims of the App Check token. */
  readonly token: Readonly<Record<string, unknown>>;
  /** Whether the App Check token was already used, when replay protection is on. */
  readonly alreadyConsumed?: boolean | undefined;
}

/**
 * The call a Callable is answering.
 *
 * **Details**
 *
 * `data` is the raw Payload, the `Schema.toCodecJson` output the client sent.
 * Callable Middleware runs before the Payload is decoded, so it sees only
 * `data`.
 *
 * `rawRequest` is the HTTP request the call came in, as Effect's
 * `HttpServerRequest`. `Functions` builds it from Firebase's request,
 * streaming its body without copying the bytes, and `Callable.handler` takes
 * it from {@link Input.rawRequest}.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface CallableRequest {
  /** The signed-in caller, absent for a signed-out call. */
  readonly auth?: Auth | undefined;
  /** The app the call came from, absent without App Check. */
  readonly app?: App | undefined;
  /** An unverified Firebase Instance ID token, if the client sent one. */
  readonly instanceIdToken?: string | undefined;
  /** The raw Payload, before it is decoded. */
  readonly data: unknown;
  /**
   * The HTTP request the call came in: its headers, method, URL, body and the
   * caller's `remoteAddress`.
   *
   * **Details**
   *
   * The Firebase web SDK's `httpsCallable` can't send custom headers, so a
   * header of your own comes only from callers that don't use it, such as
   * another server. Headers the browser or the SDK sets, such as `user-agent`
   * and `accept-language`, are there for every caller.
   *
   * `remoteAddress` is the caller's IP address as the platform reports it,
   * `Option.none()` when it is unknown.
   */
  readonly rawRequest: HttpServerRequest.HttpServerRequest;
}

/**
 * The service key of the {@link CallableRequest}.
 *
 * **Details**
 *
 * Every call provides it, so Callable Middleware may read it without listing
 * it in `requires`.
 *
 * @stability unstable
 * @category services
 * @since 0.3.0
 */
export const CallableRequest: Context.Service<CallableRequest, CallableRequest> =
  internal.CallableRequest;

/**
 * What `Callable.handler` takes about a call: who makes it, from which app and
 * over which HTTP request. `Callable.handler` fills `data` by encoding the
 * Payload.
 *
 * **Details**
 *
 * Pass `{}` for a signed-out call and `{ auth: { uid, token } }` for a
 * signed-in one. `rawToken` defaults to an empty string, since a call made in
 * process has no real ID token.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Input {
  /** The signed-in caller, absent for a signed-out call. */
  readonly auth?:
    | {
        readonly uid: string;
        readonly token: Readonly<Record<string, unknown>>;
        readonly rawToken?: string | undefined;
      }
    | undefined;
  /** The app the call came from. */
  readonly app?: App | undefined;
  /** A Firebase Instance ID token. */
  readonly instanceIdToken?: string | undefined;
  /**
   * The HTTP request the call comes in, for middleware that reads headers or
   * the caller's address.
   *
   * **Details**
   *
   * Left out, it is a `POST` of the encoded Payload as JSON to
   * `http://localhost/<deployed name>`, with `content-type:
   * application/json`, no other headers and no `remoteAddress`. Build one with
   * `HttpServerRequest.fromWeb` from `effect/http/HttpServerRequest`, and set
   * `remoteAddress` with its `modify`.
   *
   * @example Calling with a request of your own
   * ```ts
   * import { Effect, Layer, Option } from "effect";
   * import * as HttpServerRequest from "effect/http/HttpServerRequest";
   * import { Callable, CallableMiddleware, CallableRequest } from "@visiolab/effect-firebase/functions";
   *
   * class LogLocale extends CallableMiddleware.Service<LogLocale>()("LogLocale") {}
   *
   * const Ping = Callable.make("ping").middleware(LogLocale);
   *
   * const program = Effect.gen(function* () {
   *   const ping = yield* Callable.handler(Ping);
   *   const rawRequest = HttpServerRequest.fromWeb(
   *     new Request("https://example.com/ping", {
   *       method: "POST",
   *       headers: { "accept-language": "de-CH" },
   *     }),
   *   ).modify({ remoteAddress: Option.some("203.0.113.7") });
   *   yield* ping(undefined, { rawRequest });
   * }).pipe(
   *   Effect.provide(
   *     Layer.mergeAll(
   *       Callable.toLayer(Ping, () => Effect.void),
   *       Layer.succeed(LogLocale, (effect) =>
   *         Effect.flatMap(Effect.service(CallableRequest.CallableRequest), ({ rawRequest }) =>
   *           Effect.andThen(Effect.logInfo("Locale", rawRequest.headers["accept-language"]), effect),
   *         ),
   *       ),
   *     ),
   *   ),
   * );
   * ```
   */
  readonly rawRequest?: HttpServerRequest.HttpServerRequest | undefined;
}
