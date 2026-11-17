import { assert, describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Exit, Queue, Random, Ref, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  Collection,
  DocumentSnapshot,
  FieldValue,
  Firestore,
  FirestoreModel,
  type QuerySnapshot,
  Timestamp,
} from "@visiolab/effect-firebase/firestore";
import { testFirestore } from "@visiolab/firestore-conformance";

describe("Firestore.layerMemory, conformance", () => {
  testFirestore(Firestore.layerMemory, {
    seedRaw: (path, data) =>
      Effect.flatMap(Firestore.MemoryDriver, (driver) => driver.set(path, data)),
    abortCode: "aborted",
  });
});

class Address extends FirestoreModel.Class<Address>("Address")({
  city: Schema.String,
  street: Schema.String,
}) {}

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
  address: Address,
}) {}

const Users = Collection.make("users", User);
const alice = Users.doc(Users.id.make("alice"));

class Visit extends FirestoreModel.Class<Visit>("Visit")({
  at: FirestoreModel.Timestamp(Schema.DateTimeUtc),
  seenAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
}) {}

const Visits = Collection.make("visits", Visit);
const visit = Visits.doc(Visits.id.make("visit"));

const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
  DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

const memory = <A, E>(effect: Effect.Effect<A, E, Firestore.Firestore | Firestore.MemoryDriver>) =>
  Effect.provide(effect, Firestore.layerMemory);

const Contacts = Users.subcollection("contacts", User);

const berlin = { name: "Alice", address: { city: "Berlin", street: "Main" } };

/** Runs `stream` into a queue for the rest of the scope. */
const listening = <A, E>(stream: Stream.Stream<A, E>) =>
  Stream.toQueue(stream, { capacity: "unbounded" });

/**
 * Lets every other fiber run, so a snapshot a commit emitted reaches its
 * queue before the next commit could take its place in the listener's
 * buffer of one.
 */
const settle = Effect.repeat(Effect.yieldNow, { times: 10 });

/** The next city `doc` emits, and the next cities `docs` emits. */
const readAll = <E1, E2>(
  doc: Queue.Dequeue<DocumentSnapshot.DocumentSnapshot<typeof Users>, E1>,
  docs: Queue.Dequeue<QuerySnapshot.QuerySnapshot<typeof Users>, E2>,
) =>
  Effect.all([
    Effect.flatMap(Queue.take(doc), (snapshot) =>
      Effect.map(read(snapshot), (user) => user.address.city),
    ),
    Effect.flatMap(Queue.take(docs), (snapshot) =>
      Effect.forEach(snapshot.docs, (user) => Effect.map(user.data, (data) => data.address.city)),
    ),
  ]);

