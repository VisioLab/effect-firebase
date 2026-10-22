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

describe("an update into a union field", () => {
  const Pending = FirestoreModel.Struct({
    status: Schema.Literal("pending"),
    title: Schema.String,
  });
  const Done = FirestoreModel.Struct({
    status: Schema.Literal("done"),
    title: Schema.String,
    completedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
  });

  class Job extends FirestoreModel.Class<Job>("Job")({
    state: FirestoreModel.Union([Pending, Done]),
  }) {}

  it.effect("is one the Admin SDK applies at a Shared Field", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreValue.toCodecFirestore(Job.update))(
        Job.update.make({ state: { title: "t" } }),
      ).pipe(Effect.map((encoded) => toAdmin(encoded, firestore)));
      expect(encoded).toStrictEqual({ "state.title": "t" });
      expect(applies(encoded)).not.toThrow();
    }),
  );

  it.effect("is one the Admin SDK applies at a key one member holds, unchecked", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(
        FirestoreValue.toCodecFirestore(Job.updateUnchecked),
      )(
        Job.updateUnchecked.make({
          state: { title: "t", completedAt: FieldValue.serverTimestamp },
        }),
      ).pipe(Effect.map((encoded) => toAdmin(encoded, firestore)));
      expect(encoded).toStrictEqual({
        "state.title": "t",
        "state.completedAt": NativeFieldValue.serverTimestamp(),
      });
      expect(applies(encoded)).not.toThrow();
    }),
  );
});
