/**
 * PROTOTYPE, throwaway. Lives only on the `prototype-webchannel-spike` branch.
 *
 * Decodes the WebChannel back channel, `<length>\n<json><length>\n<json>…`,
 * built the way `effect/encoding/Ndjson` is: a framing `Channel` from string
 * chunks to JSON values that fails with a typed error and never throws, and
 * a `*Schema*` variant that pipes it into `ChannelSchema.decodeUnknown`.
 */
import { Array as Arr, Cause, Channel, ChannelSchema, Data, Effect, Pull, Schema } from "effect";

/**
 * The back channel was not a valid sequence of length-prefixed JSON frames.
 *
 * - `InvalidLength`: a length prefix is not a decimal integer.
 * - `FrameTooLarge`: a length prefix is above `maxFrameLength`.
 * - `InvalidJson`: a frame body is not JSON.
 * - `Truncated`: the input ended inside a frame.
 */
export class WebChannelFrameError extends Data.TaggedError("WebChannelFrameError")<{
  readonly reason: "InvalidLength" | "FrameTooLarge" | "InvalidJson" | "Truncated";
  readonly cause?: unknown;
}> {}

const lengthPattern = /^\d+$/;
// Enough digits for any length up to `maxFrameLength`, checked before a
// newline arrives so a stream without newlines cannot grow the buffer.
const maxLengthDigits = 10;

/**
 * Creates a channel that splits WebChannel back-channel text into frames and
 * parses each frame as JSON.
 *
 * **Details**
 *
 * Frames may span input chunks, and one chunk may hold several frames. The
 * length counts UTF-16 code units, so the input must already be decoded text.
 * The first invalid frame fails the channel, after the frames before it have
 * been emitted. Input that ends inside a frame fails with `Truncated`.
 * `maxFrameLength` (default 16 MiB of code units) bounds how much is buffered.
 */
export const decodeString = <IE = never, Done = unknown>(options?: {
  readonly maxFrameLength?: number | undefined;
}): Channel.Channel<
  Arr.NonEmptyReadonlyArray<unknown>,
  IE | WebChannelFrameError,
  Done,
  Arr.NonEmptyReadonlyArray<string>,
  IE,
  Done
> =>
  Channel.fromTransform((upstream) =>
    Effect.sync(() => {
      const maxFrameLength = options?.maxFrameLength ?? 16 * 1024 * 1024;
      let buffer = "";
      let failure: WebChannelFrameError | undefined;
      let done: { readonly leftover: Done } | undefined;

      // Moves every complete frame in `buffer` into `out`.
      const step = (out: Array<unknown>): WebChannelFrameError | undefined => {
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline === -1) {
            return buffer.length > maxLengthDigits || !/^\d*$/.test(buffer)
              ? new WebChannelFrameError({ reason: "InvalidLength" })
              : undefined;
          }
          const prefix = buffer.slice(0, newline);
          if (!lengthPattern.test(prefix)) {
            return new WebChannelFrameError({ reason: "InvalidLength" });
          }
          const length = Number(prefix);
          if (length > maxFrameLength) {
            return new WebChannelFrameError({ reason: "FrameTooLarge" });
          }
          const end = newline + 1 + length;
          if (buffer.length < end) return undefined;
          try {
            out.push(JSON.parse(buffer.slice(newline + 1, end)));
          } catch (cause) {
            return new WebChannelFrameError({ reason: "InvalidJson", cause });
          }
          buffer = buffer.slice(end);
        }
      };

      const pull: Pull.Pull<
        Arr.NonEmptyReadonlyArray<unknown>,
        IE | WebChannelFrameError,
        Done
      > = Effect.suspend(() => {
        if (failure !== undefined) return Effect.fail(failure);
        if (done !== undefined) return Cause.done(done.leftover);
        return Pull.matchEffect(upstream, {
          onSuccess: (chunk) => {
            buffer += chunk.join("");
            const out: Array<unknown> = [];
            failure = step(out);
            if (Arr.isArrayNonEmpty(out)) return Effect.succeed(out);
            return failure !== undefined ? Effect.fail(failure) : pull;
          },
          onFailure: Effect.failCause,
          onDone: (
            leftover,
          ): Pull.Pull<Arr.NonEmptyReadonlyArray<unknown>, WebChannelFrameError, Done> => {
            done = { leftover };
            return buffer.length > 0
              ? Effect.fail(new WebChannelFrameError({ reason: "Truncated" }))
              : Cause.done(leftover);
          },
        });
      });
      return pull;
    }),
  );

/**
 * Creates a channel that splits WebChannel back-channel text into frames and
 * decodes each frame with `schema`.
 */
export const decodeSchemaString =
  <S extends Schema.Constraint>(schema: S) =>
  <IE = never, Done = unknown>(options?: {
    readonly maxFrameLength?: number | undefined;
  }): Channel.Channel<
    Arr.NonEmptyReadonlyArray<S["Type"]>,
    Schema.SchemaError | WebChannelFrameError | IE,
    Done,
    Arr.NonEmptyReadonlyArray<string>,
    IE,
    Done,
    S["DecodingServices"]
  > =>
    Channel.pipeTo(decodeString<IE, Done>(options), ChannelSchema.decodeUnknown(schema)());

// ---------------------------------------------------------------------------
// Frame contents
// ---------------------------------------------------------------------------

/** One back-channel array: its id and its payload. */
export const Entry = Schema.Tuple([Schema.Int, Schema.Array(Schema.Unknown)]);

/** A frame holds one or more arrays. */
export const Frame = Schema.NonEmptyArray(Entry);

/** Heartbeat. */
export const Noop = Schema.Tuple([Schema.Literal("noop")]);

/** The server ends the session. */
export const Stop = Schema.Tuple([Schema.Literals(["stop", "close"])]);

/** A message for the application, such as one `ListenResponse`. */
export const Message = Schema.Tuple([Schema.Unknown]);

/** The handshake reply: `[[0, ["c", <SID>, <host prefix>, <version>, …]]]`. */
export const Handshake = Schema.Tuple([
  Schema.Tuple([
    Schema.Int,
    Schema.TupleWithRest(Schema.Tuple([Schema.Literal("c"), Schema.String]), [Schema.Unknown]),
  ]),
]);
