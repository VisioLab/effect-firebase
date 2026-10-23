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
    expect(() => make(UserPosts, UserPosts)).toThrow('more than one member at "users/{id}/posts"');
  });

  it("rejects two collections defined at the same path", () => {
    const make = CollectionGroup.make as (...members: ReadonlyArray<Collection.Any>) => unknown;
    const Drafts = Users.subcollection("posts", Post);
    expect(() => make(UserPosts, Drafts)).toThrow('more than one member at "users/{id}/posts"');
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
