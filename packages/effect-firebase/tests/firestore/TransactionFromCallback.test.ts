import { assert, describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Schema, Stream } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as Firestore from "../../src/firestore/Firestore.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}

const Users = Collection.make("users", User);
const alice = Users.id.make("alice");

/** What the scripted SDK throws for a conflict, and retries. */
class SdkError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** The transaction object the scripted SDK hands its callback. */
interface SdkTransaction {
  readonly attempt: number;
}

/**
 * A runner that behaves like an SDK's `runTransaction`: it runs the callback
 * and retries it, up to `maxAttempts` (5 where unset), while what it threw has
 * the code `aborted`, and otherwise rejects with what the callback threw.
 */
const scriptedRunner = () => {
  const thrown: Array<unknown> = [];
  const options: Array<Firestore.TransactionHookOptions> = [];
  let attempts = 0;
  const run = async <A>(
    callback: (transaction: SdkTransaction) => Promise<A>,
    hookOptions: Firestore.TransactionHookOptions,
  ): Promise<A> => {
    options.push(hookOptions);
    const maxAttempts = hookOptions.maxAttempts ?? 5;
    for (let attempt = 1; ; attempt++) {
      attempts++;
      try {
        return await callback({ attempt });
      } catch (error) {
        thrown.push(error);
        const retryable = error instanceof SdkError && error.code === "aborted";
        if (!retryable || attempt >= maxAttempts) throw error;
      }
    }
  };
  return {
    run,
    thrown,
    options,
    get attempts() {
      return attempts;
    },
  };
};

/** A hook no test scripted: reaching it is a bug in the test. */
const unscripted = (name: string) => () => Effect.die(`The ${name} hook was not scripted`);

/**
 * A Firestore whose transactions run through `transactionFromCallback` over
 * `run`, with `operations` answering each attempt's reads and writes.
 */
const firestoreOver = (
  run: Firestore.TransactionFromCallbackOptions<SdkTransaction>["run"],
  operations: (
    transaction: SdkTransaction,
  ) => Partial<Firestore.TransactionOperations> = () => ({}),
) =>
  Firestore.make({
    getDoc: unscripted("getDoc"),
    getDocs: unscripted("getDocs"),
    setDoc: unscripted("setDoc"),
    updateDoc: unscripted("updateDoc"),
    addDoc: unscripted("addDoc"),
    streamDoc: () => Stream.die("The streamDoc hook was not scripted"),
    streamDocs: () => Stream.die("The streamDocs hook was not scripted"),
    runTransaction: Firestore.transactionFromCallback({
      run,
      operations: (transaction: SdkTransaction) => ({
        getDoc: () => Effect.succeed({ data: { name: "Alice" } }),
        setDoc: () => Effect.void,
        updateDoc: () => Effect.void,
        ...operations(transaction),
      }),
      onError: (cause) =>
        new Firestore.FirestoreError({
          message: "Failed to run a transaction",
          code: cause instanceof SdkError ? cause.code : undefined,
          cause,
        }),
    }),
  });

