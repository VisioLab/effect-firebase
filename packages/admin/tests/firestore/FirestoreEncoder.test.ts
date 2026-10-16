import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import * as GeoPoint from "@visiolab/effect-firebase/firestore/GeoPoint";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import {
  GeoPoint as NativeGeoPoint,
  FieldValue as NativeFieldValue,
  Timestamp as Native,
} from "firebase-admin/firestore";
import * as FirestoreEncoder from "../../src/firestore/FirestoreEncoder.ts";

const Post = Schema.Struct({ title: Schema.String, createdAt: FirestoreSchema.Timestamp });

describe("FirestoreEncoder", () => {
  it.effect("encodes a document into the values the Admin SDK writes", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Post)({
        title: "hello",
        createdAt: Timestamp.makeUnsafe(1_700_000_000, 123_456_789),
      });

      expect(encoded.createdAt).toBeInstanceOf(Native);
      expect(encoded.title).toBe("hello");
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("carries the digits finer than a millisecond through to the SDK", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.Timestamp)(
        Timestamp.makeUnsafe(1_700_000_000, 123_456_789),
      );
      expect((encoded as Native).isEqual(new Native(1_700_000_000, 123_456_789))).toBe(true);
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("reads a document the SDK handed back without an encoder at all", () =>
    Effect.gen(function* () {
      const post = yield* Schema.decodeEffect(Post)({
        title: "hello",
        createdAt: new Native(1_700_000_000, 123_456_789),
      });
      expect(Timestamp.isTimestamp(post.createdAt)).toBe(true);
      expect(post.createdAt.nanoseconds).toBe(123_456_789);
    }),
  );

  it.effect("round-trips a timestamp through the SDK's own representation", () =>
    Effect.gen(function* () {
      const original = new Native(1_700_000_000, 123_456_789);
      const post = yield* Schema.decodeEffect(Post)({ title: "t", createdAt: original });
      const encoded = yield* Schema.encodeEffect(Post)(post);
      expect((encoded.createdAt as Native).isEqual(original)).toBe(true);
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});

class User extends FirestoreModel.Class<User>("User")({
  displayName: Schema.String,
  createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
  updatedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
}) {}

describe("ServerTimestamp", () => {
  it.effect("writes the sentinel the Admin SDK resolves at the server", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.ServerTimestamp)(
        FieldValue.serverTimestamp,
      );
      expect(encoded).toBeInstanceOf(NativeFieldValue);
      expect(encoded).toStrictEqual(NativeFieldValue.serverTimestamp());
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("writes a document the Admin SDK can set as it stands", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.create)(
        User.create.make({
          displayName: "alice",
          createdAt: FieldValue.serverTimestamp,
          updatedAt: FieldValue.serverTimestamp,
        }),
      );
      expect(encoded).toStrictEqual({
        displayName: "alice",
        createdAt: NativeFieldValue.serverTimestamp(),
        updatedAt: NativeFieldValue.serverTimestamp(),
      });
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("writes an update the Admin SDK can apply as it stands", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.update)(
        User.update.make({
          displayName: "alice in chains",
          updatedAt: FieldValue.serverTimestamp,
        }),
      );
      expect(encoded).toStrictEqual({
        displayName: "alice in chains",
        updatedAt: NativeFieldValue.serverTimestamp(),
      });
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});

class Page extends FirestoreModel.Class<Page>("Page")({
  slug: Schema.String,
  visits: FirestoreModel.Number(Schema.Int),
}) {}

describe("Increment", () => {
  it.effect("writes the sentinel the Admin SDK resolves at the server", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.Increment)(
        FieldValue.increment(2),
      );
      expect(encoded).toBeInstanceOf(NativeFieldValue);
      expect(encoded).toStrictEqual(NativeFieldValue.increment(2));
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("writes a move down as the negative the SDK takes", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.Increment)(
        FieldValue.decrement(2),
      );
      expect(encoded).toStrictEqual(NativeFieldValue.increment(-2));
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("writes an update the Admin SDK can apply as it stands", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.increment(1) }),
      );
      expect(encoded).toStrictEqual({ visits: NativeFieldValue.increment(1) });
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("sets the number outright where a write was handed one", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.create)(
        Page.create.make({ slug: "home", visits: 0 }),
      );
      expect(encoded).toStrictEqual({ slug: "home", visits: 0 });
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});

class Profile extends FirestoreModel.Class<Profile>("Profile")({
  name: Schema.String,
  nickname: FirestoreModel.Optional(Schema.String),
}) {}

describe("DeleteField", () => {
  it.effect("writes the sentinel the Admin SDK removes the field with", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.DeleteField)(
        FieldValue.deleteField,
      );
      expect(encoded).toBeInstanceOf(NativeFieldValue);
      expect(encoded).toStrictEqual(NativeFieldValue.delete());
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("writes an update the Admin SDK can apply as it stands", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Profile.update)(
        Profile.update.make({ nickname: FieldValue.deleteField }),
      );
      expect(encoded).toStrictEqual({ nickname: NativeFieldValue.delete() });
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});

class Article extends FirestoreModel.Class<Article>("Article")({
  name: Schema.String,
  tags: FirestoreModel.Array(Schema.String),
  revisedAt: FirestoreModel.Array(FirestoreSchema.Timestamp),
}) {}

describe("ArrayUnion", () => {
  it.effect("writes the sentinel the Admin SDK grows the array with", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.ArrayUnion(Schema.String))(
        FieldValue.arrayUnion("a", "b"),
      );
      expect(encoded).toBeInstanceOf(NativeFieldValue);
      expect((encoded as NativeFieldValue).isEqual(NativeFieldValue.arrayUnion("a", "b"))).toBe(
        true,
      );
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("hands the SDK its own timestamps among the elements", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ revisedAt: FieldValue.arrayUnion(Timestamp.makeUnsafe(1, 2)) }),
      );
      expect(
        (encoded.revisedAt as NativeFieldValue).isEqual(
          NativeFieldValue.arrayUnion(new Native(1, 2)),
        ),
      ).toBe(true);
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});

