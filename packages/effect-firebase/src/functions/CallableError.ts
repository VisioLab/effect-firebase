/**
 * Errors of Callables: Firebase's error codes, built-in errors that carry
 * them, and the error a Callable Client fails with when a call goes wrong in a
 * way the contract doesn't declare.
 *
 * @stability unstable
 * @since 0.3.0
 */
import { Schema } from "effect";

/**
 * Firebase's error codes, as `firebase-functions` and the client SDK name
 * them, without `ok`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.3.0
 */
export const ErrorCode = Schema.Literals([
  "cancelled",
  "unknown",
  "invalid-argument",
  "deadline-exceeded",
  "not-found",
  "already-exists",
  "permission-denied",
  "resource-exhausted",
  "failed-precondition",
  "aborted",
  "out-of-range",
  "unimplemented",
  "internal",
  "unavailable",
  "data-loss",
  "unauthenticated",
]);

/**
 * One of Firebase's error codes, such as `not-found`.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type ErrorCode = typeof ErrorCode.Type;

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      /**
       * The Firebase error code a Callable answers with when it fails with
       * this error. Set it with `Callable.errorCode` or in a `TaggedError`'s
       * annotations, and read it with `Callable.getErrorCode`.
       */
      readonly callableErrorCode?: ErrorCode | undefined;
    }
  }
}

/**
 * The resource the call asks for doesn't exist. Its code is `not-found`.
 *
 * @example Failing with a built-in error
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Callable, CallableError } from "@visiolab/effect-firebase/functions";
 *
 * const GetUser = Callable.make("getUser", {
 *   payload: { id: Schema.String },
 *   success: Schema.String,
 *   error: CallableError.NotFound,
 * });
 *
 * const GetUserLive = Callable.toLayer(GetUser, ({ id }) =>
 *   Effect.fail(new CallableError.NotFound({ message: `No user ${id}` })),
 * );
 * ```
 *
 * @stability unstable
 * @category built-in errors
 * @since 0.3.0
 */
export class NotFound extends Schema.TaggedError<NotFound, { readonly brand: unique symbol }>()(
  "NotFound",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "not-found" },
) {}

/**
 * The caller may not do what the call asks. Its code is `permission-denied`.
 *
 * @see {@link Unauthenticated} for a caller who isn't signed in
 *
 * @stability unstable
 * @category built-in errors
 * @since 0.3.0
 */
export class PermissionDenied extends Schema.TaggedError<
  PermissionDenied,
  { readonly brand: unique symbol }
>()(
  "PermissionDenied",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "permission-denied" },
) {}

/**
 * The caller isn't signed in. Its code is `unauthenticated`.
 *
 * @see {@link PermissionDenied} for a signed-in caller who may not do this
 *
 * @stability unstable
 * @category built-in errors
 * @since 0.3.0
 */
export class Unauthenticated extends Schema.TaggedError<
  Unauthenticated,
  { readonly brand: unique symbol }
>()(
  "Unauthenticated",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "unauthenticated" },
) {}

/**
 * The Payload is well-formed but its values are wrong. Its code is
 * `invalid-argument`.
 *
 * **Details**
 *
 * A Payload that doesn't decode is answered with `invalid-argument` already,
 * without this error. Use it for checks the Payload's schema can't express.
 *
 * @see {@link FailedPrecondition} for a valid Payload the current state rejects
 *
 * @stability unstable
 * @category built-in errors
 * @since 0.3.0
 */
export class InvalidArgument extends Schema.TaggedError<
  InvalidArgument,
  { readonly brand: unique symbol }
>()(
  "InvalidArgument",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "invalid-argument" },
) {}

/**
 * What the call would create exists already. Its code is `already-exists`.
 *
 * @stability unstable
 * @category built-in errors
 * @since 0.3.0
 */
export class AlreadyExists extends Schema.TaggedError<
  AlreadyExists,
  { readonly brand: unique symbol }
>()(
  "AlreadyExists",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "already-exists" },
) {}

/**
 * The system isn't in the state the call needs. Its code is
 * `failed-precondition`.
 *
 * @see {@link InvalidArgument} for a Payload that is wrong whatever the state
 *
 * @stability unstable
 * @category built-in errors
 * @since 0.3.0
 */
export class FailedPrecondition extends Schema.TaggedError<
  FailedPrecondition,
  { readonly brand: unique symbol }
>()(
  "FailedPrecondition",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "failed-precondition" },
) {}

/**
 * A quota or rate limit ran out. Its code is `resource-exhausted`.
 *
 * @stability unstable
 * @category built-in errors
 * @since 0.3.0
 */
