import * as App from "@visiolab/effect-firebase-admin/app/App";
import * as AdminFirestore from "@visiolab/effect-firebase-admin/firestore/AdminFirestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as Firestore from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import type * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import { Context, Effect, Layer, Schema } from "effect";
import type * as AdminSdk from "firebase-admin/firestore";
import { describe, expect, test } from "tstyche";

declare const firestore: Firestore.Firestore;
declare const adminFirestore: AdminFirestore.AdminFirestore;
declare const adminTx: AdminFirestore.AdminTransaction;
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

/**
 * Another backend's richer transaction, with the same methods as Admin
 * Transaction and a type id of its own.
 */
interface LookalikeTransaction extends Firestore.TransactionBase {
  readonly "~LookalikeTransaction": "~LookalikeTransaction";
  readonly getDocs: Firestore.Firestore["getDocs"];
}
declare const lookalikeFirestore: Firestore.With<never, never, {}, LookalikeTransaction>;

/**
 * Another backend's richer Firestore, with the same members as Admin Firestore
 * and a type id of its own.
 */
interface LookalikeFirestore extends Firestore.With<
  never,
  never,
  {},
  AdminFirestore.AdminTransaction
> {
  readonly "~LookalikeFirestore": "~LookalikeFirestore";
  readonly instance: AdminSdk.Firestore;
}

const adminProgram = Effect.asVoid(Effect.service(AdminFirestore.AdminFirestore));
const portableLayer = Layer.succeed(Firestore.Firestore, firestore);

describe("AdminFirestore", () => {
  test("is not a Firestore", () => {
    expect<AdminFirestore.AdminFirestore>().type.not.toBeAssignableTo<Firestore.Firestore>();
  });

  test("is not provided by a Firestore layer", () => {
    expect(Effect.provide(adminProgram, portableLayer)).type.toBe<
      Effect.Effect<void, never, AdminFirestore.AdminFirestore>
    >();
    expect(Layer.provide(Layer.effectDiscard(adminProgram), portableLayer)).type.toBe<
      Layer.Layer<never, never, AdminFirestore.AdminFirestore>
    >();
  });

  test("yields a service that is also a Firestore", () => {
    expect(Effect.service(AdminFirestore.AdminFirestore)).type.toBe<
      Effect.Effect<
        AdminFirestore.AdminFirestore & Firestore.Firestore,
        never,
        AdminFirestore.AdminFirestore
      >
    >();
  });

  test("is built as a Firestore too", () => {
    expect(AdminFirestore.make()).type.toBe<
      Effect.Effect<AdminFirestore.AdminFirestore & Firestore.Firestore, never, App.App>
    >();
  });

  test("is told apart from another backend's Firestore with the same members", () => {
    expect<AdminFirestore.AdminFirestore>().type.not.toBeAssignableTo<LookalikeFirestore>();
  });

  test("hands out the Admin SDK's own Firestore as its instance", () => {
    expect<AdminFirestore.AdminFirestore["instance"]>().type.toBe<AdminSdk.Firestore>();
  });

  test("has an instance on Admin Firestore and none on Firestore", () => {
    expect<Firestore.Firestore>().type.not.toHaveProperty("instance");
  });
});

describe("AdminTransaction", () => {
  test("reads and writes single documents as a Transaction does", () => {
    expect<AdminFirestore.AdminTransaction["getDoc"]>().type.toBe<
      Firestore.Transaction["getDoc"]
    >();
    expect<AdminFirestore.AdminTransaction["setDoc"]>().type.toBe<
      Firestore.Transaction["setDoc"]
    >();
    expect<AdminFirestore.AdminTransaction["updateDoc"]>().type.toBe<
      Firestore.Transaction["updateDoc"]
    >();
  });

  test("is not a Transaction", () => {
    expect<AdminFirestore.AdminTransaction>().type.not.toBeAssignableTo<Firestore.Transaction>();
  });

  test("yields a transaction that is also a Transaction", () => {
    expect(Effect.service(AdminFirestore.AdminTransaction)).type.toBe<
      Effect.Effect<
        AdminFirestore.AdminTransaction & Firestore.Transaction,
        never,
        AdminFirestore.AdminTransaction
      >
    >();
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

  test("leaves the Admin Transaction to the caller of a backend offering a lookalike", () => {
    expect(lookalikeFirestore.runTransaction(adminBody)).type.toBe<
      Effect.Effect<boolean, Firestore.FirestoreError, Step | AdminFirestore.AdminTransaction>
    >();
  });
});
