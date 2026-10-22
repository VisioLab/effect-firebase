import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { DateTime, Effect, Equal, Option, Schema } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as FieldValue from "../../src/firestore/FieldValue.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";
import * as FirestoreValue from "../../src/firestore/FirestoreValue.ts";
import * as GeoPoint from "../../src/firestore/GeoPoint.ts";
import * as Timestamp from "../../src/firestore/Timestamp.ts";

/** Stands in for an SDK's own sentinel, which a read never hands back. */
class SdkSentinel {}

const toFirestore = <S extends Schema.Top>(schema: S) =>
  Schema.encodeUnknownEffect(FirestoreValue.toCodecFirestore(schema));

const fromFirestore = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(FirestoreValue.toCodecFirestore(schema));

describe("Timestamp", () => {
  it("is the portable Timestamp on both sides, and asks for no services", () => {
    expectTypeOf<(typeof FirestoreSchema.Timestamp)["Type"]>().toEqualTypeOf<Timestamp.Timestamp>();
    expectTypeOf<
      (typeof FirestoreSchema.Timestamp)["Encoded"]
    >().toEqualTypeOf<Timestamp.Timestamp>();
    expectTypeOf<(typeof FirestoreSchema.Timestamp)["EncodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<(typeof FirestoreSchema.Timestamp)["DecodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<
      Parameters<typeof FirestoreSchema.Timestamp.make>[0]
    >().toEqualTypeOf<Timestamp.Timestamp>();
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(FirestoreSchema.Timestamp.annotate({})).toEqualTypeOf<FirestoreSchema.Timestamp>();
  });

  it.effect("is stored as the portable Timestamp, to the nanosecond, with no layer", () =>
    Effect.gen(function* () {
      const Clip = Schema.Struct({
        at: FirestoreSchema.Timestamp,
        takes: Schema.Array(Schema.Struct({ at: FirestoreSchema.Timestamp })),
      });
      const at = Timestamp.makeUnsafe(1_700_000_000, 123_456_789);
      const encoded = yield* toFirestore(Clip)({ at, takes: [{ at }] });
      expect(encoded).toStrictEqual({ at, takes: [{ at }] });
      const decoded = yield* fromFirestore(Clip)(encoded);
      expect(Equal.equals(decoded.at, at)).toBe(true);
      expect(decoded.at.nanoseconds).toBe(123_456_789);
    }),
  );

  it.effect("refuses what is not a portable Timestamp", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(FirestoreSchema.Timestamp);
      expect(yield* Effect.flip(decode({ seconds: 0, nanoseconds: 0 }))).toBeDefined();
      expect(yield* Effect.flip(decode("2024-01-01T00:00:00Z"))).toBeDefined();
    }),
  );

  it.effect("serializes as JSON without losing the digits finer than a millisecond", () =>
    Effect.gen(function* () {
      const codec = Schema.toCodecJson(FirestoreSchema.Timestamp);
      const at = Timestamp.makeUnsafe(1, 123_456_789);
      const json = yield* Schema.encodeEffect(codec)(at);
      expect(json).toStrictEqual({ seconds: 1, nanoseconds: 123_456_789 });
      expect(Equal.equals(yield* Schema.decodeEffect(codec)(json), at)).toBe(true);
    }),
  );
});

describe("GeoPoint", () => {
  it("is the portable GeoPoint on both sides, and asks for no services", () => {
    expectTypeOf<(typeof FirestoreSchema.GeoPoint)["Encoded"]>().toEqualTypeOf<GeoPoint.GeoPoint>();
    expectTypeOf<(typeof FirestoreSchema.GeoPoint)["EncodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<(typeof FirestoreSchema.GeoPoint)["DecodingServices"]>().toEqualTypeOf<never>();
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(FirestoreSchema.GeoPoint.annotate({})).toEqualTypeOf<FirestoreSchema.GeoPoint>();
  });

  it.effect("is stored as the portable GeoPoint, with no layer", () =>
    Effect.gen(function* () {
      const Place = Schema.Struct({ where: FirestoreSchema.GeoPoint });
      const where = GeoPoint.makeUnsafe(52.52, 13.405);
      const encoded = yield* toFirestore(Place)({ where });
      expect(encoded).toStrictEqual({ where });
      const decoded = yield* fromFirestore(Place)(encoded);
      expect(Equal.equals(decoded.where, where)).toBe(true);
    }),
  );

  it.effect("refuses what is not a portable GeoPoint", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(FirestoreSchema.GeoPoint);
      expect(yield* Effect.flip(decode({ latitude: 0, longitude: 0 }))).toBeDefined();
      const encode = Schema.encodeUnknownEffect(FirestoreSchema.GeoPoint);
      expect(yield* Effect.flip(encode({ latitude: 0, longitude: 0 }))).toBeDefined();
    }),
  );
});