export class ResourceExhausted extends Schema.TaggedError<
  ResourceExhausted,
  { readonly brand: unique symbol }
>()(
  "ResourceExhausted",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "resource-exhausted" },
) {}

/**
 * The service can't answer right now, and the call may succeed if retried.
 * Its code is `unavailable`.
 *
 * @stability unstable
 * @category built-in errors
 * @since 0.3.0
 */
export class Unavailable extends Schema.TaggedError<
  Unavailable,
  { readonly brand: unique symbol }
>()(
  "Unavailable",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "unavailable" },
) {}

/**
 * No response arrived: the request never reached the server, the connection
 * broke before it answered, or the client gave up waiting.
 *
 * **Details**
 *
 * The client SDK appends the HTTP status of an answer to its error's message
 * as ` [<status>]`, and reports a network failure as status 0. The errors the
 * SDK makes itself carry no status: its timeout (`deadline-exceeded`), a
 * cancelled call, and a deleted Functions instance. `CallableClient` treats
 * an error without a status, or with status 0, as a `TransportError`, except
 * for an answer the SDK can't read, which is a {@link DecodeError}.
 *
 * @see {@link ResponseError} for an error the server answered with
 *
 * @stability unstable
 * @category errors
 * @since 0.3.0
 */
export class TransportError extends Schema.TaggedError<
  TransportError,
  { readonly brand: unique symbol }
>()("TransportError", {
  /** What the SDK threw. */
  cause: Schema.Defect(),
}) {}

/**
 * The server answered with an error the contract doesn't declare.
 *
 * **Details**
 *
 * `code` is Firebase's error code without its `functions/` prefix, such as
 * `not-found`. `not-found` usually means the client calls the wrong region or
 * a name the server doesn't export.
 *
 * Only an error the server answered with, with a non-zero HTTP status, is a
 * `ResponseError`. A `deadline-exceeded` the server sends is one; the client
 * SDK's own timeout, which has the same code, is a {@link TransportError}.
 *
 * @see {@link TransportError} for a call no answer arrived for
 *
 * @stability unstable
 * @category errors
 * @since 0.3.0
 */
export class ResponseError extends Schema.TaggedError<
  ResponseError,
  { readonly brand: unique symbol }
>()("ResponseError", {
  /** Firebase's error code, such as `internal`. */
  code: ErrorCode,
  /** The error's message, without the SDK's ` [status]` suffix. */
  message: Schema.String,
  /** The error's `details`, as the server sent them. */
  details: Schema.Unknown,
}) {}

/**
 * The Payload didn't encode through its `Schema.toCodecJson`, so nothing was
 * sent.
 *
 * @stability unstable
 * @category errors
 * @since 0.3.0
 */
export class EncodeError extends Schema.TaggedError<
  EncodeError,
  { readonly brand: unique symbol }
>()("EncodeError", {
  /** The `Schema.SchemaError` of the encode. */
  cause: Schema.Defect(),
}) {}

/**
 * The server's answer didn't decode against the contract, as after the server
 * and the client drift apart.
 *
 * @stability unstable
 * @category errors
 * @since 0.3.0
 */
export class DecodeError extends Schema.TaggedError<
  DecodeError,
  { readonly brand: unique symbol }
>()("DecodeError", {
  /** The `Schema.SchemaError` of the decode. */
  cause: Schema.Defect(),
}) {}

/**
 * What went wrong with a call, as one of the reasons above.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type Reason = TransportError | ResponseError | EncodeError | DecodeError;

/**
 * A call to a Callable failed in a way the contract doesn't declare.
 *
 * **When to use**
 *
 * Use `Effect.catchReason` on its `reason` to recover from one kind of
 * failure, such as a missing response.
 *
 * @example Recovering from a missing response
 * ```ts
 * import { Effect } from "effect";
 * import type { CallableError } from "@visiolab/effect-firebase/functions";
 *
 * declare const call: Effect.Effect<string, CallableError.CallableError>;
 *
 * const program = call.pipe(
 *   Effect.catchReason("CallableError", "TransportError", () => Effect.succeed("offline")),
 * );
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.3.0
 */
export class CallableError extends Schema.TaggedError<
  CallableError,
  { readonly brand: unique symbol }
>()("CallableError", {
  /** The deployed name of the Callable Function that was called. */
  callable: Schema.String,
  /** What went wrong. */
  reason: Schema.Union([TransportError, ResponseError, EncodeError, DecodeError]),
}) {}
