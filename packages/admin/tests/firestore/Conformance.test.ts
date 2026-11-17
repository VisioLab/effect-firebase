import { describe } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type * as Admin from "firebase-admin/firestore";
import { testFirestore } from "@visiolab/firestore-conformance";
import * as App from "../../src/app/App.ts";
import * as AdminFirestore from "../../src/firestore/AdminFirestore.ts";
import * as AdminFirestoreValue from "../../src/firestore/AdminFirestoreValue.ts";
import { clear } from "./emulator.ts";

const projectId = "demo-admin-conformance";

// Clears the project each time the layer is built, which is before each test,
// so a failed test leaves its documents behind to look at.
const layer = AdminFirestore.layer().pipe(
  Layer.provide(App.layer({ projectId }, "conformance")),
  Layer.provide(Layer.effectDiscard(clear(projectId))),
);

describe("AdminFirestore, against the emulator, conformance", () => {
  testFirestore(layer, {
    // The very number the Admin SDK reads as ABORTED.
    abortCode: 10,
    seedRaw: (path, data) =>
      Effect.flatMap(AdminFirestore.AdminFirestore, ({ instance }) =>
        Effect.promise(() =>
          instance.doc(path).set(AdminFirestoreValue.toAdmin(data, instance) as Admin.DocumentData),
        ),
      ),
  });
});