describe("DocumentReference", () => {
  class Member extends FirestoreModel.Class<Member>("Member")({ name: Schema.String }) {}
  class Article extends FirestoreModel.Class<Article>("Article")({ title: Schema.String }) {}

  const Users = Collection.make("users", Member);
  const Posts = Users.subcollection("posts", Article);
  const Orgs = Collection.make("orgs", Member);
  const OrgPosts = Orgs.subcollection("posts", Article);

  const Post = FirestoreSchema.DocumentReference(Posts);
  const decode = Schema.decodeUnknownEffect(Post);
  const hello = Posts.doc(Users.id.make("alice"), Posts.id.make("hello"));

  /** A reference as an SDK mapping reads it back: by its path alone. */
  const untyped = (path: string) => Option.getOrThrow(Collection.fromPathUntyped(path));

  it("is typed by the collection it points into, and asks for no services", () => {
    expectTypeOf<(typeof Post)["Type"]>().toEqualTypeOf<
      Collection.DocumentReference<typeof Posts>
    >();
    // Read back, a reference names no collection of its own.
    expectTypeOf<(typeof Post)["Encoded"]>().toEqualTypeOf<
      Collection.DocumentReference<Collection.Any>
    >();
    expectTypeOf<(typeof Post)["DecodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<(typeof Post)["EncodingServices"]>().toEqualTypeOf<never>();
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(Post.annotate({})).toEqualTypeOf<
      FirestoreSchema.DocumentReference<typeof Posts>
    >();
  });

  it.effect("decodes a reference read back by its path into one of the collection's own", () =>
    Effect.gen(function* () {
      const decoded = yield* decode(untyped("users/alice/posts/hello"));
      expect(Collection.isDocumentReference(decoded)).toBe(true);
      expect(decoded.collection).toBe(Posts);
      expect(decoded.ancestors).toEqual(["alice"]);
      expect(decoded.id).toBe("hello");
      expect(Equal.equals(decoded, hello)).toBe(true);
    }),
  );

  it("is a guard for references into the collection alone", () => {
    const isPost = Schema.is(Post);
    expect(isPost(hello)).toBe(true);
    // Re-homing by path is decoding, not a type check.
    expect(isPost(untyped(hello.path))).toBe(false);
    expect(isPost(OrgPosts.doc(Orgs.id.make("acme"), OrgPosts.id.make("hello")))).toBe(false);
  });

  it.effect("decodes one of ours unchanged", () =>
    Effect.gen(function* () {
      expect(yield* decode(hello)).toBe(hello);
    }),
  );

  it.effect("refuses a reference into another collection", () =>
    Effect.gen(function* () {
      for (const path of [
        "orgs/acme/posts/hello",
        "users/alice",
        "users/alice/posts/hello/comments/first",
      ]) {
        const failure = yield* Effect.flip(decode(untyped(path)));
        expect(String(failure)).toContain(`Expected a document in users/{id}/posts/{id}`);
      }
      const elsewhere = OrgPosts.doc(Orgs.id.make("acme"), OrgPosts.id.make("hello"));
      expect(yield* Effect.flip(decode(elsewhere))).toBeDefined();
    }),
  );

  it.effect("refuses a map that only looks like a reference", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(decode({ id: "hello", path: "users/alice/posts/hello" }));
      expect(String(failure)).toContain("users/{id}/posts/{id}");
    }),
  );

  it.effect("is stored as the portable reference, and reads back equal, with no layer", () =>
    Effect.gen(function* () {
      const Comment = Schema.Struct({ post: Post });
      const encoded = yield* toFirestore(Comment)({ post: hello });
      expect(encoded).toStrictEqual({ post: hello });
      // What an SDK mapping hands back holds the path, not the collection.
      const decoded = yield* fromFirestore(Comment)({ post: untyped(hello.path) });
      expect(Equal.equals(decoded.post, hello)).toBe(true);
    }),
  );

  it.effect("refuses to write a reference into another collection", () =>
    Effect.gen(function* () {
      const elsewhere = OrgPosts.doc(Orgs.id.make("acme"), OrgPosts.id.make("hello"));
      const failure = yield* Effect.flip(Schema.encodeUnknownEffect(Post)(elsewhere));
      expect(failure).toBeDefined();
    }),
  );

  it.effect("tells collections apart in a union", () =>
    Effect.gen(function* () {
      const Either = Schema.Union([Post, FirestoreSchema.DocumentReference(OrgPosts)]);
      const decoded = yield* Schema.decodeEffect(Either)(untyped("orgs/acme/posts/hello"));
      expect(decoded.collection).toBe(OrgPosts);
    }),
  );

  it("compares by where it points", () => {
    const equivalence = Schema.toEquivalence(Post);
    expect(equivalence(hello, Posts.doc(Users.id.make("alice"), Posts.id.make("hello")))).toBe(
      true,
    );
    expect(equivalence(hello, Posts.doc(Users.id.make("bob"), Posts.id.make("hello")))).toBe(false);
  });
});

