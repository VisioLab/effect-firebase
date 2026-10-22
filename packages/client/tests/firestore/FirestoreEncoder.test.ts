import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import {
  FieldValue,
  FirestoreModel,
  FirestoreSchema,
  Timestamp,
} from "@visiolab/effect-firebase/firestore";
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  FieldValue as NativeFieldValue,
  getFirestore,
  increment,
  serverTimestamp,
  Timestamp as Native,
  writeBatch,
} from "firebase/firestore";
import * as App from "../../src/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";

// A named app keeps each run independent of whatever the default app is, and of
// the apps the other suites register.
const encoder = ClientFirestore.layerWithEncoder().pipe(
  Layer.provideMerge(App.layer({ projectId: "demo-client-encoder" }, "encoder")),
);

const sentinel = (encoded: unknown, expected: NativeFieldValue) => {
  expect(encoded).toBeInstanceOf(NativeFieldValue);
  expect((encoded as NativeFieldValue).isEqual(expected)).toBe(true);
};

class User extends FirestoreModel.Class<User>("User")({
  displayName: Schema.String,
  updatedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
}) {}

class Page extends FirestoreModel.Class<Page>("Page")({
  visits: FirestoreModel.Number(Schema.Int),
}) {}

class Profile extends FirestoreModel.Class<Profile>("Profile")({
  nickname: FirestoreModel.Optional(Schema.String),
}) {}

class Article extends FirestoreModel.Class<Article>("Article")({
  tags: FirestoreModel.Array(Schema.String),
  revisedAt: FirestoreModel.Array(FirestoreSchema.Timestamp),
}) {}

layer(encoder)("sentinels", (it) => {
  it.effect("writes the server timestamp the client SDK resolves at the server", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.update)(
        User.update.make({ updatedAt: FieldValue.serverTimestamp }),
      );
      sentinel(encoded.updatedAt, serverTimestamp());
    }),
  );

  it.effect("writes an increment, and a decrement as a negative one", () =>
    Effect.gen(function* () {
      const up = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.increment(2) }),
      );
      sentinel(up.visits, increment(2));
      const down = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.decrement(2) }),
      );
      sentinel(down.visits, increment(-2));
    }),
  );

  it.effect("writes the sentinel the client SDK removes a field with", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Profile.update)(
        Profile.update.make({ nickname: FieldValue.deleteField }),
      );
      sentinel(encoded.nickname, deleteField());
    }),
  );

  it.effect("hands the SDK its own timestamps among the elements of an array union", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ revisedAt: FieldValue.arrayUnion(Timestamp.makeUnsafe(1, 2)) }),
      );
      sentinel(encoded.revisedAt, arrayUnion(new Native(1, 2)));
    }),
  );

  it.effect("writes the sentinel the client SDK shrinks an array with", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ tags: FieldValue.arrayRemove("news") }),
      );
      sentinel(encoded.tags, arrayRemove("news"));
    }),
  );
});

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

layer(encoder)("an update reaching into a struct", (it) => {
  it.effect("is one the client SDK applies, removal and all", () =>
    Effect.gen(function* () {
      const firestore = getFirestore(yield* App.App);
      const encoded = yield* Schema.encodeEffect(Place.update)(
        Place.update.make({
          billing: FieldValue.deleteField,
          address: { nickname: FieldValue.deleteField, verifiedAt: FieldValue.serverTimestamp },
        }),
      );
      expect(Object.keys(encoded).toSorted()).toEqual([
        "address.nickname",
        "address.verifiedAt",
        "billing",
      ]);
      // `update` on a batch validates synchronously and sends nothing until a commit.
      expect(() =>
        writeBatch(firestore).update(doc(firestore, "places/a"), encoded as never),
      ).not.toThrow();
    }),
  );
});
