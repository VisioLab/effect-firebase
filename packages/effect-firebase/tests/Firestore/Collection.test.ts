import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Collection from "../../src/Firestore/Collection.ts";

const User = Schema.Struct({ name: Schema.String });
const Post = Schema.Struct({ title: Schema.String });
const Comment = Schema.Struct({ body: Schema.String });

const Users = Collection.make("users", User);

const Posts = Users.subcollection("posts", Post);

Posts.collection(Users.id.make("test"));

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
    expect(Comments.parent).toBe(Posts);
    expect(Users.parent).toBeUndefined();
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

  it("walks up to the document it is nested under", () => {
    expect(Comments.collection(alice, hello).parent?.path).toBe("users/alice/posts/hello");
    expect(Posts.collection(alice).parent?.path).toBe("users/alice");
    expect(Users.collection().parent).toBeUndefined();
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

  it("walks up through the collection holding it", () => {
    const comment = Comments.doc(alice, hello, first);
    expect(comment.parent.path).toBe("users/alice/posts/hello/comments");
    expect(comment.parent.parent?.path).toBe("users/alice/posts/hello");
    expect(comment.parent.parent?.parent.path).toBe("users/alice/posts");
    expect(Users.doc(alice).parent.parent).toBeUndefined();
  });

  it("is also reachable from a collection reference", () => {
    expect(Posts.collection(alice).doc(hello).path).toBe(Posts.doc(alice, hello).path);
  });
});

describe("ids", () => {
  it("applies the checks of a custom id schema", () => {
    const Tenants = Collection.make("tenants", User, { id: Schema.NonEmptyString });
    expect(Tenants.id.make("acme")).toBe("acme");
    expect(() => Tenants.id.make("")).toThrow();
  });

  it("brands off the whole path, so a shared segment is not a shared id", () => {
    expectTypeOf<Collection.Id<typeof Posts>>().not.toEqualTypeOf<Collection.Id<typeof OrgPosts>>();
    expectTypeOf<Collection.Id<typeof Posts>>().not.toEqualTypeOf<Collection.Id<typeof Users>>();
  });

  it("asks for one id per ancestor, ordered from the root down", () => {
    expectTypeOf<Collection.Ancestors<typeof Users>>().toEqualTypeOf<[]>();
    expectTypeOf<Collection.Ancestors<typeof Comments>>().toEqualTypeOf<
      [Collection.Id<typeof Users>, Collection.Id<typeof Posts>]
    >();
  });

  it("does not address a collection with the wrong ids", () => {
    // @ts-expect-error a root collection takes no ancestor ids
    Users.collection(alice);
    // @ts-expect-error `posts` sits under one ancestor, not none
    Posts.collection();
    // @ts-expect-error a post id does not address a user
    Users.doc(hello);
    // @ts-expect-error the ancestors come before the document's own id
    Posts.doc(hello, alice);
    // @ts-expect-error `posts` under `orgs` is a different collection
    Posts.doc(alice, OrgPosts.id.make("hello"));
  });
});

describe("extractors", () => {
  it("recover the schema and the parent from a collection", () => {
    const schema: Collection.DocumentSchema<typeof Posts> = Post;
    const parent: Collection.Parent<typeof Posts> = Users;
    const root: Collection.Parent<typeof Users> = undefined;
    expect(schema).toBe(Post);
    expect(parent).toBe(Users);
    expect(root).toBeUndefined();
  });
});