describe("a model of them", () => {
  class Member extends FirestoreModel.Class<Member>("Member")({ name: Schema.String }) {}
  const Members = Collection.make("members", Member);

  class Venue extends FirestoreModel.Class<Venue>("Venue")({
    openedAt: FirestoreSchema.Timestamp,
    where: FirestoreSchema.GeoPoint,
    owner: FirestoreSchema.DocumentReference(Members),
  }) {}

  it("encodes with no services", () => {
    expectTypeOf<(typeof Venue)["EncodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<(typeof Venue.create)["EncodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<(typeof Venue.update)["EncodingServices"]>().toEqualTypeOf<never>();
  });
});

describe("a model of the sentinels", () => {
  class Post extends FirestoreModel.Class<Post>("Post")({
    title: Schema.String,
    publishedAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
    views: FirestoreModel.Number(Schema.Finite),
    seenAt: FirestoreModel.Array(Schema.DateTimeUtc),
    subtitle: FirestoreModel.Optional(Schema.String),
    touchedAt: FirestoreModel.FieldOnly(["create", "update"])(FirestoreSchema.ServerTimestamp),
  }) {}

  it("is written with no services", () => {
    expectTypeOf<(typeof Post.create)["EncodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<(typeof Post.update)["EncodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<(typeof Post.updateUnchecked)["EncodingServices"]>().toEqualTypeOf<never>();
  });

  it.effect("writes every sentinel as the portable sentinel, with no layer", () =>
    Effect.gen(function* () {
      const encoded = yield* toFirestore(Post.update)(
        Post.update.make({
          publishedAt: FieldValue.serverTimestamp,
          views: FieldValue.increment(2),
          seenAt: FieldValue.arrayUnion(DateTime.makeUnsafe(1_700_000_000_123)),
          subtitle: FieldValue.deleteField,
          touchedAt: FieldValue.serverTimestamp,
        }),
      );
      expect(encoded).toStrictEqual({
        publishedAt: FieldValue.serverTimestamp,
        views: FieldValue.increment(2),
        seenAt: FieldValue.arrayUnion(Timestamp.makeUnsafe(1_700_000_000, 123_000_000)),
        subtitle: FieldValue.deleteField,
        touchedAt: FieldValue.serverTimestamp,
      });
    }),
  );
});

describe("ServerTimestamp", () => {
  it.effect("is stored as the portable sentinel, with no layer", () =>
    Effect.gen(function* () {
      const encoded = yield* toFirestore(FirestoreSchema.ServerTimestamp)(
        FieldValue.serverTimestamp,
      );
      expect(encoded).toBe(FieldValue.serverTimestamp);
    }),
  );

  it.effect("refuses what is not the portable sentinel, such as an SDK's own", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(FirestoreSchema.ServerTimestamp)(new SdkSentinel()),
      );
      expect(failure).toBeDefined();
    }),
  );

  it("is the portable sentinel on both sides, and asks for no services", () => {
    expectTypeOf<
      (typeof FirestoreSchema.ServerTimestamp)["Encoded"]
    >().toEqualTypeOf<FieldValue.ServerTimestamp>();
    expectTypeOf<
      (typeof FirestoreSchema.ServerTimestamp)["EncodingServices"]
    >().toEqualTypeOf<never>();
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(
      FirestoreSchema.ServerTimestamp.annotate({}),
    ).toEqualTypeOf<FirestoreSchema.ServerTimestamp>();
  });

  it("fills itself in, since there is only one value it takes", () => {
    const Write = Schema.Struct({
      title: Schema.String,
      updatedAt: FirestoreSchema.ServerTimestamp,
    });
    expect(Write.make({ title: "hello" })).toStrictEqual({
      title: "hello",
      updatedAt: FieldValue.serverTimestamp,
    });
  });
});

