import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import { FieldValue as NativeFieldValue, Firestore } from "firebase-admin/firestore";
import * as FirestoreEncoder from "../../src/firestore/FirestoreEncoder.ts";

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

describe("an update reaching into a group", () => {
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
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
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
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});
