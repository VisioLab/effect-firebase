import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { DateTime, Effect, Equal, Layer, Schema } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as FieldValue from "../../src/firestore/FieldValue.ts";
import { FirestoreEncoder } from "../../src/firestore/FirestoreEncoder.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";
import * as Timestamp from "../../src/firestore/Timestamp.ts";

/** Stands in for an SDK's own `Timestamp`. */
class SdkTimestamp implements Timestamp.TimestampLike {
  constructor(
    readonly seconds: number,
    readonly nanoseconds: number,
  ) {}
}

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

/** Stands in for an SDK's own `DocumentReference`. */
class SdkDocumentReference implements Collection.DocumentReferenceLike {
  readonly firestore = {};
  constructor(readonly path: string) {}
  get id(): string {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
  get parent(): string {
    return this.path.slice(0, this.path.lastIndexOf("/"));
  }
}

const encoder = Layer.succeed(FirestoreEncoder)(
  FirestoreEncoder.of({
    timestamp: (value) => new SdkTimestamp(value.seconds, value.nanoseconds),
    documentReference: (ref) => new SdkDocumentReference(ref.path),
    serverTimestamp: () => new SdkServerTimestamp(),
    increment: (by) => new SdkIncrement(by),
    deleteField: () => new SdkDeleteField(),
    arrayUnion: (elements) => new SdkArrayUnion(elements),
    arrayRemove: (elements) => new SdkArrayRemove(elements),
  }),
);

/** The shape an SDK hands back. */
const native = (seconds: number, nanoseconds: number): Timestamp.TimestampLike =>
  new SdkTimestamp(seconds, nanoseconds);

describe("Timestamp", () => {
  it("keeps the constructor input typed rather than widening it to unknown", () => {
    expectTypeOf<
      Parameters<typeof FirestoreSchema.Timestamp.make>[0]
    >().toEqualTypeOf<Timestamp.Timestamp>();
    expectTypeOf<
      (typeof FirestoreSchema.Timestamp)["Encoded"]
    >().toEqualTypeOf<Timestamp.TimestampLike>();
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(FirestoreSchema.Timestamp.annotate({})).toEqualTypeOf<FirestoreSchema.Timestamp>();
    expectTypeOf(
      FirestoreSchema.DateTimeUtcFromTimestamp.annotate({}),
    ).toEqualTypeOf<FirestoreSchema.DateTimeUtcFromTimestamp>();
  });

  const decode = Schema.decodeEffect(FirestoreSchema.Timestamp);
  const encode = Schema.encodeEffect(FirestoreSchema.Timestamp);

  it.effect("decodes a timestamp read through an SDK", () =>
    Effect.gen(function* () {
      const decoded = yield* decode(native(1_700_000_000, 123_456_789));
      expect(Timestamp.isTimestamp(decoded)).toBe(true);
      expect(Equal.equals(decoded, Timestamp.makeUnsafe(1_700_000_000, 123_456_789))).toBe(true);
    }),
  );

  it.effect("decodes one of ours unchanged", () =>
    Effect.gen(function* () {
      const timestamp = Timestamp.makeUnsafe(1, 2);
      expect(yield* decode(timestamp)).toBe(timestamp);
    }),
  );

  it("asks for an encoder to write, and for nothing at all to read", () => {
    expectTypeOf<
      (typeof FirestoreSchema.Timestamp)["EncodingServices"]
    >().toEqualTypeOf<FirestoreEncoder>();
    expectTypeOf<(typeof FirestoreSchema.Timestamp)["DecodingServices"]>().toEqualTypeOf<never>();
  });

  it.effect("hands the encoder the value, and writes what it builds", () =>
    Effect.gen(function* () {
      const encoded = yield* encode(Timestamp.makeUnsafe(1_700_000_000, 123_456_789));
      expect(encoded).toBeInstanceOf(SdkTimestamp);
      expect(encoded.seconds).toBe(1_700_000_000);
      expect(encoded.nanoseconds).toBe(123_456_789);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("reaches every value it owns, however they are nested", () =>
    Effect.gen(function* () {
      const timestamp = Timestamp.makeUnsafe(1, 2);
      const Clip = Schema.Struct({
        at: FirestoreSchema.Timestamp,
        takes: Schema.Array(Schema.Struct({ at: FirestoreSchema.Timestamp })),
      });
      const encoded = yield* Schema.encodeEffect(Clip)({
        at: timestamp,
        takes: [{ at: timestamp }],
      });
      expect(encoded.at).toBeInstanceOf(SdkTimestamp);
      expect(encoded.takes[0]?.at).toBeInstanceOf(SdkTimestamp);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("keeps the digits finer than a millisecond across a round trip", () =>
    Effect.gen(function* () {
      const encoded = yield* encode(yield* decode(native(1, 123_456_789)));
      expect(encoded.nanoseconds).toBe(123_456_789);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("refuses what Firestore would not have handed back", () =>
    Effect.gen(function* () {
      const decodeUnknown = Schema.decodeUnknownEffect(FirestoreSchema.Timestamp);
      expect(yield* Effect.flip(decodeUnknown(native(0, -1)))).toBeDefined();
      expect(yield* Effect.flip(decodeUnknown({ seconds: 0 }))).toBeDefined();
      expect(yield* Effect.flip(decodeUnknown("2024-01-01T00:00:00Z"))).toBeDefined();
    }),
  );

  it.effect("decodes a field of a document", () =>
    Effect.gen(function* () {
      const Post = Schema.Struct({ title: Schema.String, createdAt: FirestoreSchema.Timestamp });
      const post = yield* Schema.decodeEffect(Post)({ title: "hello", createdAt: native(1, 2) });
      expect(Equal.equals(post.createdAt, Timestamp.makeUnsafe(1, 2))).toBe(true);
    }),
  );
});

describe("DateTimeUtcFromTimestamp", () => {
  const decode = Schema.decodeEffect(FirestoreSchema.DateTimeUtcFromTimestamp);
  const encode = Schema.encodeEffect(FirestoreSchema.DateTimeUtcFromTimestamp);

  it.effect("decodes a timestamp read through an SDK", () =>
    Effect.gen(function* () {
      expect(yield* decode(native(1_700_000_000, 123_000_000))).toStrictEqual(
        DateTime.makeUnsafe(1_700_000_000_123),
      );
    }),
  );

  it.effect("encodes back to the shape an SDK binding writes", () =>
    Effect.gen(function* () {
      const encoded = yield* encode(DateTime.makeUnsafe(1_700_000_000_123));
      expect(encoded).toBeInstanceOf(SdkTimestamp);
      expect(encoded.seconds).toBe(1_700_000_000);
      expect(encoded.nanoseconds).toBe(123_000_000);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("drops the digits a DateTime cannot hold", () =>
    Effect.gen(function* () {
      const encoded = yield* encode(yield* decode(native(1, 123_456_789)));
      expect(encoded.nanoseconds).toBe(123_000_000);
    }).pipe(Effect.provide(encoder)),
  );
});

describe("DocumentReference", () => {
  const Users = Collection.make("users", Schema.Struct({ name: Schema.String }));
  const Posts = Users.subcollection("posts", Schema.Struct({ title: Schema.String }));
  const Orgs = Collection.make("orgs", Schema.Struct({ name: Schema.String }));
  const OrgPosts = Orgs.subcollection("posts", Schema.Struct({ title: Schema.String }));

  const Post = FirestoreSchema.DocumentReference(Posts);
  const decode = Schema.decodeUnknownEffect(Post);
  const encode = Schema.encodeEffect(Post);
  const hello = Posts.doc(Users.id.make("alice"), Posts.id.make("hello"));

  it("is typed by the collection it points into", () => {
    expectTypeOf<(typeof Post)["Type"]>().toEqualTypeOf<
      Collection.DocumentReference<typeof Posts>
    >();
    expectTypeOf<(typeof Post)["Encoded"]>().toEqualTypeOf<Collection.DocumentReferenceLike>();
    expectTypeOf<(typeof Post)["DecodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<(typeof Post)["EncodingServices"]>().toEqualTypeOf<FirestoreEncoder>();
  });

  it("keeps its own name through a rebuild", () => {
    expectTypeOf(Post.annotate({})).toEqualTypeOf<
      FirestoreSchema.DocumentReference<typeof Posts>
    >();
  });

  it.effect("decodes a reference read through an SDK", () =>
    Effect.gen(function* () {
      const decoded = yield* decode(new SdkDocumentReference("users/alice/posts/hello"));
      expect(Collection.isDocumentReference(decoded)).toBe(true);
      expect(decoded.collection).toBe(Posts);
      expect(decoded.ancestors).toEqual(["alice"]);
      expect(decoded.id).toBe("hello");
      expect(Equal.equals(decoded, hello)).toBe(true);
    }),
  );

  it.effect("decodes one of ours unchanged", () =>
    Effect.gen(function* () {
      expect(Equal.equals(yield* decode(hello), hello)).toBe(true);
    }),
  );

  it.effect("refuses a reference into another collection", () =>
    Effect.gen(function* () {
      for (const path of [
        "orgs/acme/posts/hello",
        "users/alice",
        "users/alice/posts/hello/comments/first",
        "users//posts/hello",
      ]) {
        const failure = yield* Effect.flip(decode(new SdkDocumentReference(path)));
        expect(String(failure)).toContain(`Expected a document in users/{id}/posts/{id}`);
      }
    }),
  );

  it.effect("refuses a map that only looks like a reference", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(decode({ id: "hello", path: "users/alice/posts/hello" }));
      expect(String(failure)).toContain("a Firestore document reference");
    }),
  );

  it.effect("writes the SDK's own reference", () =>
    Effect.gen(function* () {
      const encoded = yield* encode(hello);
      expect(encoded).toBeInstanceOf(SdkDocumentReference);
      expect(encoded.path).toBe("users/alice/posts/hello");
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("refuses to write a reference into another collection", () =>
    Effect.gen(function* () {
      const elsewhere = OrgPosts.doc(Orgs.id.make("acme"), OrgPosts.id.make("hello"));
      const failure = yield* Effect.flip(Schema.encodeUnknownEffect(Post)(elsewhere));
      expect(failure).toBeDefined();
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("tells collections apart in a union", () =>
    Effect.gen(function* () {
      const Either = Schema.Union([Post, FirestoreSchema.DocumentReference(OrgPosts)]);
      const decoded = yield* Schema.decodeEffect(Either)(
        new SdkDocumentReference("orgs/acme/posts/hello"),
      );
      expect(decoded.collection).toBe(OrgPosts);
    }),
  );

  it.effect("writes each element of an array union as the SDK's own", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.ArrayUnion(Post))(
        FieldValue.arrayUnion(hello),
      );
      expect((encoded as SdkArrayUnion).elements[0]).toBeInstanceOf(SdkDocumentReference);
    }).pipe(Effect.provide(encoder)),
  );

  it("compares by where it points", () => {
    const equivalence = Schema.toEquivalence(Post);
    expect(equivalence(hello, Posts.doc(Users.id.make("alice"), Posts.id.make("hello")))).toBe(
      true,
    );
    expect(equivalence(hello, Posts.doc(Users.id.make("bob"), Posts.id.make("hello")))).toBe(false);
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
  const WrittenAt = FirestoreSchema.ServerTimestampOr(FirestoreSchema.Timestamp);
  const encode = Schema.encodeEffect(WrittenAt);

  it.effect("writes the instant it was handed", () =>
    Effect.gen(function* () {
      expect(yield* encode(Timestamp.makeUnsafe(1, 2))).toBeInstanceOf(SdkTimestamp);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes the sentinel just as readily", () =>
    Effect.gen(function* () {
      expect(yield* encode(FieldValue.serverTimestamp)).toBeInstanceOf(SdkServerTimestamp);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("decodes the timestamp it wraps, which is all a read ever holds", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeEffect(WrittenAt)(native(1, 2));
      expect(Timestamp.isTimestamp(decoded)).toBe(true);
    }),
  );

  it.effect("holds the instant however the schema it was handed holds it", () =>
    Effect.gen(function* () {
      const SeenAt = FirestoreSchema.ServerTimestampOr(FirestoreSchema.DateTimeUtcFromTimestamp);
      expect(yield* Schema.decodeEffect(SeenAt)(native(1_700_000_000, 123_000_000))).toStrictEqual(
        DateTime.makeUnsafe(1_700_000_000_123),
      );
      expect(
        yield* Schema.encodeEffect(SeenAt)(DateTime.makeUnsafe(1_700_000_000_123)),
      ).toBeInstanceOf(SdkTimestamp);
      expect(yield* Schema.encodeEffect(SeenAt)(FieldValue.serverTimestamp)).toBeInstanceOf(
        SdkServerTimestamp,
      );
    }).pipe(Effect.provide(encoder)),
  );
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
      const Seen = FirestoreSchema.ArrayUnion(FirestoreSchema.Timestamp);
      const encoded = yield* Schema.encodeEffect(Seen)(
        FieldValue.arrayUnion(Timestamp.makeUnsafe(1, 2)),
      );
      const [element] = (encoded as SdkArrayUnion).elements;
      expect(element).toBeInstanceOf(SdkTimestamp);
      expect(element).toMatchObject({ seconds: 1, nanoseconds: 2 });
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
    const equivalence = Schema.toEquivalence(
      FirestoreSchema.ArrayUnion(FirestoreSchema.DateTimeUtcFromTimestamp),
    );
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
      const Seen = FirestoreSchema.ArrayRemove(Schema.Struct({ at: FirestoreSchema.Timestamp }));
      const encoded = yield* Schema.encodeEffect(Seen)(
        FieldValue.arrayRemove({ at: Timestamp.makeUnsafe(1, 2) }),
      );
      expect((encoded as SdkArrayRemove).elements[0]).toMatchObject({
        at: new SdkTimestamp(1, 2),
      });
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
