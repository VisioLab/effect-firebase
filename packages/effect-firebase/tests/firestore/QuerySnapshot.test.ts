import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as DocumentSnapshot from "../../src/firestore/DocumentSnapshot.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as QuerySnapshot from "../../src/firestore/QuerySnapshot.ts";

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
}) {}

const Users = Collection.make("users", User);

const alice = DocumentSnapshot.existing(Users.doc(Users.id.make("alice")), { name: "Alice" });
const bob = DocumentSnapshot.existing(Users.doc(Users.id.make("bob")), { name: "Bob" });

describe("make", () => {
  it("holds the documents a read found, in the order it found them", () => {
    const snapshot = QuerySnapshot.make([alice, bob]);
    expect(snapshot.docs).toEqual([alice, bob]);
  });

  it("holds no documents where a read found none", () => {
    expect(QuerySnapshot.make<typeof Users>([]).docs).toEqual([]);
  });
});

describe("guards", () => {
  it("tell a query snapshot apart from anything else", () => {
    expect(QuerySnapshot.isQuerySnapshot(QuerySnapshot.make([alice]))).toBe(true);
    expect(QuerySnapshot.isQuerySnapshot([alice])).toBe(false);
    expect(QuerySnapshot.isQuerySnapshot({ docs: [alice] })).toBe(false);
    expect(QuerySnapshot.isQuerySnapshot(alice)).toBe(false);
  });
});

describe("toJSON", () => {
  it("shows the documents it holds", () => {
    expect(QuerySnapshot.make([alice]).toJSON()).toEqual({
      _id: "QuerySnapshot",
      docs: [
        {
          _id: "DocumentSnapshot",
          _tag: "Existing",
          ref: "users/alice",
          raw: { name: "Alice" },
        },
      ],
    });
  });
});

describe("extra", () => {
  it("is carried by a query snapshot, and shown when it prints next to its documents' own", () => {
    const carol = DocumentSnapshot.existing(
      Users.doc(Users.id.make("carol")),
      { name: "Carol" },
      { metadata: { fromCache: false, hasPendingWrites: true } },
    );
    const snapshot = QuerySnapshot.make([carol], {
      metadata: { fromCache: true, hasPendingWrites: false },
    });
    expect(snapshot.metadata).toEqual({ fromCache: true, hasPendingWrites: false });
    expect(snapshot.docs[0]).toBe(carol);
    expect(snapshot.toJSON()).toEqual({
      _id: "QuerySnapshot",
      docs: [
        {
          _id: "DocumentSnapshot",
          _tag: "Existing",
          ref: "users/carol",
          raw: { name: "Carol" },
          metadata: { fromCache: false, hasPendingWrites: true },
        },
      ],
      metadata: { fromCache: true, hasPendingWrites: false },
    });
  });
});

describe("decode", () => {
  it.effect("reads every document through its model, in the order the read found them", () =>
    Effect.gen(function* () {
      const decoded = yield* QuerySnapshot.decode(QuerySnapshot.make([alice, bob]));
      expect(decoded.docs.map((doc) => doc.data)).toEqual([
        new User({ name: "Alice" }),
        new User({ name: "Bob" }),
      ]);
      expect(decoded.docs[0]?.data).toBeInstanceOf(User);
      expect(decoded.docs[0]?.ref.path).toBe("users/alice");
      expect(decoded.docs[0]?.raw).toBe(alice.raw);
    }),
  );

  it.effect("fails as a whole when any document does not match its model", () =>
    Effect.gen(function* () {
      const broken = DocumentSnapshot.existing(Users.doc(Users.id.make("eve")), { name: 42 });
      const error = yield* Effect.flip(QuerySnapshot.decode(QuerySnapshot.make([alice, broken])));
      assert(Schema.isSchemaError(error));
    }),
  );

  it.effect("decodes each document of a Collection Group through the collection it is in", () =>
    Effect.gen(function* () {
      class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}
      class UserPost extends FirestoreModel.Class<UserPost>("UserPost")({
        title: Schema.String,
      }) {}
      class OrgPost extends FirestoreModel.Class<OrgPost>("OrgPost")({
        headline: Schema.String,
      }) {}
      const UserPosts = Users.subcollection("posts", UserPost);
      const Orgs = Collection.make("orgs", Org);
      const OrgPosts = Orgs.subcollection("posts", OrgPost);
      const userPost = DocumentSnapshot.existing(
        UserPosts.doc(Users.id.make("alice"), UserPosts.id.make("p1")),
        { title: "Hello" },
      );
      const orgPost = DocumentSnapshot.existing(
        OrgPosts.doc(Orgs.id.make("acme"), OrgPosts.id.make("p2")),
        { headline: "News" },
      );
      const decoded = yield* QuerySnapshot.decode(
        QuerySnapshot.make<typeof UserPosts | typeof OrgPosts>([userPost, orgPost]),
      );
      expect(decoded.docs[0]?.data).toBeInstanceOf(UserPost);
      expect(decoded.docs[1]?.data).toBeInstanceOf(OrgPost);
    }),
  );

  it.effect("keeps the extra of the read and of each document", () =>
    Effect.gen(function* () {
      const carol = DocumentSnapshot.existing(
        Users.doc(Users.id.make("carol")),
        { name: "Carol" },
        { metadata: { fromCache: false, hasPendingWrites: true } },
      );
      const decoded = yield* QuerySnapshot.decode(
        QuerySnapshot.make([carol], { metadata: { fromCache: true, hasPendingWrites: false } }),
      );
      expect(decoded).toHaveProperty("metadata", { fromCache: true, hasPendingWrites: false });
      expect(decoded.docs[0]?.metadata).toEqual({ fromCache: false, hasPendingWrites: true });
      expect(decoded.toJSON()).toEqual({
        _id: "QuerySnapshot",
        docs: [
          {
            _id: "DocumentSnapshot",
            _tag: "Existing",
            ref: "users/carol",
            data: { name: "Carol" },
            metadata: { fromCache: false, hasPendingWrites: true },
          },
        ],
        metadata: { fromCache: true, hasPendingWrites: false },
      });
    }),
  );
});
