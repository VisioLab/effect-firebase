import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as CollectionGroup from "../../src/firestore/CollectionGroup.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}

const Users = Collection.make("users", User);
const UserPosts = Users.subcollection("posts", Post);

describe("make", () => {
  it("holds the collections it was defined from, and their collection id", () => {
    const group = CollectionGroup.make(UserPosts);
    expect(group.members).toEqual([UserPosts]);
    expect(group.id).toBe("posts");
  });

  it("rejects a group with no collections in it", () => {
    const make = CollectionGroup.make as (...members: ReadonlyArray<Collection.Any>) => unknown;
    expect(() => make()).toThrow("at least one collection");
  });

  it("rejects collections that do not share their collection id", () => {
    const make = CollectionGroup.make as (...members: ReadonlyArray<Collection.Any>) => unknown;
    expect(() => make(UserPosts, Users)).toThrow('"users/{id}/posts" and "users"');
  });

  it("rejects a collection listed twice", () => {
    const make = CollectionGroup.make as (...members: ReadonlyArray<Collection.Any>) => unknown;
    expect(() => make(UserPosts, UserPosts)).toThrow('"users/{id}/posts" more than once');
  });
});

describe("isCollectionGroup", () => {
  it("tells a group apart from the collections in it", () => {
    expect(CollectionGroup.isCollectionGroup(CollectionGroup.make(UserPosts))).toBe(true);
    expect(CollectionGroup.isCollectionGroup(UserPosts)).toBe(false);
    expect(CollectionGroup.isCollectionGroup(UserPosts.collection(Users.id.make("alice")))).toBe(
      false,
    );
  });
});

describe("fromPath", () => {
  const group = CollectionGroup.make(UserPosts);

  it("references the document at a path, in the collection it lives in", () => {
    const ref = CollectionGroup.fromPath(group, "users/alice/posts/hello");
    expect(ref._tag).toBe("Some");
    if (ref._tag === "Some") {
      expect(ref.value.collection).toBe(UserPosts);
      expect(ref.value.ancestors).toEqual(["alice"]);
      expect(ref.value.id).toBe("hello");
    }
  });

  it("refuses a path no collection in it defines", () => {
    expect(CollectionGroup.fromPath(group, "orgs/acme/posts/hello")._tag).toBe("None");
    expect(CollectionGroup.fromPath(group, "posts/hello")._tag).toBe("None");
  });
});
