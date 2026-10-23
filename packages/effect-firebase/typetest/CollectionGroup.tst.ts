import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { type Option, Schema } from "effect";
import { describe, expect, test } from "tstyche";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}

const Users = Collection.make("users", User);
const UserPosts = Users.subcollection("posts", Post);
const AllUserPosts = CollectionGroup.make(UserPosts);

class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}
class OrgPost extends FirestoreModel.Class<OrgPost>("OrgPost")({ headline: Schema.String }) {}

const Orgs = Collection.make("orgs", Org);
const OrgPosts = Orgs.subcollection("posts", OrgPost);
const RootPosts = Collection.make("posts", Post);
const AllPosts = CollectionGroup.make(UserPosts, OrgPosts, RootPosts);

describe("make", () => {
  test("holds the collection it was defined from", () => {
    expect(AllUserPosts).type.toBe<CollectionGroup.CollectionGroup<typeof UserPosts>>();
  });

  test("holds each of several collections sharing their collection id", () => {
    expect(AllPosts).type.toBe<
      CollectionGroup.CollectionGroup<typeof UserPosts | typeof OrgPosts | typeof RootPosts>
    >();
  });

  test("refuses collections that do not share their collection id", () => {
    // @ts-expect-error member 'orgs' does not share the collection id 'posts'
    CollectionGroup.make(UserPosts, Orgs);
  });

  test("refuses a collection whose collection id differs from the first's", () => {
    // @ts-expect-error member 'posts' does not share the collection id 'users'
    CollectionGroup.make(Users, UserPosts);
  });

  test("refuses a collection listed twice", () => {
    // @ts-expect-error member 'posts' is listed more than once
    CollectionGroup.make(UserPosts, OrgPosts, UserPosts);
  });

  test("needs at least one collection", () => {
    // @ts-expect-error Expected at least 1 arguments, but got 0
    CollectionGroup.make();
  });
});

describe("Members", () => {
  test("extracts the collections of a group", () => {
    expect<CollectionGroup.Members<typeof AllUserPosts>>().type.toBe<typeof UserPosts>();
  });

  test("extracts each of several collections of a group", () => {
    expect<CollectionGroup.Members<typeof AllPosts>>().type.toBe<
      typeof UserPosts | typeof OrgPosts | typeof RootPosts
    >();
  });
});

describe("isCollectionGroup", () => {
  test("narrows to any Collection Group", () => {
    const u: unknown = AllUserPosts;
    if (CollectionGroup.isCollectionGroup(u)) {
      expect(u).type.toBe<CollectionGroup.Any>();
    }
  });
});

describe("fromPath", () => {
  test("references a document of the collection it lives in", () => {
    expect(CollectionGroup.fromPath(AllUserPosts, "users/alice/posts/hello")).type.toBe<
      Option.Option<Collection.DocumentReference<typeof UserPosts>>
    >();
  });

  test("references a document of whichever of several collections it lives in", () => {
    expect(CollectionGroup.fromPath(AllPosts, "orgs/acme/posts/hello")).type.toBe<
      Option.Option<
        | Collection.DocumentReference<typeof UserPosts>
        | Collection.DocumentReference<typeof OrgPosts>
        | Collection.DocumentReference<typeof RootPosts>
      >
    >();
  });
});
