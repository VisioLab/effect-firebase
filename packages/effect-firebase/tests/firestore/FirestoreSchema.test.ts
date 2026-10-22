import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { DateTime, Effect, Equal, Layer, Option, Schema } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as FieldValue from "../../src/firestore/FieldValue.ts";
import { FirestoreEncoder } from "../../src/firestore/FirestoreEncoder.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";
import * as FirestoreValue from "../../src/firestore/FirestoreValue.ts";
import * as GeoPoint from "../../src/firestore/GeoPoint.ts";
import * as Timestamp from "../../src/firestore/Timestamp.ts";

/** Stands in for an SDK's own sentinel. */
class SdkServerTimestamp {}

/** Stands in for an SDK's own sentinel, which carries what it is to add. */
class SdkIncrement {
  constructor(readonly by: number) {}
}

/** Stands in for an SDK's own sentinel. */
class SdkDeleteField {}

/** Stands in for an SDK's own sentinel, which carries the elements to add. */
class SdkArrayUnion {
  constructor(readonly elements: ReadonlyArray<unknown>) {}
}

/** Stands in for an SDK's own sentinel, which carries the elements to remove. */
class SdkArrayRemove {
  constructor(readonly elements: ReadonlyArray<unknown>) {}
}

/** The sentinels are still built by an encoder, until they become plain values too (#76). */
const encoder = Layer.succeed(FirestoreEncoder)(
  FirestoreEncoder.of({
    timestamp: (value) => value,
    geoPoint: (value) => value,
    documentReference: (ref) => ref,
    serverTimestamp: () => new SdkServerTimestamp(),
    increment: (by) => new SdkIncrement(by),
    deleteField: () => new SdkDeleteField(),
    arrayUnion: (elements) => new SdkArrayUnion(elements),
    arrayRemove: (elements) => new SdkArrayRemove(elements),
  }),
);

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
    expectTypeOf<(typeof Post)["Encoded"]>().toEqualTypeOf<
      Collection.DocumentReference<typeof Posts>
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

describe("ServerTimestamp", () => {
  it.effect("writes the sentinel the encoder builds", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.ServerTimestamp)(
        FieldValue.serverTimestamp,
      );
      expect(encoded).toBeInstanceOf(SdkServerTimestamp);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("refuses to be read, since a document never holds one", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeEffect(FirestoreSchema.ServerTimestamp)(new SdkServerTimestamp()),
      );
      expect(failure).toBeDefined();
    }),
  );

  it("asks for an encoder to write", () => {
    expectTypeOf<
      (typeof FirestoreSchema.ServerTimestamp)["EncodingServices"]
    >().toEqualTypeOf<FirestoreEncoder>();
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
      // The sentinel is still written through an encoder (#76).
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes the sentinel just as readily", () =>
    Effect.gen(function* () {
      const WrittenAt = FirestoreSchema.ServerTimestampOr(Schema.DateTimeUtc);
      expect(yield* toFirestore(WrittenAt)(FieldValue.serverTimestamp)).toBeInstanceOf(
        SdkServerTimestamp,
      );
    }).pipe(Effect.provide(encoder)),
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
  const encode = Schema.encodeEffect(FirestoreSchema.Increment);

  it.effect("hands the encoder how far the field moves", () =>
    Effect.gen(function* () {
      const encoded = yield* encode(FieldValue.increment(2));
      expect(encoded).toBeInstanceOf(SdkIncrement);
      expect((encoded as SdkIncrement).by).toBe(2);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes a move down as the negative it is", () =>
    Effect.gen(function* () {
      expect(((yield* encode(FieldValue.decrement(3))) as SdkIncrement).by).toBe(-3);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("refuses to be read, since a document holds the sum instead", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeEffect(FirestoreSchema.Increment)(new SdkIncrement(2)),
      );
      expect(failure).toBeDefined();
    }),
  );

  it("asks for an encoder to write", () => {
    expectTypeOf<
      (typeof FirestoreSchema.Increment)["EncodingServices"]
    >().toEqualTypeOf<FirestoreEncoder>();
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(FirestoreSchema.Increment.annotate({})).toEqualTypeOf<FirestoreSchema.Increment>();
  });
});

describe("IncrementOr", () => {
  const Visits = FirestoreSchema.IncrementOr(Schema.Finite);
  const encode = Schema.encodeEffect(Visits);

  it.effect("writes the number it was handed", () =>
    Effect.gen(function* () {
      expect(yield* encode(7)).toBe(7);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes the sentinel just as readily", () =>
    Effect.gen(function* () {
      const encoded = yield* encode(FieldValue.increment(1));
      expect(encoded).toBeInstanceOf(SdkIncrement);
    }).pipe(Effect.provide(encoder)),
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
      expect(yield* Schema.encodeEffect(Whole)(7)).toBe(7);
      // Flipped through `asVoid`, since what a write encodes to is the SDK's to
      // say and so reads as `unknown` here.
      expect(yield* Effect.flip(Effect.asVoid(Schema.encodeEffect(Whole)(7.5)))).toBeDefined();
      expect(yield* Effect.flip(Schema.decodeEffect(Whole)(7.5))).toBeDefined();
    }).pipe(Effect.provide(encoder)),
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
  it.effect("writes the sentinel the encoder builds", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.DeleteField)(
        FieldValue.deleteField,
      );
      expect(encoded).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("refuses to be read, since a field removed is not there to read", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeEffect(FirestoreSchema.DeleteField)(new SdkDeleteField()),
      );
      expect(failure).toBeDefined();
    }),
  );

  it("asks for an encoder to write", () => {
    expectTypeOf<
      (typeof FirestoreSchema.DeleteField)["EncodingServices"]
    >().toEqualTypeOf<FirestoreEncoder>();
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(
      FirestoreSchema.DeleteField.annotate({}),
    ).toEqualTypeOf<FirestoreSchema.DeleteField>();
  });
});

