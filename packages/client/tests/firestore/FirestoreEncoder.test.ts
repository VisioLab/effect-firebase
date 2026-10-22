import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import {
  Collection,
  FieldValue,
  FirestoreModel,
  FirestoreSchema,
  GeoPoint,
  Timestamp,
} from "@visiolab/effect-firebase/firestore";
import {
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  DocumentReference as NativeDocumentReference,
  FieldValue as NativeFieldValue,
  GeoPoint as NativeGeoPoint,
  getFirestore,
  increment,
  refEqual,
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

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  createdAt: FirestoreSchema.Timestamp,
}) {}

layer(encoder)("FirestoreEncoder", (it) => {
  it.effect("encodes a document into the values the client SDK writes", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Post)(
        new Post({
          title: "hello",
          createdAt: Timestamp.makeUnsafe(1_700_000_000, 123_456_789),
        }),
      );

      expect(encoded.createdAt).toBeInstanceOf(Native);
      expect((encoded.createdAt as Native).isEqual(new Native(1_700_000_000, 123_456_789))).toBe(
        true,
      );
    }),
  );

  it.effect("round-trips a timestamp through the SDK's own representation", () =>
    Effect.gen(function* () {
      const original = new Native(1_700_000_000, 123_456_789);
      const post = yield* Schema.decodeEffect(Post)({ title: "t", createdAt: original });
      expect(Timestamp.isTimestamp(post.createdAt)).toBe(true);
      const encoded = yield* Schema.encodeEffect(Post)(post);
      expect((encoded.createdAt as Native).isEqual(original)).toBe(true);
    }),
  );
});

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

class Landmark extends FirestoreModel.Class<Landmark>("Landmark")({
  name: Schema.String,
  location: FirestoreSchema.GeoPoint,
}) {}

layer(encoder)("GeoPoint", (it) => {
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

  it.effect("writes the SDK's own geopoint", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Landmark.create)(
        Landmark.create.make({ name: "Fernsehturm", location: GeoPoint.makeUnsafe(52.52, 13.405) }),
      );
      expect(encoded.location).toBeInstanceOf(NativeGeoPoint);
      expect((encoded.location as NativeGeoPoint).isEqual(new NativeGeoPoint(52.52, 13.405))).toBe(
        true,
      );
    }),
  );
});

const Users = Collection.make("users", User);
const Posts = Users.subcollection("posts", Post);

class Comment extends FirestoreModel.Class<Comment>("Comment")({
  body: Schema.String,
  author: FirestoreSchema.DocumentReference(Users),
  post: FirestoreSchema.DocumentReference(Posts),
}) {}

const alice = Users.doc(Users.id.make("alice"));
const hello = Posts.doc(Users.id.make("alice"), Posts.id.make("hello"));

layer(encoder)("DocumentReference", (it) => {
  it.effect("round-trips a reference through the SDK's own representation", () =>
    Effect.gen(function* () {
      const original = doc(getFirestore(yield* App.App), "users/alice");
      const author = yield* Schema.decodeEffect(FirestoreSchema.DocumentReference(Users))(original);
      expect(author.collection).toBe(Users);
      expect(author.path).toBe(alice.path);
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.DocumentReference(Users))(author);
      expect(encoded).toBeInstanceOf(NativeDocumentReference);
      expect(refEqual(encoded as NativeDocumentReference, original)).toBe(true);
    }),
  );

  it.effect("writes a document the client SDK can set as it stands", () =>
    Effect.gen(function* () {
      const firestore = getFirestore(yield* App.App);
      const encoded = yield* Schema.encodeEffect(Comment.create)(
        Comment.create.make({ body: "first", author: alice, post: hello }),
      );
      expect(refEqual(encoded.post as NativeDocumentReference, doc(firestore, hello.path))).toBe(
        true,
      );
      // `set` on a batch validates synchronously and sends nothing until a commit.
      expect(() => writeBatch(firestore).set(doc(firestore, "comments/a"), encoded)).not.toThrow();
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
