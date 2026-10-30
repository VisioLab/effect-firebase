import { describe, expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Ref, Schema } from "effect";
import {
  Firestore,
  FirestoreError,
  Transaction,
} from "@visiolab/effect-firebase/firestore/Firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as App from "../../src/App.ts";
import * as AdminFirestore from "../../src/firestore/AdminFirestore.ts";
import { clear } from "./emulator.ts";

const projectId = "demo-transactions";

const layer = AdminFirestore.layer().pipe(Layer.provide(App.layer({ projectId }, "transactions")));

class Counter extends FirestoreModel.Class<Counter>("Counter")({
  n: Schema.Finite,
}) {}

const Counters = Collection.make("counters", Counter);
const counter = Counters.doc(Counters.id.make("counter"));
const other = Counters.doc(Counters.id.make("other"));

/** A database holding the one counter, at `n`. */
const fresh = (n: number) =>
  Effect.gen(function* () {
    yield* clear(projectId);
    const firestore = yield* Firestore;
    yield* firestore.setDoc(counter, { n });
    return firestore;
  });

const valueOf = Effect.fn(function* (ref: Collection.DocumentReference<typeof Counters>) {
  const firestore = yield* Firestore;
  const snapshot = yield* firestore.getDoc(ref);
  return DocumentSnapshot.isExisting(snapshot) ? (yield* snapshot.data).n : undefined;
});

/** Reads the counter and writes it back one higher, as part of a transaction. */
const increment = Effect.gen(function* () {
  const tx = yield* Transaction;
  const snapshot = yield* tx.getDoc(counter);
  const n = DocumentSnapshot.isExisting(snapshot) ? (yield* snapshot.data).n : 0;
  yield* tx.updateDoc(counter, { n: n + 1 });
  return n + 1;
});

class Refused extends Schema.TaggedError<Refused, { readonly brand: unique symbol }>()("Refused", {
  // The very number the SDK reads as ABORTED.
  code: Schema.Finite,
}) {}