describe("DeleteFieldOr", () => {
  const Nickname = FirestoreSchema.DeleteFieldOr(Schema.String);
  const encode = Schema.encodeEffect(Nickname);

  it.effect("writes the value it was handed", () =>
    Effect.gen(function* () {
      expect(yield* encode("ally")).toBe("ally");
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes the sentinel just as readily", () =>
    Effect.gen(function* () {
      expect(yield* encode(FieldValue.deleteField)).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
  );

  it("keeps the schema it was handed", () => {
    expectTypeOf<FirestoreSchema.DeleteFieldOr<Schema.String>["Type"]>().toEqualTypeOf<
      string | FieldValue.DeleteField
    >();
  });
});

describe("ArrayUnion", () => {
  const Tags = FirestoreSchema.ArrayUnion(Schema.String);

  it.effect("hands the encoder the elements the array is to gain", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Tags)(FieldValue.arrayUnion("a", "b"));
      expect(encoded).toBeInstanceOf(SdkArrayUnion);
      expect((encoded as SdkArrayUnion).elements).toEqual(["a", "b"]);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("encodes each element through the schema it was built from", () =>
    Effect.gen(function* () {
      const Counts = FirestoreSchema.ArrayUnion(Schema.FiniteFromString);
      const encoded = yield* Schema.encodeEffect(Counts)(FieldValue.arrayUnion(1, 2));
      expect((encoded as SdkArrayUnion).elements).toEqual(["1", "2"]);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("refuses an element the schema it was built from refuses", () =>
    Effect.gen(function* () {
      const Whole = FirestoreSchema.ArrayUnion(Schema.Int);
      const failure = yield* Effect.flip(
        Effect.asVoid(Schema.encodeEffect(Whole)(FieldValue.arrayUnion(1, 1.5))),
      );
      expect(String(failure)).toContain(`["elements"][1]`);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("refuses to be read, since a document holds the array instead", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(Schema.decodeEffect(Tags)(new SdkArrayUnion(["a"])));
      expect(failure).toBeDefined();
    }),
  );

  it("asks for an encoder, and for whatever its elements ask for", () => {
    expectTypeOf<(typeof Tags)["EncodingServices"]>().toEqualTypeOf<FirestoreEncoder>();
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

  it.effect("hands the encoder the elements the array is to lose", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Tags)(FieldValue.arrayRemove("a"));
      expect(encoded).toBeInstanceOf(SdkArrayRemove);
      expect((encoded as SdkArrayRemove).elements).toEqual(["a"]);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("encodes each element through the schema it was built from", () =>
    Effect.gen(function* () {
      const Seen = FirestoreSchema.ArrayRemove(Schema.Struct({ count: Schema.FiniteFromString }));
      const encoded = yield* Schema.encodeEffect(Seen)(FieldValue.arrayRemove({ count: 1 }));
      expect((encoded as SdkArrayRemove).elements[0]).toEqual({ count: "1" });
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("refuses to be read, since a document holds the array instead", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(Schema.decodeEffect(Tags)(new SdkArrayRemove(["a"])));
      expect(failure).toBeDefined();
    }),
  );

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(Tags.annotate({})).toEqualTypeOf<FirestoreSchema.ArrayRemove<Schema.String>>();
  });
});

describe("ArrayOr", () => {
  const Tags = FirestoreSchema.ArrayOr(Schema.String);
  const encode = Schema.encodeEffect(Tags);

  it.effect("writes the array it was handed", () =>
    Effect.gen(function* () {
      expect(yield* encode(["a", "b"])).toEqual(["a", "b"]);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes either sentinel just as readily", () =>
    Effect.gen(function* () {
      expect(yield* encode(FieldValue.arrayUnion("a"))).toBeInstanceOf(SdkArrayUnion);
      expect(yield* encode(FieldValue.arrayRemove("a"))).toBeInstanceOf(SdkArrayRemove);
    }).pipe(Effect.provide(encoder)),
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
