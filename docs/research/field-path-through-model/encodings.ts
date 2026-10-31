/**
 * What `toCodecFirestore` stores a value of each schema as, to tell which
 * encodings keep Firestore's equality and ordering in step with the model's.
 *
 * Run: vpx docs/research/field-path-through-model/encodings.ts
 */
import { BigDecimal, DateTime, Duration, Option, Schema } from "./effect.ts";
import {
  FirestoreValue,
  Timestamp,
} from "../../../packages/effect-firebase/src/firestore/index.ts";

const stored = (schema: Schema.Top, value: unknown): string => {
  try {
    const out = Schema.encodeUnknownSync(FirestoreValue.toCodecFirestore(schema as any) as any)(
      value,
    );
    if (typeof out === "number") return `number ${Object.is(out, -0) ? "-0" : String(out)}`;
    const kind =
      typeof out === "object" && out !== null ? (out.constructor?.name ?? "Object") : typeof out;
    return `${kind} ${JSON.stringify(out)}`;
  } catch (e) {
    return `FAILS: ${(e as Error).message.split("\n")[0]}`;
  }
};

const rows: Array<[string, Schema.Top, ReadonlyArray<unknown>]> = [
  ["BigInt", Schema.BigInt, [9n, 10n, -1n, -10n]],
  ["Number", Schema.Number, [1, 1.5, Number.NaN, Infinity, -Infinity, -0]],
  ["Finite", Schema.Finite, [1]],
  ["Literal(1n)", Schema.Literal(1n), [1n]],
  ["Undefined", Schema.Undefined, [undefined]],
  ["UndefinedOr(String)", Schema.UndefinedOr(Schema.String), [undefined, "a"]],
  ["Date", Schema.Date, [new Date(1), new Date(Number.NaN)]],
  ["DateTimeUtc", Schema.DateTimeUtc, [DateTime.makeUnsafe(1)]],
  [
    "DateTimeZoned",
    Schema.DateTimeZoned,
    [DateTime.makeZonedUnsafe(1, { timeZone: "Europe/Berlin" })],
  ],
  ["Duration", Schema.Duration, [Duration.millis(1500), Duration.infinity]],
  [
    "BigDecimal",
    Schema.BigDecimal,
    [BigDecimal.fromStringUnsafe("10.5"), BigDecimal.fromStringUnsafe("9")],
  ],
  ["Option(Number)", Schema.Option(Schema.Number), [Option.none(), Option.some(2)]],
  ["URL", Schema.URL, [new URL("https://a.b/")]],
  ["Uint8Array", Schema.Uint8Array, [new Uint8Array([1, 2])]],
  ["ReadonlySet(Number)", Schema.ReadonlySet(Schema.Number), [new Set([2, 1])]],
  [
    "ReadonlyMap(String,Number)",
    Schema.ReadonlyMap(Schema.String, Schema.Number),
    [new Map([["a", 1]])],
  ],
  ["Union(Number,BigInt)", Schema.Union([Schema.Number, Schema.BigInt]), [1, 1n]],
  ["NumberFromString", Schema.NumberFromString, [10]],
];

for (const [name, schema, values] of rows) {
  for (const value of values) {
    const shown =
      typeof value === "number" && Object.is(value, -0)
        ? "-0"
        : typeof value === "bigint"
          ? `${value}n`
          : value instanceof Date
            ? `Date(${value.getTime()})`
            : typeof value === "object" && value !== null
              ? Option.isOption(value)
                ? `Option.${value._tag}`
                : value.constructor.name
              : String(value);
    console.log(`${name.padEnd(28)} ${shown.padEnd(16)} -> ${stored(schema, value)}`);
  }
}

// A timestamp with sub-millisecond precision, as a server timestamp is stored,
// read back as a DateTimeUtc and written again as a filter value.
console.log("\n--- round trip of a server timestamp through DateTimeUtc");
const codec = FirestoreValue.toCodecFirestore(Schema.DateTimeUtc);
const original = Timestamp.makeUnsafe(1_700_000_000, 123_456_789);
const read = Schema.decodeUnknownSync(codec)(original);
const filterValue = Schema.encodeUnknownSync(codec)(read) as Timestamp.Timestamp;
console.log("stored     ", original.seconds, original.nanoseconds);
console.log("filter     ", filterValue.seconds, filterValue.nanoseconds);
console.log(
  "equal?     ",
  original.seconds === filterValue.seconds && original.nanoseconds === filterValue.nanoseconds,
);
console.log(
  "stored > filter (a `> read` cursor/filter would match the document it was read from):",
  Timestamp.Order(original, filterValue) > 0,
);

// A union whose members store different model values as the same Firestore
// Value: equality in Firestore cannot tell them apart.
console.log("\n--- Union(String, BigInt): two model values, one stored value");
const stringOrBigInt = FirestoreValue.toCodecFirestore(
  Schema.Union([Schema.String, Schema.BigInt]),
);
console.log('"1" ->', JSON.stringify(Schema.encodeUnknownSync(stringOrBigInt)("1")));
console.log(" 1n ->", JSON.stringify(Schema.encodeUnknownSync(stringOrBigInt)(1n)));
console.log('read "1" back as', typeof Schema.decodeUnknownSync(stringOrBigInt)("1"));
