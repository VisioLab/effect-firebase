import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import { Timestamp as Native } from "firebase-admin/firestore";
import * as FirestoreEncoder from "../../src/firestore/FirestoreEncoder.ts";

const Post = Schema.Struct({ title: Schema.String, createdAt: FirestoreSchema.Timestamp });

describe("FirestoreEncoder", () => {
  it.effect("encodes a document into the values the Admin SDK writes", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Post)({
        title: "hello",
        createdAt: Timestamp.makeUnsafe(1_700_000_000, 123_456_789),
      });

      expect(encoded.createdAt).toBeInstanceOf(Native);
      expect(encoded.title).toBe("hello");
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("carries the digits finer than a millisecond through to the SDK", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.Timestamp)(
        Timestamp.makeUnsafe(1_700_000_000, 123_456_789),
      );
      expect((encoded as Native).isEqual(new Native(1_700_000_000, 123_456_789))).toBe(true);
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("reads a document the SDK handed back without an encoder at all", () =>
    Effect.gen(function* () {
      const post = yield* Schema.decodeEffect(Post)({
        title: "hello",
        createdAt: new Native(1_700_000_000, 123_456_789),
      });
      expect(Timestamp.isTimestamp(post.createdAt)).toBe(true);
      expect(post.createdAt.nanoseconds).toBe(123_456_789);
    }),
  );

  it.effect("round-trips a timestamp through the SDK's own representation", () =>
    Effect.gen(function* () {
      const original = new Native(1_700_000_000, 123_456_789);
      const post = yield* Schema.decodeEffect(Post)({ title: "t", createdAt: original });
      const encoded = yield* Schema.encodeEffect(Post)(post);
      expect((encoded.createdAt as Native).isEqual(original)).toBe(true);
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});
