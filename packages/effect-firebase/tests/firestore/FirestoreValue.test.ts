import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { BigDecimal, DateTime, Duration, Effect, Option, Schema, SchemaGetter } from "effect";
import * as DocumentPath from "../../src/firestore/DocumentPath.ts";
import * as FieldValue from "../../src/firestore/FieldValue.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";
import * as FirestoreValue from "../../src/firestore/FirestoreValue.ts";
import * as GeoPoint from "../../src/firestore/GeoPoint.ts";
import * as Timestamp from "../../src/firestore/Timestamp.ts";

const PortableTimestamp = FirestoreSchema.Timestamp;

class MoneyValue {
  constructor(readonly cents: number) {}
}

/** A declaration that only knows its JSON form, as a string of whole units. */
const Money = Schema.declare((u): u is MoneyValue => u instanceof MoneyValue, {
  toCodecJson: () =>
    Schema.link<MoneyValue>()(Schema.String, {
      decode: SchemaGetter.transform((s: string) => new MoneyValue(Math.round(Number(s) * 100))),
      encode: SchemaGetter.transform((money: MoneyValue) => (money.cents / 100).toFixed(2)),
    }),
});

const encode = <S extends Schema.Top>(schema: S) =>
  Schema.encodeUnknownEffect(FirestoreValue.toCodecFirestore(schema));

const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(FirestoreValue.toCodecFirestore(schema));

