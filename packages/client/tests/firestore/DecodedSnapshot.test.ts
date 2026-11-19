import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as ClientDocumentSnapshot from "../../src/firestore/ClientDocumentSnapshot.ts";
import * as ClientQuerySnapshot from "../../src/firestore/ClientQuerySnapshot.ts";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}

const Users = Collection.make("users", User);
const alice = Users.doc(Users.id.make("alice"));

const fromServer = { fromCache: false, hasPendingWrites: false };
const pending = { fromCache: true, hasPendingWrites: true };

describe("ClientDocumentSnapshot.decode", () => {
  it.effect("keeps the metadata of an existing snapshot beside its decoded data", () =>
    Effect.gen(function* () {
      const decoded = yield* ClientDocumentSnapshot.decode(
        ClientDocumentSnapshot.make(alice, { name: "Alice" }, pending),
      );
      assert(decoded._tag === "Existing");
      expect(decoded.data).toEqual(new User({ name: "Alice" }));
      expect(decoded.metadata).toEqual(pending);
    }),
  );

  it.effect("keeps the metadata of a missing snapshot", () =>
    Effect.gen(function* () {
      const decoded = yield* ClientDocumentSnapshot.decode(
        ClientDocumentSnapshot.make(alice, undefined, fromServer),
      );
      assert(decoded._tag === "Missing");
      expect(decoded.metadata).toEqual(fromServer);
    }),
  );

  it.effect("builds a decoded missing snapshot that is not a lazy one", () =>
    Effect.gen(function* () {
      const decoded = yield* ClientDocumentSnapshot.decode(
        ClientDocumentSnapshot.missing(alice, fromServer),
      );
      expect(DocumentSnapshot.isDocumentSnapshot(decoded)).toBe(false);
      expect(decoded.toJSON()).toEqual({
        _id: "DecodedDocumentSnapshot",
        _tag: "Missing",
        ref: "users/alice",
        metadata: fromServer,
      });
    }),
  );
});

describe("ClientQuerySnapshot.decode", () => {
  it.effect("keeps the metadata of the read and of each document", () =>
    Effect.gen(function* () {
      const decoded = yield* ClientQuerySnapshot.decode(
        ClientQuerySnapshot.make(
          [ClientDocumentSnapshot.existing(alice, { name: "Alice" }, pending)],
          fromServer,
        ),
      );
      expect(decoded.metadata).toEqual(fromServer);
      expect(decoded.docs[0]?.metadata).toEqual(pending);
      expect(decoded.docs[0]?.data).toEqual(new User({ name: "Alice" }));
    }),
  );

  it.effect("fails as a whole when a document does not match its model", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ClientQuerySnapshot.decode(
          ClientQuerySnapshot.make(
            [ClientDocumentSnapshot.existing(alice, { name: 42 }, fromServer)],
            fromServer,
          ),
        ),
      );
      assert(Schema.isSchemaError(error));
    }),
  );
});
