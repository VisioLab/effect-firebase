/**
 * The error a Callable Client fails with when a call goes wrong in a way the
 * contract doesn't declare.
 *
 * @stability unstable
 * @since 0.3.0
 */
import { Schema } from "effect";

/**
 * No response arrived: the request never reached the server, or the
 * connection broke before it answered.
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
 * @stability unstable
 * @category errors
 * @since 0.3.0
 */
export class ResponseError extends Schema.TaggedError<
  ResponseError,
  { readonly brand: unique symbol }
>()("ResponseError", {
  /** Firebase's error code, such as `internal`. */
  code: Schema.String,
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
 * Match on `reason` to recover from one kind of failure, with
 * `Effect.catchReason`.
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
