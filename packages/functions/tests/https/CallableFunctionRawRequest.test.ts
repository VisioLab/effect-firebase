import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import * as Callable from "@visiolab/effect-firebase/functions/Callable";
import * as CallableRequest from "@visiolab/effect-firebase/functions/CallableRequest";
import type * as Https from "firebase-functions/v2/https";
import * as Functions from "../../src/Functions.ts";

/** What `echo` saw of its `rawRequest`. */
const Seen = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  userAgent: Schema.NullOr(Schema.String),
  remoteAddress: Schema.NullOr(Schema.String),
  body: Schema.String,
});

const Echo = Callable.make("echo", { success: Seen });

/** An Express request as `firebase-functions` hands one over, with only what the conversion reads. */
const expressRequest = (rawBody: Buffer) =>
  ({
    method: "post",
    protocol: "http",
    originalUrl: "/demo-effect-firebase/us-central1/echo",
    headers: { "content-type": "application/json", "user-agent": "curl/8.7.1" },
    rawBody,
    ip: "203.0.113.7",
    get: (name: string) => (name === "host" ? "127.0.0.1:5001" : undefined),
  }) as unknown as Https.Request;

/** Runs `echo` in process, as `firebase-functions` would on a call, with `onRead` run before the body is read. */
const call = (rawBody: Buffer, onRead: () => void) => {
  const { echo } = Functions.make(
    Echo,
    Callable.toLayer(Echo, () =>
      Effect.gen(function* () {
        const { rawRequest } = yield* CallableRequest.CallableRequest;
        onRead();
        return {
          method: rawRequest.method,
          url: rawRequest.url,
          userAgent: rawRequest.headers["user-agent"] ?? null,
          remoteAddress: Option.getOrNull(rawRequest.remoteAddress),
          body: yield* Effect.orDie(rawRequest.text),
        };
      }),
    ),
  );
  return Effect.promise(() =>
    echo.run({ data: null, rawRequest: expressRequest(rawBody), acceptsStreaming: false }),
  ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Seen)), Effect.orDie);
};

describe("CallableRequest.rawRequest of a CallableFunction", () => {
  it.effect("carries the method, URL, headers and caller's address of the Express request", () =>
    Effect.gen(function* () {
      const result = yield* call(Buffer.from('{"data":null}'), () => {});
      expect(result).toMatchObject({
        method: "POST",
        url: "/demo-effect-firebase/us-central1/echo",
        userAgent: "curl/8.7.1",
        remoteAddress: "203.0.113.7",
      });
    }),
  );

  it.effect("reads back the whole body", () =>
    Effect.gen(function* () {
      const body = JSON.stringify({ data: "x".repeat(1_000_000) });
      const result = yield* call(Buffer.from(body), () => {});
      expect(result.body).toBe(body);
    }),
  );

  it.effect("reads the body from Firebase's bytes without copying them", () =>
    Effect.gen(function* () {
      const rawBody = Buffer.from('{"data":"before"}');
      const result = yield* call(rawBody, () => rawBody.write('{"data":"after!"}'));
      expect(result.body).toBe('{"data":"after!"}');
    }),
  );
});
