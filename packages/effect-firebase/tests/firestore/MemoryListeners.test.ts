import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Schema, Stream } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as Firestore from "../../src/firestore/Firestore.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as memory from "../../src/firestore/internal/memory.ts";

// Whether a listener is still attached can't be seen through the public API,
// so these tests look at the In-memory Firestore's listener registry.

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}

const Users = Collection.make("users", User);
const alice = Users.doc(Users.id.make("alice"));

const inMemory = () => {
  const store = memory.makeStore();
  return { store, firestore: Firestore.make(memory.hooks(store)) };
};

describe("In-memory Firestore listeners", () => {
  it.effect("stay attached until the stream is interrupted, and detach then", () =>
    Effect.gen(function* () {
      const { store, firestore } = inMemory();

      const doc = yield* Effect.forkChild(Stream.runDrain(firestore.streamDoc(alice)));
      const docs = yield* Effect.forkChild(
        Stream.runDrain(firestore.streamDocs(Users.collection())),
      );
      yield* Effect.yieldNow;
      expect(store.listeners.size).toBe(2);

      yield* firestore.setDoc(alice, { name: "Alice" });
      yield* Effect.yieldNow;
      expect(doc.pollUnsafe()).toBeUndefined();
      expect(docs.pollUnsafe()).toBeUndefined();

      yield* Fiber.interrupt(doc);
      expect(store.listeners.size).toBe(1);
      yield* Fiber.interrupt(docs);
      expect(store.listeners.size).toBe(0);
    }),
  );

  it.effect("detach once a reader has taken what it wants", () =>
    Effect.gen(function* () {
      const { store, firestore } = inMemory();

      yield* firestore.streamDoc(alice).pipe(Stream.take(1), Stream.runDrain);

      expect(store.listeners.size).toBe(0);
    }),
  );
});
