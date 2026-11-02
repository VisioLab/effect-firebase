import { Cause, Effect, Exit, Option } from "effect";
import { constVoid } from "effect/Function";
import type * as Firestore from "../Firestore.ts";
import { FirestoreError } from "./firestoreError.ts";

/**
 * What the callback throws when the body fails with anything but a
 * `FirestoreError` that carries its backend's cause.
 *
 * It carries no `code` on purpose: an SDK decides whether to retry by the code
 * of what it caught, and a body's own error that happens to carry one would
 * otherwise be retried as if Firestore had raised it.
 */
class BodyFailed {
  readonly cause: Cause.Cause<unknown>;
  constructor(cause: Cause.Cause<unknown>) {
    this.cause = cause;
  }
}

/**
 * What the callback throws for a body that failed with `cause`.
 *
 * A `FirestoreError` goes back as the SDK's own error behind it, so the SDK
 * decides by its own rules whether to retry it - a read answered with ABORTED
 * under contention, or an outage that passes - rather than by a copy of them
 * kept here. Anything else goes back as {@link BodyFailed}, which it never
 * retries.
 */
const thrownFor = (cause: Cause.Cause<unknown>): unknown => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  return error instanceof FirestoreError && error.cause !== undefined
    ? error.cause
    : new BodyFailed(cause);
};

/** @internal */
export const transactionFromCallback = <
  T,
  Operations extends Firestore.TransactionOperations,
  TransactionServices = never,
>(
  options: Firestore.TransactionFromCallbackOptions<T, Operations, TransactionServices>,
): Firestore.RunTransaction<Operations, TransactionServices> => ({
  run: (body, hookOptions) => runOver(options, body, hookOptions),
  context: options.context,
});

/** Runs `body` in a transaction through `options.run`, once per attempt. */
const runOver = <T, Operations extends Firestore.TransactionOperations, A, E>(
  options: Pick<
    Firestore.TransactionFromCallbackOptions<T, Operations>,
    "run" | "operations" | "onError"
  >,
  body: (operations: Operations) => Effect.Effect<A, E>,
  hookOptions: Firestore.TransactionHookOptions,
): Effect.Effect<A, E | FirestoreError> =>
  Effect.uninterruptibleMask((restore) => {
    const controller = new AbortController();
    // The last thing the body failed with, and what was thrown for it, so
    // that a failure the SDK hands back without retrying it comes back as
    // the body's own rather than wrapped.
    let failure: { readonly thrown: unknown; readonly cause: Cause.Cause<unknown> } | undefined;
    const callback = async (transaction: T): Promise<A> => {
      // The body has everything it needs provided, so it runs on a runtime
      // of its own here, inside the SDK's callback.
      const exit = await Effect.runPromiseExit(body(options.operations(transaction)), {
        signal: controller.signal,
      });
      if (Exit.isSuccess(exit)) return exit.value;
      const thrown = thrownFor(exit.cause);
      failure = { thrown, cause: exit.cause };
      throw thrown;
    };
    let running: Promise<A>;
    try {
      running = options.run(callback, hookOptions);
    } catch (cause) {
      running = Promise.reject(cause);
    }

    return restore(
      Effect.tryPromise({
        try: () => running,
        catch: (cause) =>
          failure !== undefined && cause === failure.thrown
            ? new BodyFailed(failure.cause)
            : options.onError(cause),
      }),
    ).pipe(
      // Interrupting the body is what makes the callback reject, and so what
      // makes the SDK roll back - which is waited for, so that nothing of
      // the transaction is left running once this is done.
      Effect.onInterrupt(() => {
        controller.abort();
        return Effect.promise(() => running.then(constVoid, constVoid));
      }),
      Effect.catchIf(
        (error): error is BodyFailed => error instanceof BodyFailed,
        (failed) => Effect.failCause(failed.cause as Cause.Cause<E>),
      ),
    );
  });
