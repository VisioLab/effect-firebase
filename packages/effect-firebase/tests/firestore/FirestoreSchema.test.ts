import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { DateTime, Effect, Equal, Layer, Schema } from "effect";
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

const encoder = Layer.succeed(FirestoreEncoder)(
  FirestoreEncoder.of({
    timestamp: (value) => new SdkTimestamp(value.seconds, value.nanoseconds),
    serverTimestamp: () => new SdkServerTimestamp(),
    increment: (by) => new SdkIncrement(by),
    deleteField: () => new SdkDeleteField(),
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
