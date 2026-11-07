/**
 * The call a Callable is answering: who made it, from which app, and the raw
 * Payload as it arrived.
 *
 * Every call runs with a {@link CallableRequest} in scope. Callable Middleware
 * reads it to decide whether the call may go on, and a handler may read it
 * too. It is portable: `CallableFunction` from
 * `@visiolab/effect-firebase-functions` provides it from Firebase's request,
 * and `Callable.handler` provides it from a {@link Input} of your own.
 *
 * @example Reading the request in a middleware
 * ```ts
 * import { Effect, Layer } from "effect";
 * import { CallableMiddleware, CallableRequest } from "@visiolab/effect-firebase/functions";
 *
 * class LogApp extends CallableMiddleware.Service<LogApp>()("LogApp") {}
 *
 * const LogAppLive = Layer.succeed(LogApp, (effect) =>
 *   Effect.gen(function* () {
 *     const { app } = yield* CallableRequest.CallableRequest;
 *     yield* Effect.logInfo("Called from", app?.appId ?? "an unknown app");
 *     return yield* effect;
 *   }),
 * );
 * ```
 *
 * @stability unstable
 * @since 0.3.0
 */
import type { Context } from "effect";
import * as internal from "./internal/callableRequest.ts";

const TypeId = internal.TypeId;

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
 * The fields of a {@link CallableRequest}, without its brand. A building block
 * for the functions package's request service. Most apps don't need it.
 *
 * **Details**
 *
 * An SDK's request service extends this rather than {@link CallableRequest},
 * so that providing the portable service alone doesn't satisfy a requirement
 * on the SDK's.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Base {
  /** The signed-in caller, absent for a signed-out call. */
  readonly auth?: Auth | undefined;
  /** The app the call came from, absent without App Check. */
  readonly app?: App | undefined;
  /** An unverified Firebase Instance ID token, if the client sent one. */
  readonly instanceIdToken?: string | undefined;
  /** The raw Payload, before it is decoded. */
  readonly data: unknown;
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
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface CallableRequest extends Base {
  readonly [TypeId]: typeof TypeId;
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
 * What `Callable.handler` takes about a call: who makes it and from which app.
 * `Callable.handler` fills `data` by encoding the Payload.
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
}

/**
 * Makes a {@link CallableRequest} from its fields. A building block for the
 * functions package. Most apps don't need it.
 *
 * **When to use**
 *
 * Use when serving Callables from a transport of your own, to build the
 * request that `Callable.serve` takes. `CallableFunction` and
 * `Callable.handler` build it for you.
 *
 * **Details**
 *
 * Keeps every field it is given, so an SDK's request service can pass its own
 * fields along and get back an object that is both.
 *
 * @see {@link Input} for what `Callable.handler` takes instead
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const make: <A extends Base>(fields: A) => A & CallableRequest = internal.make;