describe("ArrayRemove", () => {
  it.effect("writes the sentinel the Admin SDK shrinks the array with", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ tags: FieldValue.arrayRemove("news") }),
      );
      expect((encoded.tags as NativeFieldValue).isEqual(NativeFieldValue.arrayRemove("news"))).toBe(
        true,
      );
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});

class Landmark extends FirestoreModel.Class<Landmark>("Landmark")({
  name: Schema.String,
  location: FirestoreSchema.GeoPoint,
}) {}

describe("GeoPoint", () => {
  it.effect("reads a geopoint the SDK handed back", () =>
    Effect.gen(function* () {
      const landmark = yield* Schema.decodeEffect(Landmark)({
        name: "Fernsehturm",
        location: new NativeGeoPoint(52.52, 13.405),
      });
      expect(GeoPoint.isGeoPoint(landmark.location)).toBe(true);
      expect(landmark.location.longitude).toBe(13.405);
    }),
  );

  it.effect("writes a document the Admin SDK stores a geopoint in", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Landmark.create)(
        Landmark.create.make({ name: "Fernsehturm", location: GeoPoint.makeUnsafe(52.52, 13.405) }),
      );
      expect(encoded.location).toBeInstanceOf(NativeGeoPoint);
      expect((encoded.location as NativeGeoPoint).isEqual(new NativeGeoPoint(52.52, 13.405))).toBe(
        true,
      );
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("writes an update the Admin SDK stores a geopoint in", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Landmark.update)(
        Landmark.update.make({ location: GeoPoint.makeUnsafe(52.52, 13.405) }),
      );
      expect(encoded.location).toBeInstanceOf(NativeGeoPoint);
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});
