import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Array as Arr, Effect, Option, Schema } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as Snapshot from "../../src/firestore/Snapshot.ts";

const Post = Schema.Struct({ title: Schema.String, views: Schema.Finite });
type Post = { readonly title: string; readonly views: number };

const Users = Collection.make("users", Schema.Struct({ name: Schema.String }));
const Posts = Users.subcollection("posts", Post);

const alice = Users.id.make("alice");
const hello = Posts.id.make("hello");
const ref = Posts.doc(alice, hello);

/**
 * A stand-in for a reading, since nothing in this module builds one.
 *
 * The cast is the point: what is under test is what the types say about a
 * reading and what {@link Snapshot.exists} reads off it, not how one comes to
 * be - which is the business of whoever performed the read.
 */
const stub = (exists: boolean): Snapshot.DocumentSnapshot<typeof Posts> =>
  ({ ref, id: hello, exists }) as unknown as Snapshot.DocumentSnapshot<typeof Posts>;

describe("DocumentSnapshot", () => {
  it("decodes to the document the collection was defined with, or to nothing", () => {
    expectTypeOf<Snapshot.DocumentSnapshot<typeof Posts>["data"]>().toEqualTypeOf<
      Effect.Effect<Option.Option<Post>, Schema.SchemaError>
    >();
  });

  it("brands the id off the collection it was read from", () => {
    expectTypeOf<Snapshot.DocumentSnapshot<typeof Posts>["id"]>().toEqualTypeOf<
      Collection.Id<typeof Posts>
    >();
  });

  it("is a reading of one collection and not another", () => {
    const post = stub(true);
    // @ts-expect-error a reading of a post is not a reading of a user
    const user: Snapshot.DocumentSnapshot<typeof Users> = post;
    expect(user).toBe(post);
  });
});

describe("QueryDocumentSnapshot", () => {
  it("cannot come up empty", () => {
    expectTypeOf<Snapshot.QueryDocumentSnapshot<typeof Posts>["data"]>().toEqualTypeOf<
      Effect.Effect<Option.Some<Post>, Schema.SchemaError>
    >();
  });

  it("stands in wherever a reading that may not have been there is asked for", () => {
    expectTypeOf<Snapshot.QueryDocumentSnapshot<typeof Posts>>().toExtend<
      Snapshot.DocumentSnapshot<typeof Posts>
    >();
  });
});

describe("exists", () => {
  it("narrows a reading to one whose contents are only ever there", () => {
    const snapshot = stub(true);
    if (Snapshot.exists(snapshot)) {
      expectTypeOf(snapshot.data).toEqualTypeOf<
        Effect.Effect<Option.Some<Post>, Schema.SchemaError>
      >();
    } else {
      expect.unreachable();
    }
  });

  it("leaves the contents optional until it is checked", () => {
    expectTypeOf(stub(true).data).toEqualTypeOf<
      Effect.Effect<Option.Option<Post>, Schema.SchemaError>
    >();
  });

  it("reads as a filter", () => {
    const answered = Arr.filter([stub(true), stub(false)], Snapshot.exists);
    expectTypeOf(answered).toEqualTypeOf<Array<Snapshot.QueryDocumentSnapshot<typeof Posts>>>();
    expect(answered).toHaveLength(1);
  });
});

describe("make", () => {
  /** Stands in for the SDK call that builds a document's fields. */
  const materialize = Effect.sync(() => {
    calls++;
    return { title: "Hello", views: 12 };
  });
  let calls = 0;

  it.effect("does not reach for the contents until they are read", () =>
    Effect.gen(function* () {
      calls = 0;
      const snapshot = Snapshot.make(ref, materialize);
      expect(calls).toBe(0);

      expect(yield* snapshot.data).toStrictEqual(Option.some({ title: "Hello", views: 12 }));
      expect(calls).toBe(1);
    }),
  );

  it.effect("reads the document afresh, the way an SDK hands it over", () =>
    Effect.gen(function* () {
      calls = 0;
      const snapshot = Snapshot.make(ref, materialize);

      const first = yield* snapshot.data;
      const second = yield* snapshot.data;

      expect(calls).toBe(2);
      expect(first).toStrictEqual(second);
      expect(Option.getOrThrow(first)).not.toBe(Option.getOrThrow(second));
    }),
  );

  it.effect("fails where the contents are read, not where they were fetched", () =>
    Effect.gen(function* () {
      const snapshot = Snapshot.make(ref, Effect.succeed({ title: "Hello", views: "twelve" }));
      const error = yield* Effect.flip(snapshot.data);
      expect(error._tag).toBe("SchemaError");
    }),
  );
});

describe("missing", () => {
  it.effect("comes up empty rather than failing", () =>
    Effect.gen(function* () {
      expect(yield* Snapshot.missing(ref).data).toStrictEqual(Option.none());
    }),
  );
});

describe("guards", () => {
  it("does not take a reference, or anything else, for a reading", () => {
    expect(Snapshot.isDocumentSnapshot(ref)).toBe(false);
    expect(Snapshot.isDocumentSnapshot(Posts)).toBe(false);
    expect(Snapshot.isDocumentSnapshot({ exists: true })).toBe(false);
    expect(Snapshot.isDocumentSnapshot(null)).toBe(false);
  });
});