describe("Firestore.layerMemory", () => {
  it.effect("reads raw data seeded through the driver", () =>
    memory(
      Effect.gen(function* () {
        const firestore = yield* Firestore.Firestore;
        const driver = yield* Firestore.MemoryDriver;

        yield* driver.set("users/alice", {
          name: "Alice",
          address: { city: "Berlin", street: "Main" },
        });

        expect(yield* read(yield* firestore.getDoc(alice))).toMatchObject({
          name: "Alice",
          address: { city: "Berlin", street: "Main" },
        });
      }),
    ),
  );

  it.effect("seeds raw data no model would write, which fails the read", () =>
    memory(
      Effect.gen(function* () {
        const firestore = yield* Firestore.Firestore;
        const driver = yield* Firestore.MemoryDriver;

        yield* driver.set("users/alice", { name: 42 });

        const error = yield* Effect.flip(read(yield* firestore.getDoc(alice)));
        expect(Schema.isSchemaError(error)).toBe(true);
      }),
    ),
  );

  it.effect("shows what a write through Firestore stored, raw", () =>
    memory(
      Effect.gen(function* () {
        const firestore = yield* Firestore.Firestore;
        const driver = yield* Firestore.MemoryDriver;

        yield* firestore.setDoc(alice, {
          name: "Alice",
          address: { city: "Berlin", street: "Main" },
        });

        const stored = { name: "Alice", address: { city: "Berlin", street: "Main" } };
        expect(yield* driver.get("users/alice")).toStrictEqual(stored);
        expect(yield* driver.get("users/bob")).toBeUndefined();
        expect(yield* driver.documents).toStrictEqual(new Map([["users/alice", stored]]));
      }),
    ),
  );

  it.effect("removes a document through the driver", () =>
    memory(
      Effect.gen(function* () {
        const firestore = yield* Firestore.Firestore;
        const driver = yield* Firestore.MemoryDriver;

        yield* driver.set("users/alice", { name: "Alice" });
        yield* driver.delete("users/alice");

        expect((yield* firestore.getDoc(alice))._tag).toBe("Missing");
        expect((yield* driver.documents).size).toBe(0);
      }),
    ),
  );

  it.effect("dies when the driver is handed a sentinel", () =>
    memory(
      Effect.gen(function* () {
        const driver = yield* Firestore.MemoryDriver;

        const exit = yield* Effect.exit(
          driver.set("users/alice", { name: "Alice", seenAt: FieldValue.serverTimestamp }),
        );

        assert(Exit.isFailure(exit));
        expect(Exit.hasDies(exit)).toBe(true);
        expect((yield* driver.documents).size).toBe(0);
      }),
    ),
  );

  it.effect("starts empty each time the layer is built", () =>
    Effect.gen(function* () {
      yield* memory(
        Effect.gen(function* () {
          const firestore = yield* Firestore.Firestore;
          yield* firestore.setDoc(alice, {
            name: "Alice",
            address: { city: "Berlin", street: "Main" },
          });
        }),
      );

      const documents = yield* memory(
        Effect.gen(function* () {
          const driver = yield* Firestore.MemoryDriver;
          return yield* driver.documents;
        }),
      );
      expect(documents.size).toBe(0);
    }),
  );

  it.effect("updates a nested field by its path, and leaves its siblings alone", () =>
    memory(
      Effect.gen(function* () {
        const firestore = yield* Firestore.Firestore;
        const driver = yield* Firestore.MemoryDriver;

        yield* firestore.setDoc(alice, {
          name: "Alice",
          address: { city: "Berlin", street: "Main" },
        });
        yield* firestore.updateDoc(alice, { address: { city: "Paris" } });

        expect(yield* driver.get("users/alice")).toStrictEqual({
          name: "Alice",
          address: { city: "Paris", street: "Main" },
        });
      }),
    ),
  );

  it.effect("refuses to update a missing document with not-found", () =>
    memory(
      Effect.gen(function* () {
        const firestore = yield* Firestore.Firestore;

        const error = yield* Effect.flip(firestore.updateDoc(alice, { name: "Alice" }));

        expect(error).toBeInstanceOf(Firestore.FirestoreError);
        assert(error._tag === "FirestoreError");
        expect(error.code).toBe("not-found");
      }),
    ),
  );

  describe("listeners", () => {
    it.effect("emits nothing for a commit that leaves what it covers unchanged", () =>
      memory(
        Effect.gen(function* () {
          const firestore = yield* Firestore.Firestore;
          yield* firestore.setDoc(alice, berlin);
          const doc = yield* listening(firestore.streamDoc(alice));
          const docs = yield* listening(firestore.streamDocs(Users.collection()));
          expect(yield* readAll(doc, docs)).toStrictEqual(["Berlin", ["Berlin"]]);

          yield* firestore.setDoc(alice, berlin);
          yield* settle;
          yield* firestore.deleteDoc(Users.doc(Users.id.make("bob")));
          yield* settle;
          // In a subcollection, so outside the collection the listener covers.
          yield* firestore.setDoc(Contacts.doc(Users.id.make("alice"), Contacts.id.make("carol")), {
            name: "Carol",
            address: { city: "Rome", street: "Via" },
          });
          yield* settle;
          yield* firestore.updateDoc(alice, { address: { city: "Paris" } });

          expect(yield* readAll(doc, docs)).toStrictEqual(["Paris", ["Paris"]]);
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("wakes on a write through the driver, as from another client", () =>
      memory(
        Effect.gen(function* () {
          const firestore = yield* Firestore.Firestore;
          const driver = yield* Firestore.MemoryDriver;
          const doc = yield* listening(firestore.streamDoc(alice));
          const docs = yield* listening(firestore.streamDocs(Users.collection()));
          expect(DocumentSnapshot.isMissing(yield* Queue.take(doc))).toBe(true);
          expect((yield* Queue.take(docs)).docs).toEqual([]);

          yield* driver.set("users/alice", berlin);
          expect(yield* readAll(doc, docs)).toStrictEqual(["Berlin", ["Berlin"]]);

          yield* driver.delete("users/alice");
          expect(DocumentSnapshot.isMissing(yield* Queue.take(doc))).toBe(true);
          expect((yield* Queue.take(docs)).docs).toEqual([]);
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("sees the writes of a transaction as one change", () =>
      memory(
        Effect.gen(function* () {
          const firestore = yield* Firestore.Firestore;
          const docs = yield* listening(firestore.streamDocs(Users.collection()));
          expect((yield* Queue.take(docs)).docs).toEqual([]);
          yield* settle;

          yield* firestore.runTransaction(
            Effect.gen(function* () {
              const tx = yield* Firestore.Transaction;
              yield* tx.setDoc(alice, berlin);
              yield* tx.setDoc(Users.doc(Users.id.make("bob")), { ...berlin, name: "Bob" });
            }),
          );
          yield* settle;

          const snapshots = yield* Queue.clear(docs);
          expect(snapshots.map((snapshot) => snapshot.docs.map((doc) => doc.id))).toEqual([
            ["alice", "bob"],
          ]);
        }).pipe(Effect.scoped),
      ),
    );
  });

  describe("transactions", () => {
    it.effect("runs the body again when the driver writes between its read and its commit", () =>
      memory(
        Effect.gen(function* () {
          const firestore = yield* Firestore.Firestore;
          const driver = yield* Firestore.MemoryDriver;
          yield* firestore.setDoc(alice, berlin);
          const runs = yield* Ref.make(0);

          yield* firestore.runTransaction(
            Effect.gen(function* () {
              const run = yield* Ref.updateAndGet(runs, (n) => n + 1);
              const tx = yield* Firestore.Transaction;
              const user = yield* read(yield* tx.getDoc(alice));
              if (run === 1) {
                yield* driver.set("users/alice", {
                  name: "Alice",
                  address: { city: "Rome", street: "Via" },
                });
              }
              yield* tx.updateDoc(alice, { name: `Alice of ${user.address.city}` });
            }),
          );

          expect(yield* Ref.get(runs)).toBe(2);
          expect((yield* read(yield* firestore.getDoc(alice))).name).toBe("Alice of Rome");
        }),
      ),
    );

    it.effect("applies none of its writes when the commit refuses one", () =>
      memory(
        Effect.gen(function* () {
          const firestore = yield* Firestore.Firestore;
          const bob = Users.doc(Users.id.make("bob"));

          const error = yield* Effect.flip(
            firestore.runTransaction(
              Effect.gen(function* () {
                const tx = yield* Firestore.Transaction;
                yield* tx.setDoc(bob, { ...berlin, name: "Bob" });
                yield* tx.updateDoc(alice, { name: "Alicia" });
              }),
            ),
          );

          assert(error instanceof Firestore.FirestoreError);
          expect(error.code).toBe("not-found");
          expect((yield* firestore.getDoc(bob))._tag).toBe("Missing");
        }),
      ),
    );

    it.effect("fails with code aborted once it runs out of attempts", () =>
      memory(
        Effect.gen(function* () {
          const firestore = yield* Firestore.Firestore;
          const driver = yield* Firestore.MemoryDriver;
          yield* firestore.setDoc(alice, berlin);
          const runs = yield* Ref.make(0);

          const error = yield* Effect.flip(
            firestore.runTransaction(
              Effect.gen(function* () {
                const run = yield* Ref.updateAndGet(runs, (n) => n + 1);
                const tx = yield* Firestore.Transaction;
                yield* tx.getDoc(alice);
                yield* driver.set("users/alice", { ...berlin, name: `Alice ${run}` });
                yield* tx.updateDoc(alice, { name: "Mine" });
              }),
              { maxAttempts: 3 },
            ),
          );

          assert(error instanceof Firestore.FirestoreError);
          expect(error.code).toBe("aborted");
          expect(yield* Ref.get(runs)).toBe(3);
          expect((yield* read(yield* firestore.getDoc(alice))).name).toBe("Alice 3");
        }),
      ),
    );
  });

  it.effect("adds documents under ids in Firestore's format, the same for the same seed", () =>
    Effect.gen(function* () {
      const add = memory(
        Effect.gen(function* () {
          const firestore = yield* Firestore.Firestore;
          const first = yield* firestore.addDoc(Users.collection(), {
            name: "Alice",
            address: { city: "Berlin", street: "Main" },
          });
          const second = yield* firestore.addDoc(Users.collection(), {
            name: "Bob",
            address: { city: "Paris", street: "High" },
          });
          return [first.id, second.id];
        }),
      ).pipe(Random.withSeed("ids"));

      const ids = yield* add;

      for (const id of ids) {
        expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
      }
      expect(ids[0]).not.toBe(ids[1]);
      expect(yield* add).toStrictEqual(ids);
    }),
  );

  it.effect("resolves a server timestamp to the time Clock tells at the commit", () =>
    memory(
      Effect.gen(function* () {
        const firestore = yield* Firestore.Firestore;
        const driver = yield* Firestore.MemoryDriver;
        const created = Date.parse("2026-01-02T03:04:05.678Z");
        const seen = Date.parse("2026-01-03T00:00:00.000Z");

        yield* TestClock.setTime(created);
        yield* firestore.setDoc(visit, {
          at: FieldValue.serverTimestamp,
          seenAt: FieldValue.serverTimestamp,
        });
        yield* TestClock.setTime(seen);
        yield* firestore.updateDoc(visit, { seenAt: FieldValue.serverTimestamp });

        expect(yield* driver.get("visits/visit")).toStrictEqual({
          at: Timestamp.fromMillisUnsafe(created),
          seenAt: Timestamp.fromMillisUnsafe(seen),
        });
        const data = yield* read(yield* firestore.getDoc(visit));
        expect(DateTime.toEpochMillis(data.at)).toBe(created);
        expect(DateTime.toEpochMillis(data.seenAt)).toBe(seen);
      }),
    ),
  );
});
