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

describe("make", () => {
  test("holds the collection it was defined from", () => {
    expect(AllUserPosts).type.toBe<CollectionGroup.CollectionGroup<typeof UserPosts>>();
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
});
