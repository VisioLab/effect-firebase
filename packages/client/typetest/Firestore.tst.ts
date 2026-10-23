import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import {
  type Firestore,
  type FirestoreError,
  Transaction,
} from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Context, Effect, Schema } from "effect";
import { describe, expect, test } from "tstyche";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);

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

declare const firestore: Firestore;

const readTask = firestore.runTransaction(
  Effect.gen(function* () {
    const tx = yield* Transaction;
    return yield* read(yield* tx.getDoc(task));
  }),
);
declare const second: Effect.Success<typeof readTask>;

interface Step {
  readonly by: number;
}
const Step = Context.Service<Step>("Step");

describe("setDoc", () => {
  test("asks the caller for nothing the SDK answers for itself", () => {
    expect(
      firestore.setDoc(Posts.doc(Posts.id.make("hello")), { title: "Hello", views: 1 }),
    ).type.toBe<Effect.Effect<void, FirestoreError | Schema.SchemaError>>();
  });
});

describe("updateDoc", () => {
  // A `toRaiseError` would fail `vp check`, which type-checks this file too.
  // TSTyche checks the message after `@ts-expect-error` instead.
  test("refuses a key only one member of a union holds", () => {
    // @ts-expect-error 'priority' does not exist in type
    void firestore.updateDoc(task, { priority: 2 });
  });
});

describe("runTransaction", () => {
  test("reads a document of a union as the member it narrows to", () => {
    if (second.version === 2) {
      expect(second).type.toBe<TaskV2>();
    }
  });

  test("hands the body the services of the caller, and asks for no Transaction", () => {
    expect(
      firestore.runTransaction(
        Effect.gen(function* () {
          const { by } = yield* Step;
          const tx = yield* Transaction;
          yield* tx.setDoc(Posts.doc(Posts.id.make("hello")), { title: "Hello", views: by });
          return by;
        }),
      ),
    ).type.toBe<Effect.Effect<number, FirestoreError | Schema.SchemaError, Step>>();
  });
});