describe("transactionFromCallback", () => {
  it.effect("does not retry a body's own failure, and fails with it unwrapped", () =>
    Effect.gen(function* () {
      const runner = scriptedRunner();
      const firestore = firestoreOver(runner.run);
      // An error of the body's own that happens to carry a code the SDK retries.
      const own = new SdkError("aborted");

      const error = yield* Effect.flip(firestore.runTransaction(Effect.fail(own)));

      expect(error).toBe(own);
      expect(runner.attempts).toBe(1);
      assert(runner.thrown.length === 1);
      expect(runner.thrown[0]).not.toBe(own);
      expect((runner.thrown[0] as { code?: unknown }).code).toBeUndefined();
    }),
  );

  it.effect("hands a read answered as ABORTED to the SDK as its own error, which retries it", () =>
    Effect.gen(function* () {
      const runner = scriptedRunner();
      const aborted = new SdkError("aborted");
      const firestore = firestoreOver(runner.run, ({ attempt }) => ({
        getDoc: () =>
          attempt === 1
            ? Effect.fail(
                new Firestore.FirestoreError({
                  message: "Contended",
                  code: "aborted",
                  cause: aborted,
                }),
              )
            : Effect.succeed({ data: { name: "Alice" } }),
      }));

      const name = yield* firestore.runTransaction(
        Effect.gen(function* () {
          const tx = yield* Firestore.Transaction;
          const snapshot = yield* tx.getDoc(Users.doc(alice));
          assert(snapshot._tag === "Existing");
          return (yield* snapshot.data).name;
        }),
      );

      expect(name).toBe("Alice");
      expect(runner.attempts).toBe(2);
      expect(runner.thrown).toEqual([aborted]);
      expect(runner.thrown[0]).toBe(aborted);
    }),
  );

  it.effect("fails with the body's FirestoreError, unwrapped, once the SDK stops retrying it", () =>
    Effect.gen(function* () {
      const runner = scriptedRunner();
      const contended = new Firestore.FirestoreError({
        message: "Contended",
        code: "aborted",
        cause: new SdkError("aborted"),
      });
      const firestore = firestoreOver(runner.run, () => ({ getDoc: () => Effect.fail(contended) }));

      const error = yield* Effect.flip(
        firestore.runTransaction(
          Effect.flatMap(Firestore.Transaction, (tx) => tx.getDoc(Users.doc(alice))),
          { maxAttempts: 2 },
        ),
      );

      expect(error).toBe(contended);
      expect(runner.attempts).toBe(2);
    }),
  );

  it.live("interrupts a running body, and waits for the SDK to roll back", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const events: Array<string> = [];
      // Rolls back a while after the callback rejects, as an SDK talking to
      // Firestore would.
      const run = async <A>(callback: (transaction: SdkTransaction) => Promise<A>) => {
        try {
          return await callback({ attempt: 1 });
        } catch (error) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          events.push("rolled back");
          throw error;
        }
      };
      const firestore = firestoreOver(run);

      const fiber = yield* Effect.forkChild(
        firestore.runTransaction(
          Effect.andThen(Deferred.succeed(started, undefined), Effect.never).pipe(
            Effect.onInterrupt(() => Effect.sync(() => void events.push("body interrupted"))),
          ),
        ),
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);

      expect(events).toEqual(["body interrupted", "rolled back"]);
    }),
  );

  it.effect("fails with onError's FirestoreError for what the SDK raised beyond the body", () =>
    Effect.gen(function* () {
      const commit = new SdkError("unavailable");
      const firestore = firestoreOver(async (callback) => {
        await callback({ attempt: 1 });
        throw commit;
      });

      const error = yield* Effect.flip(firestore.runTransaction(Effect.succeed(1)));

      assert(error instanceof Firestore.FirestoreError);
      expect(error.message).toBe("Failed to run a transaction");
      expect(error.code).toBe("unavailable");
      expect(error.cause).toBe(commit);
    }),
  );

  it.effect("hands maxAttempts to the SDK only where the caller set it", () =>
    Effect.gen(function* () {
      const runner = scriptedRunner();
      const firestore = firestoreOver(runner.run, () => ({
        getDoc: () =>
          Effect.fail(
            new Firestore.FirestoreError({ message: "Contended", cause: new SdkError("aborted") }),
          ),
      }));
      const contended = Effect.flatMap(Firestore.Transaction, (tx) => tx.getDoc(Users.doc(alice)));

      yield* Effect.flip(firestore.runTransaction(contended));
      expect(runner.attempts).toBe(5);
      yield* Effect.flip(firestore.runTransaction(contended, { maxAttempts: 1 }));
      expect(runner.attempts).toBe(6);

      expect(runner.options).toStrictEqual([{}, { maxAttempts: 1 }]);
    }),
  );
});