describe("ServerTimestampOr", () => {
  it.effect("writes the instant it was handed as the portable Timestamp", () =>
    Effect.gen(function* () {
      const at = Timestamp.makeUnsafe(1_700_000_000, 123_000_000);
      for (const [schema, value] of [
        [FirestoreSchema.ServerTimestampOr(FirestoreSchema.Timestamp), at],
        [
          FirestoreSchema.ServerTimestampOr(Schema.DateTimeUtc),
          DateTime.makeUnsafe(1_700_000_000_123),
        ],
        [FirestoreSchema.ServerTimestampOr(Schema.Date), new Date(1_700_000_000_123)],
      ] as const) {
        const encoded = yield* toFirestore(schema)(value);
        expect(Equal.equals(encoded, at)).toBe(true);
      }
    }),
  );

  it.effect("writes the sentinel just as readily", () =>
    Effect.gen(function* () {
      const WrittenAt = FirestoreSchema.ServerTimestampOr(Schema.DateTimeUtc);
      expect(yield* toFirestore(WrittenAt)(FieldValue.serverTimestamp)).toBe(
        FieldValue.serverTimestamp,
      );
    }),
  );

  it.effect("holds the instant a read hands back however the schema it was handed holds it", () =>
    Effect.gen(function* () {
      const at = Timestamp.makeUnsafe(1_700_000_000, 123_000_000);
      const utc = yield* fromFirestore(FirestoreSchema.ServerTimestampOr(Schema.DateTimeUtc))(at);
      expect(utc).toStrictEqual(DateTime.makeUnsafe(1_700_000_000_123));
      const date = yield* fromFirestore(FirestoreSchema.ServerTimestampOr(Schema.Date))(at);
      expect(date).toStrictEqual(new Date(1_700_000_000_123));
      const timestamp = yield* fromFirestore(
        FirestoreSchema.ServerTimestampOr(FirestoreSchema.Timestamp),
      )(at);
      expect(Equal.equals(timestamp, at)).toBe(true);
    }),
  );

  it("is only built from a schema Firestore stores as a timestamp", () => {
    FirestoreSchema.ServerTimestampOr(Schema.DateTimeUtc);
    FirestoreSchema.ServerTimestampOr(Schema.Date);
    FirestoreSchema.ServerTimestampOr(FirestoreSchema.Timestamp);
    // @ts-expect-error a string is stored as a string, not a timestamp
    FirestoreSchema.ServerTimestampOr(Schema.String);
    // @ts-expect-error a DateTime written as a string is stored as a string
    FirestoreSchema.ServerTimestampOr(Schema.DateTimeUtcFromString);
  });
});

describe("Increment", () => {
  const encode = toFirestore(FirestoreSchema.Increment);

  it.effect("is stored as the portable sentinel, carrying how far the field moves", () =>
    Effect.gen(function* () {
      expect(yield* encode(FieldValue.increment(2))).toStrictEqual(FieldValue.increment(2));
    }),
  );

  it.effect("writes a move down as the negative it is", () =>
    Effect.gen(function* () {
      expect(yield* encode(FieldValue.decrement(3))).toStrictEqual(FieldValue.increment(-3));
    }),
  );

  it.effect("refuses what is not the portable sentinel, such as an SDK's own", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(FirestoreSchema.Increment)(new SdkSentinel()),
      );
      expect(failure).toBeDefined();
    }),
  );

  it("asks for no services", () => {
    expectTypeOf<(typeof FirestoreSchema.Increment)["EncodingServices"]>().toEqualTypeOf<never>();
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(FirestoreSchema.Increment.annotate({})).toEqualTypeOf<FirestoreSchema.Increment>();
  });
});

