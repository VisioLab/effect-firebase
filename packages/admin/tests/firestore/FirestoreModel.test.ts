import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  FieldValue,
  FirestoreModel,
  FirestoreSchema,
  FirestoreValue,
} from "@visiolab/effect-firebase/firestore";
import { FieldValue as NativeFieldValue, Firestore } from "firebase-admin/firestore";
import { toAdmin } from "../../src/firestore/AdminFirestoreValue.ts";

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
const firestore = new Firestore({ projectId: "demo" });
const doc = firestore.doc("places/a");
const applies = (data: unknown) => () => firestore.batch().update(doc, data as any);

/** Encodes an update the way the service does, with no layer. */
const encode = (patch: (typeof Place.update)["Type"]) =>
  Schema.encodeEffect(FirestoreValue.toCodecFirestore(Place.update))(patch).pipe(
    Effect.map((encoded) => toAdmin(encoded, firestore)),
  );

describe("an update reaching into a struct", () => {
  it.effect("is one the Admin SDK applies, removal and all", () =>
    Effect.gen(function* () {
      const encoded = yield* encode(
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
      const encoded = yield* encode(
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
