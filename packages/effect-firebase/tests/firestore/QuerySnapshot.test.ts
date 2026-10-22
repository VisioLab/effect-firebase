import { describe, expect, expectTypeOf, it } from "@effect/vitest";
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
    expectTypeOf(snapshot).toEqualTypeOf<QuerySnapshot.QuerySnapshot<typeof Users>>();
    expectTypeOf(snapshot.docs).toEqualTypeOf<
      ReadonlyArray<DocumentSnapshot.Existing<typeof Users>>
    >();
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
