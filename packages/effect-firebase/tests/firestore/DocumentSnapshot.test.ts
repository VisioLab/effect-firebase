import { assert, describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Equal, Schema, SchemaGetter } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as DocumentSnapshot from "../../src/firestore/DocumentSnapshot.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";
import * as Timestamp from "../../src/firestore/Timestamp.ts";

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
  createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
}) {}

const Users = Collection.make("users", User);

const alice = Users.id.make("alice");

describe("make", () => {
  it("reads a document the SDK handed no data for as missing", () => {
    const snapshot = DocumentSnapshot.make(Users.doc(alice), undefined);
    assert(DocumentSnapshot.isMissing(snapshot));
    expect(snapshot.ref.path).toBe("users/alice");
    expect(snapshot.id).toBe("alice");
  });

  it("reads a document the SDK handed data for as there, holding that data", () => {
    const raw = { name: "Alice", createdAt: Timestamp.makeUnsafe(1, 2) };
    const snapshot = DocumentSnapshot.make(Users.doc(alice), raw);
    assert(DocumentSnapshot.isExisting(snapshot));
    expect(snapshot.ref.path).toBe("users/alice");
    expect(snapshot.id).toBe("alice");
    expect(snapshot.raw).toBe(raw);
  });
});

describe("data", () => {
  it.effect("decodes what the SDK read through the collection's schema", () =>
    Effect.gen(function* () {
      const snapshot = DocumentSnapshot.existing(Users.doc(alice), {
        name: "Alice",
        createdAt: Timestamp.makeUnsafe(1_700_000_000, 123_456_789),
      });
      const user = yield* snapshot.data;
      expect(user).toBeInstanceOf(User);
      expect(user.name).toBe("Alice");
      expect(Equal.equals(user.createdAt, Timestamp.makeUnsafe(1_700_000_000, 123_456_789))).toBe(
        true,
      );
    }),
  );

  it.effect("fails only once its data is read, where the document does not match the schema", () =>
    Effect.gen(function* () {
      const snapshot = DocumentSnapshot.make(Users.doc(alice), { name: 42 });
      assert(DocumentSnapshot.isExisting(snapshot));
      const error = yield* Effect.flip(snapshot.data);
      assert(Schema.isSchemaError(error));
    }),
  );

  it.effect("decodes only when it is run, and each time it is", () =>
    Effect.gen(function* () {
      let decoded = 0;
      class Count extends FirestoreModel.Class<Count>("Count")({
        name: Schema.String.pipe(
          Schema.decodeTo(Schema.String, {
            decode: SchemaGetter.transform((s: string) => {
              decoded++;
              return s;
            }),
            encode: SchemaGetter.transform((s: string) => s),
          }),
        ),
      }) {}
      const Counted = Collection.make("counted", Count);
      const snapshot = DocumentSnapshot.existing(Counted.doc(Counted.id.make("a")), { name: "A" });
      const data = snapshot.data;
      expect(decoded).toBe(0);
      yield* data;
      yield* data;
      expect(decoded).toBe(2);
    }),
  );
});

describe("guards", () => {
  it("narrow a snapshot without losing the collection it is in", () => {
    const snapshot = DocumentSnapshot.make(Users.doc(alice), undefined);
    if (DocumentSnapshot.isExisting(snapshot)) {
      expectTypeOf(snapshot).toEqualTypeOf<DocumentSnapshot.Existing<typeof Users>>();
      expectTypeOf(snapshot.data).toEqualTypeOf<Effect.Effect<User, Schema.SchemaError>>();
    }
    if (DocumentSnapshot.isMissing(snapshot)) {
      expectTypeOf(snapshot).toEqualTypeOf<DocumentSnapshot.Missing<typeof Users>>();
      expectTypeOf(snapshot.id).toEqualTypeOf<Collection.Id<typeof Users>>();
    }
  });

  it("tell a snapshot apart from anything else", () => {
    expect(DocumentSnapshot.isDocumentSnapshot(DocumentSnapshot.missing(Users.doc(alice)))).toBe(
      true,
    );
    expect(DocumentSnapshot.isDocumentSnapshot(Users.doc(alice))).toBe(false);
    expect(DocumentSnapshot.isDocumentSnapshot({ _tag: "Missing" })).toBe(false);
  });
});

describe("toJSON", () => {
  it("shows where a snapshot was read, and what it held rather than how it decodes", () => {
    expect(DocumentSnapshot.missing(Users.doc(alice)).toJSON()).toEqual({
      _id: "DocumentSnapshot",
      _tag: "Missing",
      ref: "users/alice",
    });
    expect(DocumentSnapshot.existing(Users.doc(alice), { name: "Alice" }).toJSON()).toEqual({
      _id: "DocumentSnapshot",
      _tag: "Existing",
      ref: "users/alice",
      raw: { name: "Alice" },
    });
  });
});
