import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Equal, Hash, HashSet, Option, Schema } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
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

  it("only takes a model, which carries the shapes a document is written in", () => {
    // @ts-expect-error a plain schema has no `create` or `update`
    Collection.make("users", Schema.Struct({ name: Schema.String }));
    // @ts-expect-error a plain schema has no `create` or `update`
    Users.subcollection("posts", Schema.Struct({ title: Schema.String }));
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

describe("ids", () => {
  it("is minted from a string and nothing else", () => {
    expectTypeOf<Parameters<typeof Users.id.make>[0]>().toEqualTypeOf<string>();
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

describe("fromPath", () => {
  it("references the document found at a path", () => {
    const ref = Option.getOrThrow(
      Collection.fromPath(Comments, "users/alice/posts/hello/comments/first"),
    );
    expect(Equal.equals(ref, Comments.doc(alice, hello, first))).toBe(true);
    expectTypeOf(ref).toEqualTypeOf<Collection.DocumentReference<typeof Comments>>();
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

describe("fromPathUntyped", () => {
  it("references the document at a path, whichever collection it was defined through", () => {
    const ref = Option.getOrThrow(Collection.fromPathUntyped("users/alice/posts/hello"));
    expect(Collection.isDocumentReference(ref)).toBe(true);
    expect(ref.path).toBe("users/alice/posts/hello");
    expect(ref.id).toBe("hello");
    expect(ref.ancestors).toEqual(["alice"]);
    expect(ref.parent.path).toBe("users/alice/posts");
    expect(ref.collection.path).toEqual(["users", "posts"]);
  });

  it("gives equal references for the same path", () => {
    const self = Collection.fromPathUntyped("users/alice/posts/hello");
    const that = Collection.fromPathUntyped("users/alice/posts/hello");
    expect(Equal.equals(self, that)).toBe(true);
    expect(Hash.hash(self)).toBe(Hash.hash(that));
    expect(Equal.equals(self, Collection.fromPathUntyped("users/bob/posts/hello"))).toBe(false);
  });

  it("is not a reference the collections defined here would build", () => {
    const ref = Option.getOrThrow(Collection.fromPathUntyped("users/alice/posts/hello"));
    expect(Equal.equals(ref, Posts.doc(alice, hello))).toBe(false);
  });

  it("refuses a path that does not address a document", () => {
    expect(Option.isNone(Collection.fromPathUntyped("users"))).toBe(true);
    expect(Option.isNone(Collection.fromPathUntyped("users/alice/posts"))).toBe(true);
    expect(Option.isNone(Collection.fromPathUntyped("users//posts/hello"))).toBe(true);
    expect(Option.isNone(Collection.fromPathUntyped(""))).toBe(true);
  });
});

describe("extractors", () => {
  it("recover the schema of the documents in a collection", () => {
    const schema: Collection.DocumentSchema<typeof Posts> = Post;
    expect(schema).toBe(Post);
  });
});

describe("guards", () => {
  it("tell the three apart", () => {
    const posts = Posts.collection(alice);
    const post = posts.doc(hello);

    expect(Collection.isCollection(Posts)).toBe(true);
    expect(Collection.isCollection(posts)).toBe(false);
    expect(Collection.isCollectionReference(posts)).toBe(true);
    expect(Collection.isCollectionReference(post)).toBe(false);
    expect(Collection.isDocumentReference(post)).toBe(true);
    expect(Collection.isDocumentReference(Posts)).toBe(false);
    expect(Collection.isCollection({})).toBe(false);
  });
});

describe("inspection", () => {
  it("prints the path rather than the whole definition", () => {
    expect(Posts.toJSON()).toEqual({ _id: "Collection", path: "users/posts" });
    expect(Posts.collection(alice).toJSON()).toEqual({
      _id: "CollectionReference",
      path: "users/alice/posts",
    });
    expect(Posts.doc(alice, hello).toJSON()).toEqual({
      _id: "DocumentReference",
      path: "users/alice/posts/hello",
    });
    expect(Posts.doc(alice, hello).toString()).toContain("users/alice/posts/hello");
  });
});

describe("equality", () => {
  /** Same path, but documents that decode differently. */
  class OtherPost extends FirestoreModel.Class<OtherPost>("OtherPost")({ title: Schema.String }) {}
  const OtherPosts = Users.subcollection("posts", OtherPost);

  it("compares references by where they point", () => {
    expect(Equal.equals(Posts.doc(alice, hello), Posts.doc(alice, hello))).toBe(true);
    expect(Equal.equals(Posts.collection(alice), Posts.collection(alice))).toBe(true);
    expect(Equal.equals(Posts.doc(alice, hello), Posts.doc(alice, Posts.id.make("other")))).toBe(
      false,
    );
  });

  it("does not confuse a collection with a document at the same path", () => {
    expect(Equal.equals(Posts.collection(alice), Posts.doc(alice, hello))).toBe(false);
  });

  it("separates references built from different definitions", () => {
    expect(Equal.equals(Posts.doc(alice, hello), OtherPosts.doc(alice, hello))).toBe(false);
  });

  it("hashes consistently with equality", () => {
    expect(Hash.hash(Posts.doc(alice, hello))).toBe(Hash.hash(Posts.doc(alice, hello)));
    expect(Hash.hash(Posts.collection(alice))).toBe(Hash.hash(Posts.collection(alice)));
  });

  it("deduplicates in a HashSet", () => {
    const set = HashSet.make(
      Posts.doc(alice, hello),
      Posts.doc(alice, hello),
      Posts.doc(alice, Posts.id.make("other")),
      OtherPosts.doc(alice, hello),
    );
    expect(HashSet.size(set)).toBe(3);
  });
});
