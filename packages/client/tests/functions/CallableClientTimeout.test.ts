import { assert, describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { Effect, Layer } from "effect";
import * as CallableError from "@visiolab/effect-firebase/functions/CallableError";
import * as App from "../../src/app/App.ts";
import * as CallableClient from "../../src/functions/CallableClient.ts";
import * as ClientFunctions from "../../src/functions/ClientFunctions.ts";
import { Sleep } from "../../../functions/tests/fixture/src/contract.ts";
import { FunctionsError } from "firebase/functions";
import { emulator } from "./emulator.ts";

// `CallableClient` passes no options to `httpsCallable`, whose timeout
// defaults to 70 seconds. This file gives every call a short one instead.
vi.mock("firebase/functions", async (importOriginal) => {
  const original = await importOriginal<typeof import("firebase/functions")>();
  return {
    ...original,
    httpsCallable: (...[functions, name, options]: Parameters<typeof original.httpsCallable>) =>
      original.httpsCallable(functions, name, { ...options, timeout: 200 }),
  };
});

const FunctionsLive = ClientFunctions.layer({ emulator }).pipe(
  Layer.provide(App.layer({ projectId: "demo-effect-firebase" }, "callable-timeout")),
);

describe("CallableClient", () => {
  it.effect("fails with a TransportError when the SDK's timeout passes before an answer", () =>
    Effect.gen(function* () {
      const { sleep } = yield* CallableClient.make(Sleep);
      const error = yield* Effect.flip(sleep({ millis: 2_000 }));
      expect(error).toBeInstanceOf(CallableError.CallableError);
      const { reason } = error;
      assert(reason instanceof CallableError.TransportError);
      // The SDK makes this error itself, so its message has no ` [<status>]` suffix.
      const { cause } = reason;
      assert(cause instanceof FunctionsError);
      expect(cause.code).toBe("functions/deadline-exceeded");
      expect(cause.message).not.toMatch(/ \[\d+\]$/);
    }).pipe(Effect.provide(FunctionsLive)),
  );
});
