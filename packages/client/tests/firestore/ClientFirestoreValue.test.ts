import { assert, describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
  Collection,
  FieldValue,
  FirestoreModel,
  GeoPoint,
  Timestamp,
} from "@visiolab/effect-firebase/firestore";
import { initializeApp } from "firebase/app";
import * as Client from "firebase/firestore";
import * as ClientFirestoreValue from "../../src/firestore/ClientFirestoreValue.ts";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}

const Users = Collection.make("users", User);

// Building SDK values reaches no server, so the database is never connected.
const firestore = Client.getFirestore(
  initializeApp({ projectId: "demo-client-firestore-value" }, "firestore-value"),
);

describe("ClientFirestoreValue", () => {
  it("turns Firestore Values into the client SDK's own", () => {
    const sdk = ClientFirestoreValue.toClient(
      {
        at: Timestamp.makeUnsafe(1, 2000),
        where: GeoPoint.makeUnsafe(1, 2),
        who: Users.doc(Users.id.make("ada")),
        bytes: new Uint8Array([1, 2]),
        nested: [{ n: 1, s: "s", b: true, z: null }],
        createdAt: FieldValue.serverTimestamp,
        tags: FieldValue.arrayUnion(Timestamp.makeUnsafe(3, 0)),
      },
      firestore,
    ) as Record<string, unknown>;

    expect(sdk["at"]).toEqual(new Client.Timestamp(1, 2000));
    expect(sdk["where"]).toEqual(new Client.GeoPoint(1, 2));
    expect(sdk["who"]).toBeInstanceOf(Client.DocumentReference);
    expect((sdk["who"] as Client.DocumentReference).path).toBe("users/ada");
    expect((sdk["who"] as Client.DocumentReference).firestore).toBe(firestore);
    expect(Client.Bytes.fromUint8Array(new Uint8Array([1, 2])).isEqual(sdk["bytes"] as never)).toBe(
      true,
    );
    expect(sdk["nested"]).toEqual([{ n: 1, s: "s", b: true, z: null }]);
    expect(Client.serverTimestamp().isEqual(sdk["createdAt"] as Client.FieldValue)).toBe(true);
    expect(
      Client.arrayUnion(new Client.Timestamp(3, 0)).isEqual(sdk["tags"] as Client.FieldValue),
    ).toBe(true);
  });

  it("turns the client SDK's values into Firestore Values", () => {
    const value = Result.getOrThrow(
      ClientFirestoreValue.fromClient({
        at: new Client.Timestamp(1, 2000),
        where: new Client.GeoPoint(1, 2),
        who: Client.doc(firestore, "users/ada"),
        bytes: Client.Bytes.fromUint8Array(new Uint8Array([1, 2])),
        nested: [{ n: 1, s: "s", b: true, z: null }],
      }),
    ) as Record<string, unknown>;

    expect(value["at"]).toEqual(Timestamp.makeUnsafe(1, 2000));
    expect(value["where"]).toEqual(GeoPoint.makeUnsafe(1, 2));
    expect(Collection.isDocumentReference(value["who"])).toBe(true);
    expect(Collection.fromPath(Users, (value["who"] as { path: string }).path)).toEqual(
      Collection.fromPath(Users, "users/ada"),
    );
    expect(value["bytes"]).toEqual(new Uint8Array([1, 2]));
    expect(value["nested"]).toEqual([{ n: 1, s: "s", b: true, z: null }]);
  });

  it("refuses a client SDK value outside the Firestore Value union, naming where it is", () => {
    const result = ClientFirestoreValue.fromClient({ a: { b: [Client.vector([1])] } });

    assert(Result.isFailure(result));
    expect(result.failure._tag).toBe("FirestoreError");
    expect(result.failure.message).toContain('"a.b[0]"');
    expect(result.failure.message).toContain("VectorValue");
  });
});
