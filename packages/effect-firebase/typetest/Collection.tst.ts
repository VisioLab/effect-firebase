import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { type Effect, Option, Schema } from "effect";
import { describe, expect, test } from "tstyche";

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

describe("make", () => {
  test("refuses a plain schema, which has no `create` or `update`", () => {
    // @ts-expect-error : create, update, updateUnchecked
    Collection.make("users", Schema.Struct({ name: Schema.String }));
  });
});

describe("subcollection", () => {
  test("refuses a plain schema, which has no `create` or `update`", () => {
    // @ts-expect-error : create, update, updateUnchecked
    Users.subcollection("posts", Schema.Struct({ title: Schema.String }));
  });
});

describe("Id", () => {
  test("is minted from a string and nothing else", () => {
    expect<Parameters<typeof Users.id.make>[0]>().type.toBe<string>();
  });

  test("brands off the whole path, so a shared segment is not a shared id", () => {
    expect<Collection.Id<typeof Posts>>().type.not.toBe<Collection.Id<typeof OrgPosts>>();
  });

  test("differs between a collection and its subcollection", () => {
    expect<Collection.Id<typeof Posts>>().type.not.toBe<Collection.Id<typeof Users>>();
  });
});

describe("Ancestors", () => {
  test("is empty for a root collection", () => {
    expect<Collection.Ancestors<typeof Users>>().type.toBe<[]>();
  });

  test("asks for one id per ancestor, ordered from the root down", () => {
    expect<Collection.Ancestors<typeof Comments>>().type.toBe<
      [Collection.Id<typeof Users>, Collection.Id<typeof Posts>]
    >();
  });
});

describe("collection", () => {
  test("takes no ancestor ids for a root collection", () => {
    // @ts-expect-error Expected 0 arguments, but got 1.
    Users.collection(alice);
  });

  test("needs one ancestor id for `posts`, not none", () => {
    // @ts-expect-error Expected 1 arguments, but got 0.
    Posts.collection();
  });
});

describe("doc", () => {
  test("refuses a post id where a user id belongs", () => {
    // @ts-expect-error Property 'users' is missing
    Users.doc(hello);
  });

  test("takes the ancestor ids before the document's own id", () => {
    // @ts-expect-error Property 'users' is missing
    Posts.doc(hello, alice);
  });

  test("refuses an id of `posts` under `orgs`, a different collection", () => {
    // @ts-expect-error Property '"users/posts"' is missing
    Posts.doc(alice, OrgPosts.id.make("hello"));
  });
});

describe("fromPath", () => {
  test("references a document of the collection it was given", () => {
    expect(
      Option.getOrThrow(Collection.fromPath(Comments, "users/alice/posts/hello/comments/first")),
    ).type.toBe<Collection.DocumentReference<typeof Comments>>();
  });
});

describe("contains", () => {
  const post = Posts.doc(alice, hello);
  const ref = post as
    | Collection.DocumentReference<typeof Posts>
    | Collection.DocumentReference<typeof OrgPosts>;
  const existing = DocumentSnapshot.existing(post, {}) as
    | DocumentSnapshot.Existing<typeof Posts>
    | DocumentSnapshot.Existing<typeof OrgPosts>;
  const missing = DocumentSnapshot.missing(post) as
    | DocumentSnapshot.Missing<typeof Posts>
    | DocumentSnapshot.Missing<typeof OrgPosts>;

  test("narrows a Document Reference to the collection", () => {
    if (Posts.contains(ref)) {
      expect(ref).type.toBe<Collection.DocumentReference<typeof Posts>>();
      expect(ref.id).type.toBe<Collection.Id<typeof Posts>>();
      expect(ref.ancestors).type.toBe<Readonly<[Collection.Id<typeof Users>]>>();
    }
  });

  test("narrows a Document Reference of any collection", () => {
    const any = ref as Collection.DocumentReference<Collection.Any>;
    if (Posts.contains(any)) {
      expect(any.id).type.toBe<Collection.Id<typeof Posts>>();
    }
  });

  test("narrows an existing Document Snapshot to the collection", () => {
    if (Posts.contains(existing)) {
      expect(existing).type.toBe<DocumentSnapshot.Existing<typeof Posts>>();
      expect(existing.id).type.toBe<Collection.Id<typeof Posts>>();
      expect(existing.ref.ancestors).type.toBe<Readonly<[Collection.Id<typeof Users>]>>();
      expect(existing.ref).type.toBe<Collection.DocumentReference<typeof Posts>>();
      expect(existing.data).type.toBe<Effect.Effect<Post, Schema.SchemaError>>();
    }
  });

  test("narrows a missing Document Snapshot to the collection", () => {
    if (Posts.contains(missing)) {
      expect(missing).type.toBe<DocumentSnapshot.Missing<typeof Posts>>();
      expect(missing.id).type.toBe<Collection.Id<typeof Posts>>();
      expect(missing.ref).type.toBe<Collection.DocumentReference<typeof Posts>>();
    }
  });

  test("narrows a Document Snapshot of either kind, keeping its kind open", () => {
    const snapshot = existing as
      | DocumentSnapshot.DocumentSnapshot<typeof Posts>
      | DocumentSnapshot.DocumentSnapshot<typeof OrgPosts>;
    if (Posts.contains(snapshot)) {
      expect(snapshot).type.toBe<DocumentSnapshot.DocumentSnapshot<typeof Posts>>();
    }
  });

  test("narrows the elements of an array when passed to `filter`", () => {
    const docs: ReadonlyArray<
      DocumentSnapshot.Existing<typeof Posts> | DocumentSnapshot.Existing<typeof OrgPosts>
    > = [];
    expect(docs.filter(Posts.contains)).type.toBe<Array<DocumentSnapshot.Existing<typeof Posts>>>();
  });

  test("refuses what is neither a Document Reference nor a Document Snapshot", () => {
    // @ts-expect-error is not assignable to parameter
    Posts.contains(Posts.collection(alice));
  });
});
