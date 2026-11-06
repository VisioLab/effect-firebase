import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as App from "../../src/app/App.ts";
import * as CallableClient from "../../src/functions/CallableClient.ts";
import * as ClientFunctions from "../../src/functions/ClientFunctions.ts";
import { Greet } from "../../../functions/tests/fixture/src/contract.ts";
import { emulator } from "./emulator.ts";

// The project the emulator serves the fixture under. A named app keeps this
// suite apart from the others in the package.
const FunctionsLive = ClientFunctions.layer({ emulator }).pipe(
  Layer.provide(App.layer({ projectId: "demo-effect-firebase" }, "callable-client")),
);

describe("CallableClient", () => {
  it.effect("calls a Callable in no group and decodes what it answers", () =>
    Effect.gen(function* () {
      const { greet } = yield* CallableClient.make(Greet);
      const result = yield* greet({ name: "Ada", at: new Date("2026-01-01T12:00:00.000Z") });
      expect(result).toEqual({
        message: "Hello, Ada!",
        nextDay: new Date("2026-01-02T12:00:00.000Z"),
      });
    }).pipe(Effect.provide(FunctionsLive)),
  );
});
