import * as App from "@visiolab/effect-firebase-admin/app/App";
import * as AdminFirestore from "@visiolab/effect-firebase-admin/firestore/AdminFirestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as Firestore from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import type * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import { Context, Effect, type Layer, Schema } from "effect";
import type * as AdminSdk from "firebase-admin/firestore";
import { describe, expect, test } from "tstyche";

declare const firestore: Firestore.Firestore;
declare const adminFirestore: AdminFirestore.AdminFirestore;
declare const adminTx: AdminFirestore.AdminTransaction["Service"];
declare const portableTx: Firestore.Transaction;

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}

const Users = Collection.make("users", User);
const UserPosts = Users.subcollection("posts", Post);
const AllUserPosts = CollectionGroup.make(UserPosts);

interface Step {
  readonly by: number;
}
const Step = Context.Service<Step>("Step");

describe("AdminFirestore", () => {
  test("is a Firestore", () => {
    expect<AdminFirestore.AdminFirestore>().type.toBeAssignableTo<Firestore.Firestore>();
  });

  test("hands out the Admin SDK's own Firestore as its instance", () => {
    expect<AdminFirestore.AdminFirestore["instance"]>().type.toBe<AdminSdk.Firestore>();
  });

  test("has an instance on Admin Firestore and none on Firestore", () => {
    expect<Firestore.Firestore>().type.not.toHaveProperty("instance");
  });
});

describe("AdminTransaction", () => {
  test("is a Transaction", () => {
    expect<
      AdminFirestore.AdminTransaction["Service"]
    >().type.toBeAssignableTo<Firestore.Transaction>();
  });

  test("reads a whole collection on Admin Transaction and not on Transaction", () => {
    expect<Firestore.Transaction>().type.not.toHaveProperty("getDocs");
  });

  test("reads a collection, failing with a Firestore error alone", () => {
    expect(adminTx.getDocs(Users.collection())).type.toBe<
      Effect.Effect<QuerySnapshot.QuerySnapshot<typeof Users>, Firestore.FirestoreError>
    >();
  });

  test("reads a Collection Group, failing with an Undefined Collection error too", () => {
    expect(adminTx.getDocs(AllUserPosts)).type.toBe<
      Effect.Effect<
        QuerySnapshot.QuerySnapshot<typeof UserPosts>,
        Firestore.FirestoreError | Firestore.UndefinedCollectionError
      >
    >();
  });

  test("has no Collection Group read on Transaction", () => {
    // @ts-expect-error Property 'getDocs' does not exist
    void portableTx.getDocs(AllUserPosts);
  });
});

describe("layer", () => {
  test("provides Admin Firestore and Firestore, asking only for the App", () => {
    expect(AdminFirestore.layer()).type.toBe<
      Layer.Layer<AdminFirestore.AdminFirestore | Firestore.Firestore, never, App.App>
    >();
  });
});

const adminBody = Effect.gen(function* () {
  yield* Step;
  const admin = yield* AdminFirestore.AdminTransaction;
  const portable = yield* Firestore.Transaction;
  return admin === portable;
});

describe("runTransaction", () => {
  test("hands the body the services of the caller, and asks for no Admin Transaction", () => {
    expect(adminFirestore.runTransaction(adminBody)).type.toBe<
      Effect.Effect<boolean, Firestore.FirestoreError, Step>
    >();
  });

  test("leaves the Admin Transaction to the caller of the portable Firestore", () => {
    expect(firestore.runTransaction(adminBody)).type.toBe<
      Effect.Effect<boolean, Firestore.FirestoreError, Step | AdminFirestore.AdminTransaction>
    >();
  });
});
