import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
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
