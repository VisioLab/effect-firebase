import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Latch, Layer, Ref, Schema } from "effect";
import {
  FirestoreError,
  Transaction,
  UndefinedCollectionError,
} from "@visiolab/effect-firebase/firestore/Firestore";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as App from "../../src/app/App.ts";
import * as AdminFirestore from "../../src/firestore/AdminFirestore.ts";
import { clear } from "./emulator.ts";

const projectId = "demo-admin-transactions";

const layer = AdminFirestore.layer().pipe(
  Layer.provide(App.layer({ projectId }, "admin-transactions")),
);

class Seat extends FirestoreModel.Class<Seat>("Seat")({
  taken: Schema.Boolean,
}) {}

const Seats = Collection.make("seats", Seat);
const seat = (id: string) => Seats.doc(Seats.id.make(id));

const byId = (a: string | undefined, b: string | undefined) => (a ?? "").localeCompare(b ?? "");

/** A database holding a seat for each of `ids`, none of them taken. */
const fresh = (...ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* clear(projectId);
    const firestore = yield* AdminFirestore.AdminFirestore;
    for (const id of ids) yield* firestore.setDoc(seat(id), { taken: false });
    return firestore;
  });

const isTaken = Effect.fn(function* (id: string) {
  const firestore = yield* AdminFirestore.AdminFirestore;
  const snapshot = yield* firestore.getDoc(seat(id));
  return DocumentSnapshot.isExisting(snapshot) ? (yield* snapshot.data).taken : undefined;
});

/** The ids of the seats nobody has taken, as the transaction reads them. */
const freeSeats = Effect.gen(function* () {
  const tx = yield* AdminFirestore.AdminTransaction;
  const snapshot = yield* tx.getDocs(Seats.collection());
  const free: Array<string> = [];
  for (const doc of snapshot.docs) {
    if (!(yield* doc.data).taken) free.push(doc.id);
  }
  return free.toSorted(byId);
});

/** Takes a seat through the portable Transaction alone. */
const take = (id: string) =>
  Effect.gen(function* () {
    const tx = yield* Transaction;
    yield* tx.updateDoc(seat(id), { taken: true });
  });

describe("AdminTransaction.getDocs", () => {
  it.effect("reads every document in the collection as a Query Snapshot", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh("a", "b");

      const ids = yield* firestore.runTransaction(
        Effect.gen(function* () {
          const tx = yield* AdminFirestore.AdminTransaction;
          const snapshot = yield* tx.getDocs(Seats.collection());
          return snapshot.docs.map((doc) => doc.id);
        }),
      );

      expect(ids.toSorted(byId)).toEqual(["a", "b"]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "sees a consistent set of documents, so concurrent transactions take different seats",
    () =>
      Effect.gen(function* () {
        const ids = ["a", "b", "c", "d"];
        const firestore = yield* fresh(...ids);

        const taken = yield* Effect.forEach(
          ids,
          () =>
            firestore.runTransaction(
              Effect.gen(function* () {
                const [first] = yield* freeSeats;
                if (first === undefined) return undefined;
                yield* take(first);
                return first;
              }),
              { maxAttempts: 20 },
            ),
          { concurrency: "unbounded" },
        );

        // Each one decided from a collection no other had changed under it.
        expect(taken.toSorted(byId)).toEqual(ids);
        for (const id of ids) expect(yield* isTaken(id)).toBe(true);
      }).pipe(Effect.provide(layer)),
    // The SDK backs off between attempts, on timers of its own.
    { timeout: 20_000 },
  );

  it.effect(
    "runs the body again when a document it read is written in the meantime",
    () =>
      Effect.gen(function* () {
        const firestore = yield* fresh("a", "b");
        const runs = yield* Ref.make(0);
        const read = yield* Latch.make();
        const readers = yield* Ref.make(0);

        // Each one reads the seats, then waits for the other to have read them
        // too before taking one, so on the first try both write what the
        // other read.
        const takeFirst = firestore.runTransaction(
          Effect.gen(function* () {
            const run = yield* Ref.updateAndGet(runs, (n) => n + 1);
            const [first] = yield* freeSeats;
            if (run <= 2) {
              if ((yield* Ref.updateAndGet(readers, (n) => n + 1)) === 2) yield* read.open;
              yield* read.await;
            }
            if (first !== undefined) yield* take(first);
            return first;
          }),
          { maxAttempts: 10 },
        );

        const taken = yield* Effect.all([takeFirst, takeFirst], { concurrency: "unbounded" });

        // Had neither run again, both would have taken "a".
        expect(taken.toSorted(byId)).toEqual(["a", "b"]);
        expect(yield* Ref.get(runs)).toBeGreaterThan(2);
      }).pipe(Effect.provide(layer)),
    { timeout: 20_000 },
  );

  it.effect("fails a collection read after a write, as a document read after a write fails", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh("a");

      const error = yield* Effect.flip(
        firestore.runTransaction(
          Effect.gen(function* () {
            yield* take("a");
            return yield* freeSeats;
          }),
        ),
      );

      expect(error).toBeInstanceOf(FirestoreError);
      expect(error.message).toBe('Failed to read the collection "seats"');
      expect(yield* isTaken("a")).toBe(false);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("commits a body that uses both a portable Transaction helper and getDocs", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh("a", "b");

      const free = yield* firestore.runTransaction(
        Effect.gen(function* () {
          const free = yield* freeSeats;
          for (const id of free) yield* take(id);
          return free;
        }),
      );

      expect(free).toEqual(["a", "b"]);
      expect(yield* isTaken("a")).toBe(true);
      expect(yield* isTaken("b")).toBe(true);
    }).pipe(Effect.provide(layer)),
  );
});

