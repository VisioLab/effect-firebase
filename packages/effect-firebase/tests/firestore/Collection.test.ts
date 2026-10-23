import { describe, expect, it } from "@effect/vitest";
import { Equal, Option, Schema } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as DocumentSnapshot from "../../src/firestore/DocumentSnapshot.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
class Comment extends FirestoreModel.Class<Comment>("Comment")({ body: Schema.String }) {}

const Users = Collection.make("users", User);
const Posts = Users.subcollection("posts", Post);
const Comments = Posts.subcollection("comments", Comment);

/** A second `posts`, to pin down that ids brand off the path and not the segment. */
const Orgs = Collection.make("orgs", User);
const OrgPosts = Orgs.subcollection("posts", Post);

const alice = Users.id.make("alice");
const hello = Posts.id.make("hello");
const first = Comments.id.make("first");

describe("make", () => {
  it("carries the segments and the schema it was defined with", () => {
    expect(Users.path).toEqual(["users"]);
    expect(Comments.path).toEqual(["users", "posts", "comments"]);
    expect(Comments.segment).toBe("comments");
    expect(Comments.schema).toBe(Comment);
  });

  it("rejects segments Firestore cannot address", () => {
    expect(() => Collection.make("", User)).toThrow("must not be empty");
    expect(() => Collection.make("users/alice", User)).toThrow('must not contain "/"');
    expect(() => Collection.make("..", User)).toThrow('must not be "." or ".."');
    expect(() => Collection.make("__id__", User)).toThrow('must not match "__.*__"');
    expect(() => Users.subcollection("a/b", Post)).toThrow('must not contain "/"');
  });
});

describe("CollectionReference", () => {
  it("interleaves the ancestor ids with the segments", () => {
    expect(Users.collection().path).toBe("users");
    expect(Posts.collection(alice).path).toBe("users/alice/posts");
    expect(Comments.collection(alice, hello).path).toBe("users/alice/posts/hello/comments");
  });

  it("reports the collection id Firestore knows it by", () => {
    expect(Posts.collection(alice).id).toBe("posts");
    expect(Posts.collection(alice).ancestors).toEqual([alice]);
  });
});

describe("DocumentReference", () => {
  it("appends its own id to the collection path", () => {
    expect(Users.doc(alice).path).toBe("users/alice");
    expect(Posts.doc(alice, hello).path).toBe("users/alice/posts/hello");
    expect(Comments.doc(alice, hello, first).path).toBe("users/alice/posts/hello/comments/first");
  });

  it("splits the ids into the ones addressing its collection and its own", () => {
    const comment = Comments.doc(alice, hello, first);
    expect(comment.id).toBe(first);
    expect(comment.ancestors).toEqual([alice, hello]);
    expect(comment.collection).toBe(Comments);
  });

  it("keeps the collection holding it", () => {
    const comment = Comments.doc(alice, hello, first);
    expect(comment.parent.path).toBe("users/alice/posts/hello/comments");
    expect(comment.parent.collection).toBe(Comments);
  });

  it("is also reachable from a collection reference", () => {
    const posts = Posts.collection(alice);
    expect(posts.doc(hello).path).toBe(Posts.doc(alice, hello).path);
    expect(posts.doc(hello).parent).toBe(posts);
  });
});

describe("fromPath", () => {
  it("references the document found at a path", () => {
    const ref = Option.getOrThrow(
      Collection.fromPath(Comments, "users/alice/posts/hello/comments/first"),
    );
    expect(Equal.equals(ref, Comments.doc(alice, hello, first))).toBe(true);
  });

  it("refuses a path into another collection", () => {
    expect(Option.isNone(Collection.fromPath(OrgPosts, "users/alice/posts/hello"))).toBe(true);
    expect(Option.isNone(Collection.fromPath(Posts, "users/alice"))).toBe(true);
    expect(Option.isNone(Collection.fromPath(Posts, "users/alice/posts"))).toBe(true);
    expect(Option.isNone(Collection.fromPath(Users, "users/alice/posts/hello"))).toBe(true);
  });

  it("refuses an empty id", () => {
    expect(Option.isNone(Collection.fromPath(Posts, "users//posts/hello"))).toBe(true);
    expect(Option.isNone(Collection.fromPath(Users, "users/"))).toBe(true);
  });
});

describe("contains", () => {
  it("is true for a reference into the collection", () => {
    expect(Posts.contains(Posts.doc(alice, hello))).toBe(true);
  });

  it("is false for a reference into another collection, one sharing its segment included", () => {
    expect(Posts.contains(Users.doc(alice))).toBe(false);
    expect(Posts.contains(Comments.doc(alice, hello, first))).toBe(false);
    expect(Posts.contains(OrgPosts.doc(Orgs.id.make("acme"), OrgPosts.id.make("hello")))).toBe(
      false,
    );
  });

  it("is false for a separately built definition with the same path", () => {
    const OtherPosts = Collection.make("users", User).subcollection("posts", Post);
    expect(OtherPosts.contains(Posts.doc(alice, hello))).toBe(false);
  });

  it("is true for an existing or missing snapshot of a document in the collection", () => {
    const ref = Posts.doc(alice, hello);
    expect(Posts.contains(DocumentSnapshot.existing(ref, { title: "Hello" }))).toBe(true);
    expect(Posts.contains(DocumentSnapshot.missing(ref))).toBe(true);
  });

  it("is false for a snapshot of a document in another collection", () => {
    const ref = Users.doc(alice);
    expect(Posts.contains(DocumentSnapshot.existing(ref, { name: "Alice" }))).toBe(false);
    expect(Posts.contains(DocumentSnapshot.missing(ref))).toBe(false);
  });

  it("does not depend on `this`, so it can be passed on as it is", () => {
    const docs = [
      DocumentSnapshot.existing(Users.doc(alice), { name: "Alice" }),
      DocumentSnapshot.missing(Posts.doc(alice, hello)),
    ];
    expect(docs.filter(Posts.contains).map((doc) => doc.ref.path)).toEqual([
      "users/alice/posts/hello",
    ]);
  });
});
