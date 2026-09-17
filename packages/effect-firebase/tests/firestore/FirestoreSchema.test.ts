import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { DateTime, Effect, Equal, Layer, Schema } from "effect";
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

const encoder = Layer.succeed(FirestoreEncoder)(
  FirestoreEncoder.of({ timestamp: (value) => new SdkTimestamp(value.seconds, value.nanoseconds) }),
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