describe("toCodecFirestore", () => {
  describe("time", () => {
    it.effect("stores a DateTimeUtc as a portable Timestamp and reads it back", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({ at: Schema.DateTimeUtc });
        const at = DateTime.makeUnsafe(1_700_000_000_123);

        const encoded = yield* encode(Model)({ at });
        expect(encoded).toEqual({ at: Timestamp.makeUnsafe(1_700_000_000, 123_000_000) });
        expect(Timestamp.isTimestamp((encoded as { at: unknown }).at)).toBe(true);

        const decoded = yield* decode(Model)(encoded);
        expect(DateTime.toEpochMillis(decoded.at)).toBe(1_700_000_000_123);
      }),
    );

    it.effect("stores a Date as a portable Timestamp and reads it back", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({ at: Schema.Date });
        const at = new Date(1_700_000_000_123);

        const encoded = yield* encode(Model)({ at });
        expect(encoded).toEqual({ at: Timestamp.makeUnsafe(1_700_000_000, 123_000_000) });
        expect(Timestamp.isTimestamp((encoded as { at: unknown }).at)).toBe(true);

        const decoded = yield* decode(Model)(encoded);
        expect(decoded.at).toEqual(at);
      }),
    );

    it.effect("keeps a portable Timestamp as it is, to the nanosecond", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({ at: PortableTimestamp });
        const at = Timestamp.makeUnsafe(1_700_000_000, 123_456_789);

        const encoded = yield* encode(Model)({ at });
        expect(encoded).toEqual({ at });

        const decoded = yield* decode(Model)(encoded);
        expect(decoded.at).toStrictEqual(at);
      }),
    );

    it.effect("reads a DateTimeUtc and a Date back at millisecond precision", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({ utc: Schema.DateTimeUtc, date: Schema.Date });
        const at = Timestamp.makeUnsafe(1_700_000_000, 123_456_789);

        const decoded = yield* decode(Model)({ utc: at, date: at });
        expect(DateTime.toEpochMillis(decoded.utc)).toBe(1_700_000_000_123);
        expect(decoded.date.getTime()).toBe(1_700_000_000_123);
      }),
    );

    it.effect("refuses an instant Firestore can't store", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({ at: Schema.DateTimeUtc });
        const at = DateTime.makeUnsafe("+010000-01-01T00:00:00Z");

        const error = yield* Effect.flip(encode(Model)({ at }));
        expect(error).toBeInstanceOf(Schema.SchemaError);
        expect(error.message).toContain('at ["at"]');
      }),
    );
  });

  describe("other values", () => {
    it.effect("stores a Uint8Array as bytes", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({ data: Schema.Uint8Array });
        const data = new Uint8Array([1, 2, 3]);

        const encoded = yield* encode(Model)({ data });
        expect(encoded).toEqual({ data: new Uint8Array([1, 2, 3]) });

        expect(yield* decode(Model)(encoded)).toEqual({ data });
      }),
    );

    it.effect("stores a bigint as a string, as JSON does", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({ big: Schema.BigInt });

        const encoded = yield* encode(Model)({ big: 12345678901234567890n });
        expect(encoded).toEqual({ big: "12345678901234567890" });

        expect(yield* decode(Model)(encoded)).toEqual({ big: 12345678901234567890n });
      }),
    );

    it.effect("stores an Option through its JSON form", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({ nickname: Schema.Option(Schema.String) });

        const some = yield* encode(Model)({ nickname: Option.some("al") });
        const none = yield* encode(Model)({ nickname: Option.none() });
        expect(some).toEqual(
          yield* Schema.encodeEffect(Schema.toCodecJson(Model))({ nickname: Option.some("al") }),
        );
        expect(none).toEqual(
          yield* Schema.encodeEffect(Schema.toCodecJson(Model))({ nickname: Option.none() }),
        );

        expect(yield* decode(Model)(some)).toEqual({ nickname: Option.some("al") });
        expect(yield* decode(Model)(none)).toEqual({ nickname: Option.none() });
      }),
    );

    it.effect("stores a Duration, a URL and a BigDecimal through their JSON forms", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({
          timeout: Schema.Duration,
          precise: Schema.Duration,
          site: Schema.URL,
          price: Schema.BigDecimal,
        });
        const value = {
          timeout: Duration.millis(1500),
          precise: Duration.nanos(1_500n),
          site: new URL("https://example.com/a?b=c"),
          price: BigDecimal.fromStringUnsafe("12.50"),
        };

        const encoded = yield* encode(Model)(value);
        expect(encoded).toEqual({
          timeout: { _tag: "Millis", value: 1500 },
          precise: { _tag: "Nanos", value: "1500" },
          site: "https://example.com/a?b=c",
          price: "12.5",
        });
        expect(FirestoreValue.isFirestoreValue(encoded)).toBe(true);

        const decoded = yield* decode(Model)(encoded);
        expect(Duration.equals(decoded.timeout, value.timeout)).toBe(true);
        expect(Duration.equals(decoded.precise, value.precise)).toBe(true);
        expect(decoded.site.href).toBe("https://example.com/a?b=c");
        expect(BigDecimal.equals(decoded.price, value.price)).toBe(true);
      }),
    );

    it.effect("stores a Schema.Class instance through its JSON form, timestamps included", () =>
      Effect.gen(function* () {
        class Address extends Schema.Class<Address>("Address")({
          city: Schema.String,
          since: Schema.DateTimeUtc,
        }) {}
        const Model = Schema.Struct({ address: Address });
        const address = new Address({ city: "Berlin", since: DateTime.makeUnsafe(0) });

        const encoded = yield* encode(Model)({ address });
        expect(encoded).toEqual({ address: { city: "Berlin", since: Timestamp.makeUnsafe(0, 0) } });

        const decoded = yield* decode(Model)(encoded);
        expect(decoded.address).toBeInstanceOf(Address);
        expect(decoded.address.city).toBe("Berlin");
      }),
    );

    it.effect("stores a custom declaration with only toCodecJson through that link", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({ money: Money });

        const encoded = yield* encode(Model)({ money: new MoneyValue(1250) });
        expect(encoded).toEqual({ money: "12.50" });

        const decoded = yield* decode(Model)(encoded);
        expect(decoded.money).toEqual(new MoneyValue(1250));
      }),
    );

    it.effect("prefers a toCodecFirestore annotation to toCodecJson", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({
          money: Money.annotate({
            toCodecFirestore: () =>
              Schema.link<MoneyValue>()(Schema.Int, {
                decode: SchemaGetter.transform((cents: number) => new MoneyValue(cents)),
                encode: SchemaGetter.transform((money: MoneyValue) => money.cents),
              }),
          }),
        });

        const encoded = yield* encode(Model)({ money: new MoneyValue(1250) });
        expect(encoded).toEqual({ money: 1250 });

        const decoded = yield* decode(Model)(encoded);
        expect(decoded.money).toEqual(new MoneyValue(1250));
      }),
    );
  });

  describe("values Firestore can't store", () => {
    class Unmapped {
      constructor(readonly name: string) {}
    }
    const Model = Schema.Struct({
      title: Schema.String,
      extra: Schema.optionalKey(Schema.instanceOf(Unmapped)),
    });

    it.effect("fails with a schema error at the field's path", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          encode(Model)({ title: "hello", extra: new Unmapped("x") }),
        );
        expect(error).toBeInstanceOf(Schema.SchemaError);
        expect(error.message).toContain('at ["extra"]');
      }),
    );

    it.effect("derives a codec for a struct keyed by a symbol, which then fails to encode", () =>
      Effect.gen(function* () {
        const secret = Symbol.for("secret");
        const Keyed = Schema.Struct({ [secret]: Schema.String });
        const Model = Schema.Struct({ title: Schema.String, keyed: Keyed });

        const codec = FirestoreValue.toCodecFirestore(Model);

        const error = yield* Effect.flip(
          Schema.encodeUnknownEffect(codec)({ title: "hello", keyed: { [secret]: "x" } }),
        );
        expect(error).toBeInstanceOf(Schema.SchemaError);
        expect(error.message).toContain('at ["keyed"]');
      }),
    );

    it.effect("encodes the same model fine when the field is absent", () =>
      Effect.gen(function* () {
        expect(yield* encode(Model)({ title: "hello" })).toEqual({ title: "hello" });
      }),
    );

    it.effect("refuses a value that isn't one through Schema.Any and Schema.Unknown too", () =>
      Effect.gen(function* () {
        const Loose = Schema.Struct({ any: Schema.Any, unknown: Schema.Unknown });

        const viaAny = yield* Effect.flip(
          encode(Loose)({ any: { deep: [new Unmapped("x")] }, unknown: null }),
        );
        expect(viaAny).toBeInstanceOf(Schema.SchemaError);
        expect(viaAny.message).toContain('at ["any"]');

        const viaUnknown = yield* Effect.flip(
          encode(Loose)({ any: null, unknown: new Unmapped("x") }),
        );
        expect(viaUnknown.message).toContain('at ["unknown"]');

        expect(yield* encode(Loose)({ any: { deep: [1, "a"] }, unknown: true })).toEqual({
          any: { deep: [1, "a"] },
          unknown: true,
        });
      }),
    );
  });

  describe("portable values", () => {
    it.effect("passes sentinels, document paths and geopoints through unchanged", () =>
      Effect.gen(function* () {
        const Model = Schema.Struct({
          createdAt: Schema.toType(FirestoreSchema.ServerTimestamp),
          visits: Schema.toType(FirestoreSchema.Increment),
          gone: Schema.toType(FirestoreSchema.DeleteField),
          tags: Schema.toType(FirestoreSchema.ArrayUnion(Schema.String)),
          old: Schema.toType(FirestoreSchema.ArrayRemove(Schema.String)),
          owner: FirestoreSchema.DocumentPath,
          where: FirestoreSchema.GeoPoint,
        });
        const value = {
          createdAt: FieldValue.serverTimestamp,
          visits: FieldValue.increment(1),
          gone: FieldValue.deleteField,
          tags: FieldValue.arrayUnion("a"),
          old: FieldValue.arrayRemove("b"),
          owner: DocumentPath.makeUnsafe("users/alice"),
          where: GeoPoint.makeUnsafe(52.5, 13.4),
        };

        const encoded = (yield* encode(Model)(value)) as Record<string, unknown>;
        for (const [key, field] of Object.entries(value)) {
          expect(encoded[key]).toStrictEqual(field);
        }
        expect(FirestoreValue.isFirestoreValue(encoded)).toBe(true);
      }),
    );
  });

  it.effect("runs user transformations before the derived encoding", () =>
    Effect.gen(function* () {
      // A DateTime.Utc the model itself stores as seconds: its own transformation
      // runs first, so it reaches Firestore as a number, not a timestamp.
      const DateTimeFromSeconds = Schema.Int.pipe(
        Schema.decodeTo(Schema.DateTimeUtc, {
          decode: SchemaGetter.transform((seconds: number) => DateTime.makeUnsafe(seconds * 1000)),
          encode: SchemaGetter.transform((utc: DateTime.Utc) => DateTime.toEpochMillis(utc) / 1000),
        }),
      );
      const Model = Schema.Struct({
        at: Schema.DateTimeUtc.pipe(
          Schema.decodeTo(Schema.String, {
            decode: SchemaGetter.transform(DateTime.formatIso),
            encode: SchemaGetter.transform((iso: string) => DateTime.makeUnsafe(iso)),
          }),
        ),
        seconds: DateTimeFromSeconds,
      });

      const encoded = yield* encode(Model)({
        at: "2023-11-14T22:13:20.000Z",
        seconds: DateTime.makeUnsafe(1_700_000_000_000),
      });
      expect(encoded).toEqual({
        at: Timestamp.makeUnsafe(1_700_000_000, 0),
        seconds: 1_700_000_000,
      });

      expect(yield* decode(Model)(encoded)).toEqual({
        at: "2023-11-14T22:13:20.000Z",
        seconds: DateTime.makeUnsafe(1_700_000_000_000),
      });
    }),
  );

  it("encodes a model with sentinels synchronously, with no layer", () => {
    class Post extends FirestoreModel.Class<Post>("Post")({
      title: Schema.String,
      views: FirestoreModel.Number(Schema.Finite),
      createdAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
    }) {}

    expect(
      Schema.encodeSync(FirestoreValue.toCodecFirestore(Post.create))({
        title: "Hello",
        views: 0,
        createdAt: FieldValue.serverTimestamp,
      }),
    ).toEqual({ title: "Hello", views: 0, createdAt: FieldValue.serverTimestamp });
    expect(
      Schema.encodeSync(FirestoreValue.toCodecFirestore(Post.update))({
        views: FieldValue.increment(1),
      }),
    ).toEqual({ views: FieldValue.increment(1) });
  });

  it("types the encoded side as a Firestore Value and adds no services", () => {
    const Model = Schema.Struct({
      utc: Schema.DateTimeUtc,
      date: Schema.Date,
      at: PortableTimestamp,
      data: Schema.Uint8Array,
      nickname: Schema.Option(Schema.String),
    });
    const codec = FirestoreValue.toCodecFirestore(Model);
    expectTypeOf<(typeof codec)["Encoded"]>().toEqualTypeOf<FirestoreValue.FirestoreValue>();
    expectTypeOf<(typeof codec)["Type"]>().toEqualTypeOf<(typeof Model)["Type"]>();
    expectTypeOf<(typeof codec)["EncodingServices"]>().toEqualTypeOf<never>();
    expectTypeOf<(typeof codec)["DecodingServices"]>().toEqualTypeOf<never>();
  });
});
