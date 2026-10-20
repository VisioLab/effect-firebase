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
  DocumentReference as NativeDocumentReference,
  getFirestore,
  GeoPoint as NativeGeoPoint,
  FieldValue as NativeFieldValue,
  Timestamp as Native,
} from "firebase-admin/firestore";
import * as App from "../../src/App.ts";
import * as FirestoreEncoder from "../../src/firestore/FirestoreEncoder.ts";

// A named app keeps each run independent of whatever the default app is, and of
// the apps the other suites register.
const encoder = FirestoreEncoder.layer.pipe(
  Layer.provideMerge(App.layer({ projectId: "demo-encoder" }, "encoder")),
);

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  createdAt: FirestoreSchema.Timestamp,
}) {}

layer(encoder)("FirestoreEncoder", (it) => {
  it.effect("encodes a document into the values the Admin SDK writes", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Post)(
        new Post({
          title: "hello",
          createdAt: Timestamp.makeUnsafe(1_700_000_000, 123_456_789),
        }),
      );

      expect(encoded.createdAt).toBeInstanceOf(Native);
      expect(encoded.title).toBe("hello");
    }),
  );

  it.effect("carries the digits finer than a millisecond through to the SDK", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.Timestamp)(
        Timestamp.makeUnsafe(1_700_000_000, 123_456_789),
      );
      expect((encoded as Native).isEqual(new Native(1_700_000_000, 123_456_789))).toBe(true);
    }),
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
    }),
  );
});

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

  it.effect("writes a document the Admin SDK stores a geopoint in", () =>
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

  it.effect("writes an update the Admin SDK stores a geopoint in", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Landmark.update)(
        Landmark.update.make({ location: GeoPoint.makeUnsafe(52.52, 13.405) }),
      );
      expect(encoded.location).toBeInstanceOf(NativeGeoPoint);
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
  it.effect("writes the SDK's own reference into the app's database", () =>
    Effect.gen(function* () {
      const firestore = getFirestore(yield* App.App);
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.DocumentReference(Posts))(hello);
      expect(encoded).toBeInstanceOf(NativeDocumentReference);
      expect(
        (encoded as NativeDocumentReference).isEqual(firestore.doc("users/alice/posts/hello")),
      ).toBe(true);
    }),
  );

  it.effect("round-trips a reference through the SDK's own representation", () =>
    Effect.gen(function* () {
      const original = getFirestore(yield* App.App).doc("users/alice");
      const author = yield* Schema.decodeEffect(FirestoreSchema.DocumentReference(Users))(original);
      expect(author.collection).toBe(Users);
      expect(author.path).toBe(alice.path);
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.DocumentReference(Users))(author);
      expect((encoded as NativeDocumentReference).isEqual(original)).toBe(true);
    }),
  );

  it.effect("writes a document the Admin SDK can set as it stands", () =>
    Effect.gen(function* () {
      const firestore = getFirestore(yield* App.App);
      const encoded = yield* Schema.encodeEffect(Comment.create)(
        Comment.create.make({ body: "first", author: alice, post: hello }),
      );
      expect(encoded.author).toBeInstanceOf(NativeDocumentReference);
      expect(encoded.post).toBeInstanceOf(NativeDocumentReference);
      // `set` on a batch validates synchronously and sends nothing until a commit.
      expect(() => firestore.batch().set(firestore.doc("comments/a"), encoded)).not.toThrow();
    }),
  );
});