describe("IncrementOr", () => {
  const Visits = FirestoreSchema.IncrementOr(Schema.Finite);
  const encode = toFirestore(Visits);

  it.effect("writes the number it was handed", () =>
    Effect.gen(function* () {
      expect(yield* encode(7)).toBe(7);
    }),
  );

  it.effect("writes the sentinel just as readily", () =>
    Effect.gen(function* () {
      expect(yield* encode(FieldValue.increment(1))).toStrictEqual(FieldValue.increment(1));
    }),
  );

  it.effect("decodes the number it wraps, which is all a read ever holds", () =>
    Effect.gen(function* () {
      expect(yield* Schema.decodeEffect(Visits)(7)).toBe(7);
    }),
  );

  it.effect("refuses what the schema it was built from refuses", () =>
    Effect.gen(function* () {
      const decodeUnknown = Schema.decodeUnknownEffect(Visits);
      expect(yield* Effect.flip(decodeUnknown(Number.NaN))).toBeDefined();
      expect(yield* Effect.flip(decodeUnknown("7"))).toBeDefined();
    }),
  );

  it.effect("carries a tighter schema into the writes as well as the read", () =>
    Effect.gen(function* () {
      const Whole = FirestoreSchema.IncrementOr(Schema.Int);
      expect(yield* toFirestore(Whole)(7)).toBe(7);
      expect(yield* Effect.flip(toFirestore(Whole)(7.5))).toBeDefined();
      expect(yield* Effect.flip(Schema.decodeEffect(Whole)(7.5))).toBeDefined();
    }),
  );

  it("keeps the schema it was handed, rather than widening to a number", () => {
    expectTypeOf<FirestoreSchema.IncrementOr<Schema.Int>["Type"]>().toEqualTypeOf<
      number | FieldValue.Increment
    >();
  });

  it("is only built from a schema stored as a number", () => {
    // @ts-expect-error the server has no number to add to
    FirestoreSchema.IncrementOr(Schema.String);
    // @ts-expect-error read as a number, but stored as a string
    FirestoreSchema.IncrementOr(Schema.FiniteFromString);
    expectTypeOf<
      // @ts-expect-error the type is held to the same as the constructor
      FirestoreSchema.IncrementOr<Schema.String>
    >().not.toBeNever();
  });
});

describe("DeleteField", () => {
  it.effect("is stored as the portable sentinel, with no layer", () =>
    Effect.gen(function* () {
      expect(yield* toFirestore(FirestoreSchema.DeleteField)(FieldValue.deleteField)).toBe(
        FieldValue.deleteField,
      );
    }),
  );

  it.effect("refuses what is not the portable sentinel, such as an SDK's own", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(FirestoreSchema.DeleteField)(new SdkSentinel()),
      );
      expect(failure).toBeDefined();
    }),
  );

  it("asks for no services", () => {
    expectTypeOf<(typeof FirestoreSchema.DeleteField)["EncodingServices"]>().toEqualTypeOf<never>();
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(
      FirestoreSchema.DeleteField.annotate({}),
    ).toEqualTypeOf<FirestoreSchema.DeleteField>();
  });
});

describe("DeleteFieldOr", () => {
  const Nickname = FirestoreSchema.DeleteFieldOr(Schema.String);
  const encode = toFirestore(Nickname);

  it.effect("writes the value it was handed", () =>
    Effect.gen(function* () {
      expect(yield* encode("ally")).toBe("ally");
    }),
  );

  it.effect("writes the sentinel just as readily", () =>
    Effect.gen(function* () {
      expect(yield* encode(FieldValue.deleteField)).toBe(FieldValue.deleteField);
    }),
  );

  it("keeps the schema it was handed", () => {
    expectTypeOf<FirestoreSchema.DeleteFieldOr<Schema.String>["Type"]>().toEqualTypeOf<
      string | FieldValue.DeleteField
    >();
  });
});