describe("AdminTransaction", () => {
  it.effect("is provided alongside Transaction, and neither is asked of the caller", () =>
    Effect.gen(function* () {
      interface Step {
        readonly by: number;
      }
      const Step = Context.Service<Step>("Step");
      const firestore = yield* fresh("a");

      const run = firestore.runTransaction(
        Effect.gen(function* () {
          yield* Step;
          const admin = yield* AdminFirestore.AdminTransaction;
          const portable = yield* Transaction;
          return admin === portable;
        }),
      );
      expect(yield* Effect.provideService(run, Step, { by: 1 })).toBe(true);
    }).pipe(Effect.provide(layer)),
  );
});

// A project of its own, so the group reads see only what these tests write.
const groupProjectId = "demo-admin-transaction-groups";

const groupLayer = AdminFirestore.layer().pipe(
  Layer.provide(App.layer({ projectId: groupProjectId }, "admin-transaction-groups")),
);

class Venue extends FirestoreModel.Class<Venue>("Venue")({ name: Schema.String }) {}
class Booking extends FirestoreModel.Class<Booking>("Booking")({ confirmed: Schema.Boolean }) {}

const Venues = Collection.make("venues", Venue);
const VenueBookings = Venues.subcollection("bookings", Booking);
const AllVenueBookings = CollectionGroup.make(VenueBookings);

/** A `bookings` at the root, which the group does not define. */
const RootBookings = Collection.make("bookings", Booking);

const hall = Venues.id.make("hall");
const park = Venues.id.make("park");
const booking = (venue: typeof hall, id: string) =>
  VenueBookings.doc(venue, VenueBookings.id.make(id));

/** A database holding an unconfirmed booking at the hall and one at the park. */
const freshBookings = Effect.gen(function* () {
  yield* clear(groupProjectId);
  const firestore = yield* AdminFirestore.AdminFirestore;
  yield* firestore.setDoc(booking(hall, "a"), { confirmed: false });
  yield* firestore.setDoc(booking(park, "b"), { confirmed: false });
  return firestore;
});

const isConfirmed = Effect.fn(function* (venue: typeof hall, id: string) {
  const firestore = yield* AdminFirestore.AdminFirestore;
  const snapshot = yield* firestore.getDoc(booking(venue, id));
  return DocumentSnapshot.isExisting(snapshot) ? (yield* snapshot.data).confirmed : undefined;
});

describe("AdminTransaction.getDocs of a Collection Group", () => {
  it.effect("reads the documents across parents, and commits what it writes based on them", () =>
    Effect.gen(function* () {
      const firestore = yield* freshBookings;

      const paths = yield* firestore.runTransaction(
        Effect.gen(function* () {
          const tx = yield* AdminFirestore.AdminTransaction;
          const snapshot = yield* tx.getDocs(AllVenueBookings);
          const unconfirmed = [];
          for (const doc of snapshot.docs) {
            if (!(yield* doc.data).confirmed) unconfirmed.push(doc.ref);
          }
          for (const ref of unconfirmed) yield* tx.updateDoc(ref, { confirmed: true });
          return unconfirmed.map((ref) => ref.path).toSorted(byId);
        }),
      );

      expect(paths).toEqual(["venues/hall/bookings/a", "venues/park/bookings/b"]);
      expect(yield* isConfirmed(hall, "a")).toBe(true);
      expect(yield* isConfirmed(park, "b")).toBe(true);
    }).pipe(Effect.provide(groupLayer)),
  );

  it.effect(
    "fails the body on a document at a path the group does not define, rolling back without retrying",
    () =>
      Effect.gen(function* () {
        const firestore = yield* freshBookings;
        yield* firestore.setDoc(RootBookings.doc(RootBookings.id.make("stray")), {
          confirmed: false,
        });
        const runs = yield* Ref.make(0);

        const error = yield* Effect.flip(
          firestore.runTransaction(
            Effect.gen(function* () {
              yield* Ref.update(runs, (n) => n + 1);
              const tx = yield* AdminFirestore.AdminTransaction;
              const snapshot = yield* tx.getDocs(AllVenueBookings);
              for (const doc of snapshot.docs) yield* tx.updateDoc(doc.ref, { confirmed: true });
              return snapshot.docs.length;
            }),
            { maxAttempts: 5 },
          ),
        );

        expect(error).toBeInstanceOf(UndefinedCollectionError);
        expect(error).toMatchObject({ path: "bookings/stray", collectionId: "bookings" });
        expect(yield* Ref.get(runs)).toBe(1);
        expect(yield* isConfirmed(hall, "a")).toBe(false);
      }).pipe(Effect.provide(groupLayer)),
  );
});
