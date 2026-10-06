import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import { FieldValue as NativeFieldValue, Timestamp as Native } from "firebase-admin/firestore";
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

class User extends FirestoreModel.Class<User>("User")({
  displayName: Schema.String,
  createdAt: FirestoreModel.Timestamp,
  updatedAt: FirestoreModel.Timestamp,
}) {}

describe("ServerTimestamp", () => {
  it.effect("writes the sentinel the Admin SDK resolves at the server", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.ServerTimestamp)(
        FieldValue.serverTimestamp,
      );
      expect(encoded).toBeInstanceOf(NativeFieldValue);
      expect(encoded).toStrictEqual(NativeFieldValue.serverTimestamp());
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("writes a document the Admin SDK can set as it stands", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.create)(
        User.create.make({
          displayName: "alice",
          createdAt: FieldValue.serverTimestamp,
          updatedAt: FieldValue.serverTimestamp,
        }),
      );
      expect(encoded).toStrictEqual({
        displayName: "alice",
        createdAt: NativeFieldValue.serverTimestamp(),
        updatedAt: NativeFieldValue.serverTimestamp(),
      });
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("writes an update the Admin SDK can apply as it stands", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.update)(
        User.update.make({
          displayName: "alice in chains",
          updatedAt: FieldValue.serverTimestamp,
        }),
      );
      expect(encoded).toStrictEqual({
        displayName: "alice in chains",
        updatedAt: NativeFieldValue.serverTimestamp(),
      });
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});

class Page extends FirestoreModel.Class<Page>("Page")({
  slug: Schema.String,
  visits: FirestoreModel.Number(Schema.Int),
}) {}

describe("Increment", () => {
  it.effect("writes the sentinel the Admin SDK resolves at the server", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.Increment)(
        FieldValue.increment(2),
      );
      expect(encoded).toBeInstanceOf(NativeFieldValue);
      expect(encoded).toStrictEqual(NativeFieldValue.increment(2));
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("writes a move down as the negative the SDK takes", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreSchema.Increment)(
        FieldValue.decrement(2),
      );
      expect(encoded).toStrictEqual(NativeFieldValue.increment(-2));
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("writes an update the Admin SDK can apply as it stands", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.increment(1) }),
      );
      expect(encoded).toStrictEqual({ visits: NativeFieldValue.increment(1) });
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );

  it.effect("sets the number outright where a write was handed one", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.create)(
        Page.create.make({ slug: "home", visits: 0 }),
      );
      expect(encoded).toStrictEqual({ slug: "home", visits: 0 });
    }).pipe(Effect.provide(FirestoreEncoder.layer)),
  );
});
