import { describe } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { doc, type DocumentData, setDoc } from "firebase/firestore";
import { testFirestore } from "@visiolab/firestore-conformance";
import * as App from "../../src/app/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import * as ClientFirestoreValue from "../../src/firestore/ClientFirestoreValue.ts";
import { clear, emulator } from "./emulator.ts";

const projectId = "demo-client-conformance";

// Clears the project each time the layer is built, which is before each test,
// so a failed test leaves its documents behind to look at.
const layer = ClientFirestore.layer({ emulator }).pipe(
  Layer.provide(App.layer({ projectId }, "conformance")),
  Layer.provide(Layer.effectDiscard(clear(projectId))),
);

describe("ClientFirestore, against the emulator, conformance", () => {
  testFirestore(layer, {
    // The very code the client SDK retries a conflict by.
    abortCode: "aborted",
    seedRaw: (path, data) =>
      Effect.flatMap(ClientFirestore.ClientFirestore, ({ instance }) =>
        Effect.promise(() =>
          setDoc(
            doc(instance, path),
            ClientFirestoreValue.toClient(data, instance) as DocumentData,
          ),
        ),
      ),
  });
});
