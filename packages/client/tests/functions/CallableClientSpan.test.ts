import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Tracer } from "effect";
import * as App from "../../src/app/App.ts";
import * as CallableClient from "../../src/functions/CallableClient.ts";
import * as ClientFunctions from "../../src/functions/ClientFunctions.ts";
import { Greet, Users } from "../../../functions/tests/fixture/src/contract.ts";
import { emulator } from "./emulator.ts";

const FunctionsLive = ClientFunctions.layer({ emulator }).pipe(
  Layer.provide(App.layer({ projectId: "demo-effect-firebase" }, "callable-client-span")),
);

/** A Tracer that keeps every span it opens, for the test to read. */
const recording = () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return { spans, tracer };
};

describe("CallableClient spans", () => {
  it.effect("opens a client span per call of a Callable in no group", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recording();
      const { greet } = yield* CallableClient.make(Greet);
      yield* greet({ name: "Ada", at: new Date() }).pipe(Effect.withTracer(tracer));
      yield* greet({ name: "Grace", at: new Date() }).pipe(Effect.withTracer(tracer));
      expect(
        spans.map((span) => [span.name, span.kind, Object.fromEntries(span.attributes)]),
      ).toEqual(
        Array.from({ length: 2 }, () => [
          "CallableClient.greet",
          "client",
          { "rpc.system": "firebase_callable", "rpc.method": "greet", "faas.name": "greet" },
        ]),
      );
      expect(spans.every((span) => span.status._tag === "Ended")).toBe(true);
    }).pipe(Effect.provide(FunctionsLive)),
  );

  it.effect("names a member's span after its deployed name", () =>
    Effect.gen(function* () {
      const { spans, tracer } = recording();
      const users = yield* CallableClient.make(Users);
      yield* users.get({ id: "ada" }).pipe(Effect.withTracer(tracer));
      expect(
        spans.map((span) => [span.name, span.kind, Object.fromEntries(span.attributes)]),
      ).toEqual([
        [
          "CallableClient.users-get",
          "client",
          {
            "rpc.system": "firebase_callable",
            "rpc.method": "get",
            "rpc.service": "users",
            "faas.name": "users-get",
          },
        ],
      ]);
    }).pipe(Effect.provide(FunctionsLive)),
  );
});
