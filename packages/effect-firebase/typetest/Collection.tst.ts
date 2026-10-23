import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Option, Schema } from "effect";
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
    // @ts-expect-error is missing the following properties from type '{ readonly create: Top; readonly update: Top;
    Collection.make("users", Schema.Struct({ name: Schema.String }));
  });
});

describe("subcollection", () => {
  test("refuses a plain schema, which has no `create` or `update`", () => {
    // @ts-expect-error is missing the following properties from type '{ readonly create: Top; readonly update: Top;
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
    // @ts-expect-error is not assignable to parameter of type 'IdOf<readonly [readonly ["users", typeof User]]>'
    Users.doc(hello);
  });

  test("takes the ancestor ids before the document's own id", () => {
    // @ts-expect-error is not assignable to parameter of type 'IdOf<[readonly ["users", typeof User]]>'
    Posts.doc(hello, alice);
  });

  test("refuses an id of `posts` under `orgs`, a different collection", () => {
    // @ts-expect-error Property '"users/posts"' is missing in type '{ readonly "orgs/posts": "orgs/posts"; }'
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
