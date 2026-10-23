import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import * as FirestoreValue from "@visiolab/effect-firebase/firestore/FirestoreValue";
import { Schema } from "effect";
import { describe, expect, test } from "tstyche";

const Model = Schema.Struct({
  utc: Schema.DateTimeUtc,
  date: Schema.Date,
  at: FirestoreSchema.Timestamp,
  data: Schema.Uint8Array,
  nickname: Schema.Option(Schema.String),
});

const codec = FirestoreValue.toCodecFirestore(Model);

describe("toCodecFirestore", () => {
  test("types the encoded side as a Firestore Value", () => {
    expect<(typeof codec)["Encoded"]>().type.toBe<FirestoreValue.FirestoreValue>();
  });

  test("keeps the decoded side of the schema it was handed", () => {
    expect<(typeof codec)["Type"]>().type.toBe<(typeof Model)["Type"]>();
  });

  test("adds no services to encode", () => {
    expect<(typeof codec)["EncodingServices"]>().type.toBe<never>();
  });

  test("adds no services to decode", () => {
    expect<(typeof codec)["DecodingServices"]>().type.toBe<never>();
  });
});
