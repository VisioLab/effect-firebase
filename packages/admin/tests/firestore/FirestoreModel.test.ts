import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { FieldValue, FirestoreModel, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
import { FieldValue as NativeFieldValue, Firestore } from "firebase-admin/firestore";
import * as App from "../../src/App.ts";
import * as FirestoreEncoder from "../../src/firestore/FirestoreEncoder.ts";

// A named app keeps each run independent of whatever the default app is, and of
// the apps the other suites register.
const encoder = FirestoreEncoder.layer.pipe(
  Layer.provide(App.layer({ projectId: "demo-model" }, "model")),
);

const Address = FirestoreModel.Struct({
  city: Schema.String,
  nickname: FirestoreModel.Optional(Schema.String),
  verifiedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
});

class Place extends FirestoreModel.Class<Place>("Place")({
  name: Schema.String,
  address: Address,
  billing: FirestoreModel.Optional(Address),
}) {}

// `update` on a batch validates synchronously and sends nothing until a commit.
const doc = new Firestore({ projectId: "demo" }).doc("places/a");
const applies = (data: object) => () =>
  new Firestore({ projectId: "demo" }).batch().update(doc, data as any);

layer(encoder)("an update reaching into a struct", (it) => {
  it.effect("is one the Admin SDK applies, removal and all", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)(
        Place.update.make({
          address: { nickname: FieldValue.deleteField, verifiedAt: FieldValue.serverTimestamp },
        }),
      );
      expect(encoded).toStrictEqual({
        "address.nickname": NativeFieldValue.delete(),
        "address.verifiedAt": NativeFieldValue.serverTimestamp(),
      });
      expect(applies(encoded)).not.toThrow();
    }),
  );

  it.effect("is one the Admin SDK applies where a whole map is removed", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)(
        Place.update.make({ billing: FieldValue.deleteField, address: { city: "Berlin" } }),
      );
      expect(encoded).toStrictEqual({
        billing: NativeFieldValue.delete(),
        "address.city": "Berlin",
      });
      expect(applies(encoded)).not.toThrow();
    }),
  );
});
