import { describe, expect, it } from "@effect/vitest";
import { Equal, Option, Result } from "effect";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as GeoPoint from "@visiolab/effect-firebase/firestore/GeoPoint";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import * as Admin from "firebase-admin/firestore";
import { Schema } from "effect";
import * as AdminFirestoreValue from "../../src/firestore/AdminFirestoreValue.ts";

// Never reaches a server: building values and references is all it is for.
const firestore = new Admin.Firestore({ projectId: "demo-firestore-value", databaseId: "other" });

class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
const Posts = Collection.make("posts", Post);

describe("toAdmin", () => {
  it("turns Firestore Values into the Admin SDK's own, all the way down", () => {
    const out = AdminFirestoreValue.toAdmin(
      {
        "a.b": [Timestamp.makeUnsafe(1, 2), { at: GeoPoint.makeUnsafe(3, 4) }],
        ref: Posts.doc(Posts.id.make("hello")),
        bytes: new Uint8Array([1]),
        views: FieldValue.increment(2),
        tags: FieldValue.arrayUnion(Timestamp.makeUnsafe(5, 6)),
        gone: FieldValue.deleteField,
        stamped: FieldValue.serverTimestamp,
        plain: null,
      },
      firestore,
    ) as Record<string, any>;

    expect(Object.keys(out)).toContain("a.b");
    expect(out["a.b"][0].isEqual(new Admin.Timestamp(1, 2))).toBe(true);
    expect(out["a.b"][1].at.isEqual(new Admin.GeoPoint(3, 4))).toBe(true);
    expect(out.ref).toBeInstanceOf(Admin.DocumentReference);
    expect(out.ref.path).toBe("posts/hello");
    // Built against the database it was handed, so it points into that one.
    expect(out.ref.firestore.databaseId).toBe("other");
    expect(out.bytes).toEqual(new Uint8Array([1]));
    expect(out.views.isEqual(Admin.FieldValue.increment(2))).toBe(true);
    expect(out.tags.isEqual(Admin.FieldValue.arrayUnion(new Admin.Timestamp(5, 6)))).toBe(true);
    expect(out.gone.isEqual(Admin.FieldValue.delete())).toBe(true);
    expect(out.stamped.isEqual(Admin.FieldValue.serverTimestamp())).toBe(true);
    expect(out.plain).toBeNull();
  });
});

describe("fromAdmin", () => {
  it("turns the Admin SDK's values into Firestore Values, all the way down", () => {
    const result = AdminFirestoreValue.fromAdmin({
      at: new Admin.Timestamp(1, 2),
      nested: [{ where: new Admin.GeoPoint(3, 4) }],
      bytes: Buffer.from([1, 2]),
      views: Admin.FieldValue.increment(2),
      text: "hello",
    });

    assertSuccess(result);
    const out = result.success as Record<string, any>;
    expect(out.at).toEqual(Timestamp.makeUnsafe(1, 2));
    expect(Timestamp.isTimestamp(out.at)).toBe(true);
    expect(GeoPoint.isGeoPoint(out.nested[0].where)).toBe(true);
    expect(out.nested[0].where).toEqual(GeoPoint.makeUnsafe(3, 4));
    expect(out.bytes.constructor).toBe(Uint8Array);
    expect([...out.bytes]).toEqual([1, 2]);
    expect(FieldValue.isIncrement(out.views) && out.views.by).toBe(2);
    expect(out.text).toBe("hello");
  });

  it("reads a reference back as the portable one at its path", () => {
    const result = AdminFirestoreValue.fromAdmin({
      ref: firestore.doc("posts/hello"),
      nested: [firestore.doc("posts/hello/comments/first")],
    });

    assertSuccess(result);
    const out = result.success as Record<string, any>;
    expect(Collection.isDocumentReference(out.ref)).toBe(true);
    expect(
      Equal.equals(out.ref, Collection.fromPathUntyped("posts/hello").pipe(Option.getOrThrow)),
    ).toBe(true);
    expect(out.nested[0].path).toBe("posts/hello/comments/first");
  });

  it("fails on a value outside Firestore Values, naming where it is", () => {
    const result = AdminFirestoreValue.fromAdmin({
      deep: [{ embedding: Admin.FieldValue.vector([1, 2]) }],
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain('"deep[0].embedding"');
      expect(result.failure.message).toContain("VectorValue");
    }
  });
});

function assertSuccess<A, E>(result: Result.Result<A, E>): asserts result is Result.Success<A, E> {
  expect(Result.isSuccess(result)).toBe(true);
}
