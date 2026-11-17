import { describe } from "@effect/vitest";
import { Effect } from "effect";
import { Firestore } from "@visiolab/effect-firebase/firestore";
import { testFirestore } from "@visiolab/firestore-conformance";

// The tests only the In-memory Firestore needs live next to it, in core's
// `tests/firestore/MemoryFirestore.test.ts`.
describe("Firestore.layerMemory, conformance", () => {
  testFirestore(Firestore.layerMemory, {
    seedRaw: (path, data) =>
      Effect.flatMap(Firestore.MemoryDriver, (driver) => driver.set(path, data)),
    abortCode: "aborted",
  });
});