describe("Firestore.runTransaction", () => {
  it.effect("commits what the body writes, and hands back what it returns", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(1);

      const n = yield* firestore.runTransaction(increment);

      expect(n).toBe(2);
      expect(yield* valueOf(counter)).toBe(2);
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "runs the body again when other transactions get in the way",
    () =>
      Effect.gen(function* () {
        const firestore = yield* fresh(0);
        const runs = yield* Ref.make(0);

        const results = yield* Effect.all(
          Array.from({ length: 4 }, () =>
            firestore.runTransaction(
              Ref.update(runs, (n) => n + 1).pipe(Effect.andThen(increment)),
              {
                maxAttempts: 20,
              },
            ),
          ),
          { concurrency: "unbounded" },
        );

        // Every one of them counted from what the one before it wrote, which
        // only holds where the ones that read too early ran again.
        expect(results.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4]);
        expect(yield* valueOf(counter)).toBe(4);
        expect(yield* Ref.get(runs)).toBeGreaterThan(4);
      }).pipe(Effect.provide(layer)),
    // The SDK backs off between attempts, on timers of its own.
    { timeout: 20_000 },
  );

  it.effect(
    "gives up after maxAttempts, failing with a FirestoreError",
    () =>
      Effect.gen(function* () {
        const firestore = yield* fresh(0);

        const exits = yield* Effect.all(
          Array.from({ length: 8 }, () =>
            Effect.exit(firestore.runTransaction(increment, { maxAttempts: 1 })),
          ),
          { concurrency: "unbounded" },
        );

        const failures = exits.filter(Exit.isFailure);
        expect(failures.length).toBeGreaterThan(0);
        for (const exit of failures) {
          expect(exit.cause.reasons).toMatchObject([
            { _tag: "Fail", error: expect.any(FirestoreError) },
          ]);
        }
        // What did commit, counted.
        expect(yield* valueOf(counter)).toBe(exits.length - failures.length);
      }).pipe(Effect.provide(layer)),
    { timeout: 20_000 },
  );

  it.effect("fails with the body's own error unchanged, and does not retry it", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(1);
      const runs = yield* Ref.make(0);

      // It carries `code: 10`, which the SDK would take for a conflict if it
      // reached it as it is.
      const error = yield* Effect.flip(
        firestore.runTransaction(
          Effect.gen(function* () {
            yield* Ref.update(runs, (n) => n + 1);
            yield* increment;
            return yield* new Refused({ code: 10 });
          }),
        ),
      );

      expect(error).toBeInstanceOf(Refused);
      expect(yield* Ref.get(runs)).toBe(1);
      expect(yield* valueOf(counter)).toBe(1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("dies with the body's defect, and does not retry it", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(1);
      const runs = yield* Ref.make(0);

      const exit = yield* Effect.exit(
        firestore.runTransaction(
          Ref.update(runs, (n) => n + 1).pipe(Effect.andThen(Effect.die("boom"))),
        ),
      );

      expect(Exit.isFailure(exit) && exit.cause.reasons).toMatchObject([
        { _tag: "Die", defect: "boom" },
      ]);
      expect(yield* Ref.get(runs)).toBe(1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rolls back a write that does not encode", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(1);

      const error = yield* Effect.flip(
        firestore.runTransaction(
          Effect.gen(function* () {
            const tx = yield* Transaction;
            yield* tx.setDoc(other, { n: 1 });
            yield* tx.setDoc(counter, { n: Number.NaN });
          }),
        ),
      );

      expect(error._tag).toBe("SchemaError");
      expect(yield* valueOf(other)).toBeUndefined();
      expect(yield* valueOf(counter)).toBe(1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails a read after a write with the body's own error", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(1);

      const error = yield* Effect.flip(
        firestore.runTransaction(
          Effect.gen(function* () {
            const tx = yield* Transaction;
            yield* tx.setDoc(other, { n: 1 });
            return yield* tx.getDoc(counter);
          }),
        ),
      );

      // Not one wrapped around it on the way out.
      expect(error).toBeInstanceOf(FirestoreError);
      expect(error.message).toBe('Failed to read the document "counters/counter"');
      expect(yield* valueOf(other)).toBeUndefined();
    }).pipe(Effect.provide(layer)),
  );

  // Live, because the body runs on the caller's clock, and a test clock would
  // never let it finish cleaning up.
  it.live("rolls back when interrupted, and waits for the body to stop", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(1);
      const queued = yield* Deferred.make<void>();
      const stopped = yield* Ref.make(false);

      const fiber = yield* Effect.forkChild(
        firestore.runTransaction(
          Effect.gen(function* () {
            yield* increment;
            yield* Deferred.succeed(queued, undefined);
            return yield* Effect.never;
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.sleep("50 millis").pipe(Effect.andThen(Ref.set(stopped, true))),
            ),
          ),
        ),
      );
      yield* Deferred.await(queued);
      yield* Fiber.interrupt(fiber);

      expect(yield* Ref.get(stopped)).toBe(true);
      expect(yield* valueOf(counter)).toBe(1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("commits a transaction run inside another on its own", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(1);

      yield* Effect.flip(
        firestore.runTransaction(
          Effect.gen(function* () {
            yield* increment;
            yield* firestore.runTransaction(
              Effect.gen(function* () {
                const tx = yield* Transaction;
                yield* tx.setDoc(other, { n: 1 });
              }),
            );
            return yield* new Refused({ code: 0 });
          }),
        ),
      );

      // The outer one rolled back, and the inner one stayed.
      expect(yield* valueOf(counter)).toBe(1);
      expect(yield* valueOf(other)).toBe(1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("hands the body the services of the caller, and asks for no Transaction", () =>
    Effect.gen(function* () {
      interface Step {
        readonly by: number;
      }
      const Step = Context.Service<Step>("Step");
      const firestore = yield* fresh(1);

      const run = firestore.runTransaction(
        Effect.gen(function* () {
          const { by } = yield* Step;
          const tx = yield* Transaction;
          yield* tx.setDoc(counter, { n: by });
          return by;
        }),
      );
      expect(yield* Effect.provideService(run, Step, { by: 5 })).toBe(5);
      expect(yield* valueOf(counter)).toBe(5);
    }).pipe(Effect.provide(layer)),
  );
});
