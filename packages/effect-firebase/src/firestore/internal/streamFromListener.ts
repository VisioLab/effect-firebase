import { Cause, Effect, Queue, Result, Stream } from "effect";
import type { FirestoreError } from "./firestoreError.ts";

/** @internal */
export const streamFromListener = <S, A>(options: {
  readonly subscribe: (
    onNext: (snapshot: S) => void,
    onError: (error: unknown) => void,
  ) => () => void;
  readonly onError: (error: unknown) => FirestoreError;
  readonly map: (snapshot: S) => Result.Result<A, FirestoreError>;
}): Stream.Stream<A, FirestoreError> =>
  Stream.callback<A, FirestoreError>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          options.subscribe(
            (snapshot) => {
              // Runs inside the SDK's listener, so a snapshot that does not map
              // fails the stream rather than throwing back into the SDK.
              const element = options.map(snapshot);
              if (Result.isSuccess(element)) Queue.offerUnsafe(queue, element.success);
              else Queue.failCauseUnsafe(queue, Cause.fail(element.failure));
            },
            (error) => Queue.failCauseUnsafe(queue, Cause.fail(options.onError(error))),
          ),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    { bufferSize: 1, strategy: "sliding" },
  );
