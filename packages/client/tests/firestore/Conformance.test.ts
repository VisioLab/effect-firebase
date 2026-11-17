import { describe } from "@effect/vitest";
import { Layer } from "effect";
import { testFirestore } from "@visiolab/firestore-conformance";
import * as App from "../../src/app/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import { clear, emulator } from "./emulator.ts";

const projectId = "demo-client-conformance";

// Clears the project each time the layer is built, which is before each test,
// so a failed test leaves its documents behind to look at.
const layer = ClientFirestore.layer({ emulator }).pipe(
  Layer.provide(App.layer({ projectId }, "conformance")),
  Layer.provide(Layer.effectDiscard(clear(projectId))),
);

describe("ClientFirestore, against the emulator, conformance", () => {
  testFirestore(layer);
});
