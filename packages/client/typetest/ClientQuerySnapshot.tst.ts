import type * as ClientDocumentSnapshot from "@visiolab/effect-firebase-client/firestore/ClientDocumentSnapshot";
import * as ClientQuerySnapshot from "@visiolab/effect-firebase-client/firestore/ClientQuerySnapshot";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import { Schema } from "effect";
import { describe, expect, test } from "tstyche";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);

describe("ClientQuerySnapshot", () => {
  test("is a Query Snapshot as well", () => {
    expect<ClientQuerySnapshot.ClientQuerySnapshot<typeof Posts>>().type.toBeAssignableTo<
      QuerySnapshot.QuerySnapshot<typeof Posts>
    >();
  });
});

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}

const UserPosts = Collection.make("users", User).subcollection("posts", Post);
const OrgPosts = Collection.make("orgs", Org).subcollection("posts", Post);

describe("docs", () => {
  test("holds each document as a snapshot of the one collection it is in", () => {
    expect<
      ClientQuerySnapshot.ClientQuerySnapshot<typeof UserPosts | typeof OrgPosts>["docs"]
    >().type.toBe<
      ReadonlyArray<
        | ClientDocumentSnapshot.Existing<typeof UserPosts>
        | ClientDocumentSnapshot.Existing<typeof OrgPosts>
      >
    >();
  });
});
