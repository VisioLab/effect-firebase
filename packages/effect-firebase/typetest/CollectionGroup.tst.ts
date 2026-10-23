import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Schema } from "effect";
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
    // @ts-expect-error member 'posts' has the same path as another member
    CollectionGroup.make(UserPosts, OrgPosts, UserPosts);
  });

  test("refuses two collections defined at the same path", () => {
    class Draft extends FirestoreModel.Class<Draft>("Draft")({ body: Schema.String }) {}
    const UserDrafts = Users.subcollection("posts", Draft);
    // @ts-expect-error member 'posts' has the same path as another member
    CollectionGroup.make(UserPosts, UserDrafts);
  });

  test("leaves a path only known as a string to be checked when the group is defined", () => {
    const segment: string = "posts";
    const Posts = Collection.make(segment, Post);
    const Others = Collection.make(segment, Post);
    expect(CollectionGroup.make(Posts, Others)).type.toBe<
      CollectionGroup.CollectionGroup<typeof Posts>
    >();
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
