import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import { Schema } from "effect";
import { describe, expect, test } from "tstyche";

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
}) {}

const Users = Collection.make("users", User);

const alice = DocumentSnapshot.existing(Users.doc(Users.id.make("alice")), { name: "Alice" });
const bob = DocumentSnapshot.existing(Users.doc(Users.id.make("bob")), { name: "Bob" });

/** What an SDK might know about each document it read. */
interface Metadata {
  readonly fromCache: boolean;
}
const carol = DocumentSnapshot.existing(
  Users.doc(Users.id.make("carol")),
  { name: "Carol" },
  { metadata: { fromCache: false } as Metadata },
);

describe("make", () => {
  test("holds the documents of the collection they were read from", () => {
    expect(QuerySnapshot.make([alice, bob])).type.toBe<QuerySnapshot.QuerySnapshot<typeof Users>>();
  });

  test("yields existing Document Snapshots of that collection", () => {
    expect(QuerySnapshot.make([alice, bob]).docs).type.toBe<
      ReadonlyArray<DocumentSnapshot.Existing<typeof Users>>
    >();
  });

  test("keeps the extra its documents carry on each of them", () => {
    expect(QuerySnapshot.make([carol])).type.toBe<
      QuerySnapshot.QuerySnapshot<typeof Users, { metadata: Metadata }>
    >();
    expect(QuerySnapshot.make([carol]).docs[0].metadata).type.toBe<Metadata>();
  });

  test("keeps the read's own extra beside its documents' extra", () => {
    expect(QuerySnapshot.make([carol], { metadata: { fromCache: true } as Metadata })).type.toBe<
      QuerySnapshot.QuerySnapshot<typeof Users, { metadata: Metadata }> & { metadata: Metadata }
    >();
  });
});

class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}
class UserPost extends FirestoreModel.Class<UserPost>("UserPost")({ title: Schema.String }) {}
class OrgPost extends FirestoreModel.Class<OrgPost>("OrgPost")({ headline: Schema.String }) {}

const UserPosts = Users.subcollection("posts", UserPost);
const OrgPosts = Collection.make("orgs", Org).subcollection("posts", OrgPost);

describe("QuerySnapshot", () => {
  test("with no extra holds documents that carry none", () => {
    expect<QuerySnapshot.QuerySnapshot<typeof Users>>().type.toBe<
      QuerySnapshot.QuerySnapshot<typeof Users, {}>
    >();
  });

  test("holds each document with the extra it carries", () => {
    expect<QuerySnapshot.QuerySnapshot<typeof Users, { metadata: Metadata }>["docs"]>().type.toBe<
      ReadonlyArray<DocumentSnapshot.Existing<typeof Users> & { metadata: Metadata }>
    >();
  });

  test("holds each document as a snapshot of the one collection it is in", () => {
    expect<QuerySnapshot.QuerySnapshot<typeof UserPosts | typeof OrgPosts>["docs"]>().type.toBe<
      ReadonlyArray<
        DocumentSnapshot.Existing<typeof UserPosts> | DocumentSnapshot.Existing<typeof OrgPosts>
      >
    >();
  });

  test("of one collection is a Query Snapshot of that collection and others", () => {
    expect<QuerySnapshot.QuerySnapshot<typeof UserPosts>>().type.toBeAssignableTo<
      QuerySnapshot.QuerySnapshot<typeof UserPosts | typeof OrgPosts>
    >();
  });
});
