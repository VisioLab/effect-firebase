import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import {
  FieldValue,
  FirestoreModel,
  FirestoreSchema,
  Timestamp,
} from "@visiolab/effect-firebase/firestore";
import { FieldValue as NativeFieldValue, Timestamp as Native } from "firebase-admin/firestore";
import * as App from "../../src/App.ts";
import * as AdminFirestore from "../../src/firestore/AdminFirestore.ts";

// A named app keeps each run independent of whatever the default app is, and of
// the apps the other suites register.
const encoder = AdminFirestore.layerWithEncoder().pipe(
  Layer.provideMerge(App.layer({ projectId: "demo-encoder" }, "encoder")),
);

class User extends FirestoreModel.Class<User>("User")({
  displayName: Schema.String,
  createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
  updatedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
}) {}

layer(encoder)("ServerTimestamp", (it) => {
  it.effect("writes the sentinel the Admin SDK resolves at the server", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.ServerTimestamp)(
        FieldValue.serverTimestamp,
      );
      expect(encoded).toBeInstanceOf(NativeFieldValue);
      expect(encoded).toStrictEqual(NativeFieldValue.serverTimestamp());
    }),
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
    }),
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
    }),
  );
});

class Page extends FirestoreModel.Class<Page>("Page")({
  slug: Schema.String,
  visits: FirestoreModel.Number(Schema.Int),
}) {}

layer(encoder)("Increment", (it) => {
  it.effect("writes the sentinel the Admin SDK resolves at the server", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.Increment)(
        FieldValue.increment(2),
      );
      expect(encoded).toBeInstanceOf(NativeFieldValue);
      expect(encoded).toStrictEqual(NativeFieldValue.increment(2));
    }),
  );

  it.effect("writes a move down as the negative the SDK takes", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.Increment)(
        FieldValue.decrement(2),
      );
      expect(encoded).toStrictEqual(NativeFieldValue.increment(-2));
    }),
  );

  it.effect("writes an update the Admin SDK can apply as it stands", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.increment(1) }),
      );
      expect(encoded).toStrictEqual({ visits: NativeFieldValue.increment(1) });
    }),
  );

  it.effect("sets the number outright where a write was handed one", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.create)(
        Page.create.make({ slug: "home", visits: 0 }),
      );
      expect(encoded).toStrictEqual({ slug: "home", visits: 0 });
    }),
  );
});

class Profile extends FirestoreModel.Class<Profile>("Profile")({
  name: Schema.String,
  nickname: FirestoreModel.Optional(Schema.String),
}) {}

layer(encoder)("DeleteField", (it) => {
  it.effect("writes the sentinel the Admin SDK removes the field with", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.DeleteField)(
        FieldValue.deleteField,
      );
      expect(encoded).toBeInstanceOf(NativeFieldValue);
      expect(encoded).toStrictEqual(NativeFieldValue.delete());
    }),
  );

  it.effect("writes an update the Admin SDK can apply as it stands", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Profile.update)(
        Profile.update.make({ nickname: FieldValue.deleteField }),
      );
      expect(encoded).toStrictEqual({ nickname: NativeFieldValue.delete() });
    }),
  );
});

class Article extends FirestoreModel.Class<Article>("Article")({
  name: Schema.String,
  tags: FirestoreModel.Array(Schema.String),
  revisedAt: FirestoreModel.Array(FirestoreSchema.Timestamp),
}) {}

layer(encoder)("ArrayUnion", (it) => {
  it.effect("writes the sentinel the Admin SDK grows the array with", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.ArrayUnion(Schema.String))(
        FieldValue.arrayUnion("a", "b"),
      );
      expect(encoded).toBeInstanceOf(NativeFieldValue);
      expect((encoded as NativeFieldValue).isEqual(NativeFieldValue.arrayUnion("a", "b"))).toBe(
        true,
      );
    }),
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
    }),
  );
});

layer(encoder)("ArrayRemove", (it) => {
  it.effect("writes the sentinel the Admin SDK shrinks the array with", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ tags: FieldValue.arrayRemove("news") }),
      );
      expect((encoded.tags as NativeFieldValue).isEqual(NativeFieldValue.arrayRemove("news"))).toBe(
        true,
      );
    }),
  );
});
