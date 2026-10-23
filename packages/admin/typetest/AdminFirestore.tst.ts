import * as App from "@visiolab/effect-firebase-admin/App";
import * as AdminFirestore from "@visiolab/effect-firebase-admin/firestore/AdminFirestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import {
  type Firestore,
  type FirestoreError,
  Transaction,
} from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Context, Effect, type Layer, Schema } from "effect";
import type * as AdminSdk from "firebase-admin/firestore";
import { describe, expect, test } from "tstyche";

declare const firestore: Firestore;

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

const Pending = FirestoreModel.Struct({ status: Schema.Literal("pending") });
const Done = FirestoreModel.Struct({ status: Schema.Literal("done"), uri: Schema.String });

class TaskV1 extends FirestoreModel.Class<TaskV1>("TaskV1")({
  version: Schema.Literal(1),
  title: Schema.String,
  state: FirestoreModel.Union([Pending, Done]),
}) {}

class TaskV2 extends FirestoreModel.Class<TaskV2>("TaskV2")({
  version: Schema.Literal(2),
  title: Schema.String,
  state: FirestoreModel.Union([Pending, Done]),
  priority: Schema.Finite,
}) {}

const Tasks = Collection.make("tasks", FirestoreModel.Union([TaskV1, TaskV2]));
const task = Tasks.doc(Tasks.id.make("task"));

const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
  DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

interface Step {
  readonly by: number;
}
const Step = Context.Service<Step>("Step");

describe("AdminFirestore", () => {
  test("is a Firestore", () => {
    expect<AdminFirestore.AdminFirestore>().type.toBeAssignableTo<Firestore>();
  });

  test("hands out the Admin SDK's own Firestore as its instance", () => {
    expect<AdminFirestore.AdminFirestore["instance"]>().type.toBe<AdminSdk.Firestore>();
  });

  test("is the only one of the two with an instance", () => {
    expect<Firestore>().type.not.toHaveProperty("instance");
  });
});

describe("AdminTransaction", () => {
  test("is a Transaction", () => {
    expect<AdminFirestore.AdminTransaction>().type.toBeAssignableTo<Transaction>();
  });

  test("is the only one of the two that reads a whole collection", () => {
    expect<Transaction>().type.not.toHaveProperty("getDocs");
  });
});

describe("layer", () => {
  test("provides Admin Firestore and Firestore, asking only for the App", () => {
    expect(AdminFirestore.layer()).type.toBe<
      Layer.Layer<AdminFirestore.AdminFirestore | Firestore, never, App.App>
    >();
  });
});

describe("setDoc", () => {
  test("asks the caller for nothing the SDK answers for itself", () => {
    expect(firestore.setDoc(hello, { title: "Hello", views: Number.NaN })).type.toBe<
      Effect.Effect<void, FirestoreError | Schema.SchemaError>
    >();
  });
});

describe("updateDoc", () => {
  test("asks the caller for nothing the SDK answers for itself", () => {
    expect(firestore.updateDoc(hello, { views: Number.NaN })).type.toBe<
      Effect.Effect<void, FirestoreError | Schema.SchemaError>
    >();
  });

  test("refuses a checked patch of a key only one member of a union holds", () => {
    // TSTyche checks the message after the directive, as `toRaiseError` would.
    // `toRaiseError` itself can't be used: `vp check` type-checks this file
    // too, and would report the error it expects.
    // @ts-expect-error 'priority' does not exist in type
    void firestore.updateDoc(task, { priority: 2 });
  });
});

const portableRun = firestore.runTransaction(
  Effect.gen(function* () {
    const { by } = yield* Step;
    const tx = yield* Transaction;
    yield* tx.setDoc(Posts.doc(Posts.id.make("step")), { title: "Step", views: by });
    return by;
  }),
);

const adminRun = firestore.runTransaction(
  Effect.gen(function* () {
    yield* Step;
    const admin = yield* AdminFirestore.AdminTransaction;
    const portable = yield* Transaction;
    return admin === portable;
  }),
);

const unionRun = firestore.runTransaction(
  Effect.gen(function* () {
    const tx = yield* Transaction;
    return yield* read(yield* tx.getDoc(task));
  }),
);
declare const readBack: Effect.Success<typeof unionRun>;

describe("runTransaction", () => {
  test("hands the body the services of the caller, and asks for no Transaction", () => {
    expect(portableRun).type.toBe<
      Effect.Effect<number, FirestoreError | Schema.SchemaError, Step>
    >();
  });

  // AdminTransaction extends Transaction, so excluding Transaction alone would
  // already drop it: this can't tell the two signatures apart.
  test("asks for no Admin Transaction either", () => {
    expect(adminRun).type.toBe<Effect.Effect<boolean, FirestoreError, Step>>();
  });

  test("reads a document of a union collection as the member it holds", () => {
    if (readBack.version === 2) {
      expect(readBack).type.toBe<TaskV2>();
    }
  });
});
