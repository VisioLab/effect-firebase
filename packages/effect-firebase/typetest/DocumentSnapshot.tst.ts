import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import { type Effect, Schema } from "effect";
import { describe, expect, test } from "tstyche";

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
  createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
}) {}

const Users = Collection.make("users", User);

const snapshot = DocumentSnapshot.make(Users.doc(Users.id.make("alice")), undefined);

describe("isExisting", () => {
  test("narrows a Document Snapshot to one that exists, without losing its collection", () => {
    if (DocumentSnapshot.isExisting(snapshot)) {
      expect(snapshot).type.toBe<DocumentSnapshot.Existing<typeof Users>>();
    }
  });

  test("decodes the data of an existing document into the model, failing with a schema error", () => {
    if (DocumentSnapshot.isExisting(snapshot)) {
      expect(snapshot.data).type.toBe<Effect.Effect<User, Schema.SchemaError>>();
    }
  });
});

describe("isMissing", () => {
  test("narrows a Document Snapshot to one that is missing, without losing its collection", () => {
    if (DocumentSnapshot.isMissing(snapshot)) {
      expect(snapshot).type.toBe<DocumentSnapshot.Missing<typeof Users>>();
    }
  });

  test("keeps the id of a missing document typed by its collection", () => {
    if (DocumentSnapshot.isMissing(snapshot)) {
      expect(snapshot.id).type.toBe<Collection.Id<typeof Users>>();
    }
  });
});