describe("ArrayUnion", () => {
  const Tags = FirestoreSchema.ArrayUnion(Schema.String);

  it.effect("is stored as the portable sentinel, holding the elements the array is to gain", () =>
    Effect.gen(function* () {
      expect(yield* toFirestore(Tags)(FieldValue.arrayUnion("a", "b"))).toStrictEqual(
        FieldValue.arrayUnion("a", "b"),
      );
    }),
  );

  it.effect("encodes each element through the schema it was built from", () =>
    Effect.gen(function* () {
      const Counts = FirestoreSchema.ArrayUnion(Schema.FiniteFromString);
      expect(yield* toFirestore(Counts)(FieldValue.arrayUnion(1, 2))).toStrictEqual(
        FieldValue.arrayUnion("1", "2"),
      );
    }),
  );

  it.effect("stores each element as Firestore stores it, so an instant is a Timestamp", () =>
    Effect.gen(function* () {
      const SeenAt = FirestoreSchema.ArrayUnion(Schema.DateTimeUtc);
      const encoded = yield* toFirestore(SeenAt)(
        FieldValue.arrayUnion(DateTime.makeUnsafe(1_700_000_000_123)),
      );
      expect(encoded).toStrictEqual(
        FieldValue.arrayUnion(Timestamp.makeUnsafe(1_700_000_000, 123_000_000)),
      );
      expect(FirestoreValue.isFirestoreValue(encoded)).toBe(true);
    }),
  );

  it.effect("refuses an element the schema it was built from refuses", () =>
    Effect.gen(function* () {
      const Whole = FirestoreSchema.ArrayUnion(Schema.Int);
      const failure = yield* Effect.flip(toFirestore(Whole)(FieldValue.arrayUnion(1, 1.5)));
      expect(String(failure)).toContain(`["elements"][1]`);
    }),
  );

  it.effect("refuses what is not the portable sentinel, such as an SDK's own", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(Schema.decodeUnknownEffect(Tags)(new SdkSentinel()));
      expect(failure).toBeDefined();
    }),
  );

  it("asks for no services, only whatever its elements ask for", () => {
    expectTypeOf<(typeof Tags)["EncodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<(typeof Tags)["Type"]>().toEqualTypeOf<FieldValue.ArrayUnion<string>>();
  });

  it("compares by the elements, as the schema it was built from compares them", () => {
    const equivalence = Schema.toEquivalence(FirestoreSchema.ArrayUnion(Schema.DateTimeUtc));
    const at = (millis: number) => DateTime.makeUnsafe(millis);
    expect(
      equivalence(FieldValue.arrayUnion(at(1), at(2)), FieldValue.arrayUnion(at(1), at(2))),
    ).toBe(true);
    expect(equivalence(FieldValue.arrayUnion(at(1)), FieldValue.arrayUnion(at(2)))).toBe(false);
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(Tags.annotate({})).toEqualTypeOf<FirestoreSchema.ArrayUnion<Schema.String>>();
  });
});

describe("ArrayRemove", () => {
  const Tags = FirestoreSchema.ArrayRemove(Schema.String);

  it.effect("is stored as the portable sentinel, holding the elements the array is to lose", () =>
    Effect.gen(function* () {
      expect(yield* toFirestore(Tags)(FieldValue.arrayRemove("a"))).toStrictEqual(
        FieldValue.arrayRemove("a"),
      );
    }),
  );

  it.effect("encodes each element through the schema it was built from", () =>
    Effect.gen(function* () {
      const Seen = FirestoreSchema.ArrayRemove(Schema.Struct({ count: Schema.FiniteFromString }));
      expect(yield* toFirestore(Seen)(FieldValue.arrayRemove({ count: 1 }))).toStrictEqual(
        FieldValue.arrayRemove({ count: "1" }),
      );
    }),
  );

  it.effect("stores each element as Firestore stores it, so an instant is a Timestamp", () =>
    Effect.gen(function* () {
      const SeenAt = FirestoreSchema.ArrayRemove(Schema.Date);
      expect(
        yield* toFirestore(SeenAt)(FieldValue.arrayRemove(new Date(1_700_000_000_123))),
      ).toStrictEqual(FieldValue.arrayRemove(Timestamp.makeUnsafe(1_700_000_000, 123_000_000)));
    }),
  );

  it.effect("refuses what is not the portable sentinel, such as an SDK's own", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(Schema.decodeUnknownEffect(Tags)(new SdkSentinel()));
      expect(failure).toBeDefined();
    }),
  );

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(Tags.annotate({})).toEqualTypeOf<FirestoreSchema.ArrayRemove<Schema.String>>();
  });
});

describe("ArrayOr", () => {
  const Tags = FirestoreSchema.ArrayOr(Schema.String);
  const encode = toFirestore(Tags);

  it.effect("writes the array it was handed", () =>
    Effect.gen(function* () {
      expect(yield* encode(["a", "b"])).toEqual(["a", "b"]);
    }),
  );

  it.effect("writes either sentinel just as readily", () =>
    Effect.gen(function* () {
      expect(yield* encode(FieldValue.arrayUnion("a"))).toStrictEqual(FieldValue.arrayUnion("a"));
      expect(yield* encode(FieldValue.arrayRemove("a"))).toStrictEqual(FieldValue.arrayRemove("a"));
    }),
  );

  it.effect("decodes the array, which is all a read ever holds", () =>
    Effect.gen(function* () {
      expect(yield* Schema.decodeEffect(Tags)(["a"])).toEqual(["a"]);
    }),
  );

  it("keeps the schema it was handed", () => {
    expectTypeOf<FirestoreSchema.ArrayOr<Schema.String>["Type"]>().toEqualTypeOf<
      ReadonlyArray<string> | FieldValue.ArrayUnion<string> | FieldValue.ArrayRemove<string>
    >();
  });
});
