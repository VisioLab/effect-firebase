import * as App from "@visiolab/effect-firebase-admin/App";
import * as AdminFirestore from "@visiolab/effect-firebase-admin/firestore/AdminFirestore";
import * as Firestore from "@visiolab/effect-firebase/firestore/Firestore";
import { Context, Effect, type Layer } from "effect";
import type * as AdminSdk from "firebase-admin/firestore";
import { describe, expect, test } from "tstyche";

declare const firestore: Firestore.Firestore;

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
    expect<AdminFirestore.AdminTransaction>().type.toBeAssignableTo<Firestore.Transaction>();
  });

  test("reads a whole collection on Admin Transaction and not on Transaction", () => {
    expect<Firestore.Transaction>().type.not.toHaveProperty("getDocs");
  });
});

describe("layer", () => {
  test("provides Admin Firestore and Firestore, asking only for the App", () => {
    expect(AdminFirestore.layer()).type.toBe<
      Layer.Layer<AdminFirestore.AdminFirestore | Firestore.Firestore, never, App.App>
    >();
  });
});

const adminRun = firestore.runTransaction(
  Effect.gen(function* () {
    yield* Step;
    const admin = yield* AdminFirestore.AdminTransaction;
    const portable = yield* Firestore.Transaction;
    return admin === portable;
  }),
);

describe("runTransaction", () => {
  // AdminTransaction extends Transaction, so excluding Transaction alone would
  // already drop it: this can't tell the two signatures apart.
  test("hands the body the services of the caller, and asks for no Admin Transaction", () => {
    expect(adminRun).type.toBe<Effect.Effect<boolean, Firestore.FirestoreError, Step>>();
  });
});
