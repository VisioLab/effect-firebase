import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema, Stream } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as DocumentSnapshot from "../../src/firestore/DocumentSnapshot.ts";
import * as Firestore from "../../src/firestore/Firestore.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}

const Users = Collection.make("users", User);
const alice = Users.doc(Users.id.make("alice"));

/** What the scripted SDK hands its listeners: user names, or a broken entry. */
type Names = ReadonlyArray<string | { readonly broken: true }>;

/**
 * A scripted SDK listener over a list of user names, as an SDK's `onSnapshot`
 * is: each listener hears the current names as it attaches and again on every
 * change, until the unsubscribe function it got back is called.
 */
const listenable = (initial: Names) => {
  let current = initial;
  let attaches = 0;
  const listeners = new Set<{
    readonly onNext: (names: Names) => void;
    readonly onError: (error: unknown) => void;
  }>();
  const thrown: Array<unknown> = [];
  const each = (f: (listener: typeof listeners extends Set<infer L> ? L : never) => void) => {
    for (const listener of listeners) {
      try {
        f(listener);
      } catch (error) {
        thrown.push(error);
      }
    }
  };
  return {
    subscribe: (onNext: (names: Names) => void, onError: (error: unknown) => void) => {
      const listener = { onNext, onError };
      attaches += 1;
      listeners.add(listener);
      each((l) => l === listener && l.onNext(current));
      return () => {
        listeners.delete(listener);
      };
    },
    set: (names: Names) => {
      current = names;
      each((l) => l.onNext(names));
    },
    fail: (error: unknown) => each((l) => l.onError(error)),
    get attaches() {
      return attaches;
    },
    get attached() {
      return listeners.size;
    },
    /** What a listener threw back into the SDK, which it never should. */
    thrown,
  };
};

const listenFailed = (cause: unknown) =>
  new Firestore.FirestoreError({ message: "Failed to listen", cause });

const brokenEntry = new Firestore.FirestoreError({ message: "A broken entry" });

const map =
  <A>(f: (names: ReadonlyArray<string>) => A) =>
  (names: Names): Result.Result<A, Firestore.FirestoreError> =>
    names.every((name) => typeof name === "string")
      ? Result.succeed(f(names as ReadonlyArray<string>))
      : Result.fail(brokenEntry);

/**
 * A Firestore whose stream hooks both listen through `streamFromListener` to
 * one scripted listener: `streamDoc` reads the first name as Alice's, and
 * `streamDocs` reads each name as a user.
 */
const listeningTo = (source: ReturnType<typeof listenable>) =>
  Firestore.make({
    getDoc: () => Effect.die("unscripted"),
    getDocs: () => Effect.die("unscripted"),
    setDoc: () => Effect.die("unscripted"),
    updateDoc: () => Effect.die("unscripted"),
    addDoc: () => Effect.die("unscripted"),
    runTransaction: { run: () => Effect.die("unscripted") },
    streamDoc: () =>
      Firestore.streamFromListener({
        subscribe: source.subscribe,
        onError: listenFailed,
        map: map((names) => ({ data: names[0] === undefined ? undefined : { name: names[0] } })),
      }),
    streamDocs: () =>
      Firestore.streamFromListener({
        subscribe: source.subscribe,
        onError: listenFailed,
        map: map((names) => ({
          docs: names.map((name) => ({ path: `users/${name}`, data: { name } })),
        })),
      }),
  });

/** Each stream hook, read down to the user names it emits. */
const streams = [
  {
    hook: "streamDoc",
    names: (firestore: Firestore.Firestore) =>
      firestore
        .streamDoc(alice)
        .pipe(
          Stream.mapEffect((snapshot) =>
            DocumentSnapshot.isExisting(snapshot)
              ? Effect.map(snapshot.data, (user) => [user.name])
              : Effect.succeed([]),
          ),
        ),
  },
  {
    hook: "streamDocs",
    names: (firestore: Firestore.Firestore) =>
      firestore
        .streamDocs(Users.collection())
        .pipe(
          Stream.mapEffect((snapshot) =>
            Effect.forEach(snapshot.docs, (doc) => Effect.map(doc.data, (user) => user.name)),
          ),
        ),
  },
] as const;

describe.each(streams)("streamFromListener, through $hook", ({ names }) => {
  it.effect("attaches a listener for each run, and detaches it when the run stops", () =>
    Effect.gen(function* () {
      const source = listenable(["Alice"]);
      const stream = names(listeningTo(source));
      expect(source.attaches).toBe(0);

      const first = yield* Stream.runCollect(Stream.take(stream, 1));
      expect(source.attached).toBe(0);
      const second = yield* Stream.runCollect(Stream.take(stream, 1));

      expect(first).toEqual([["Alice"]]);
      expect(second).toEqual([["Alice"]]);
      expect(source.attaches).toBe(2);
      expect(source.attached).toBe(0);
    }),
  );

  it.effect("keeps only the latest snapshot for a reader that falls behind", () =>
    Effect.gen(function* () {
      const source = listenable(["Alice"]);

      const read = yield* Stream.runCollect(
        names(listeningTo(source)).pipe(
          Stream.tap((read) =>
            Effect.sync(() => {
              // The reader is still busy with the first snapshot while the
              // listener hears two more.
              if (read[0] === "Alice") {
                source.set(["Bob"]);
                source.set(["Carol"]);
              }
            }),
          ),
          Stream.take(2),
        ),
      );

      expect(read).toEqual([["Alice"], ["Carol"]]);
    }),
  );

  it.effect("fails with the error built from what the listener heard, and detaches", () =>
    Effect.gen(function* () {
      const source = listenable(["Alice"]);
      const dropped = new Error("Connection dropped");

      const error = yield* Effect.flip(
        Stream.runDrain(
          names(listeningTo(source)).pipe(
            Stream.tap(() => Effect.sync(() => source.fail(dropped))),
          ),
        ),
      );

      assert(error._tag === "FirestoreError");
      expect(error.message).toBe("Failed to listen");
      expect(error.cause).toBe(dropped);
      expect(source.attached).toBe(0);
    }),
  );

  it.effect("fails at a snapshot that does not map, without throwing into the listener", () =>
    Effect.gen(function* () {
      const source = listenable(["Alice"]);

      const error = yield* Effect.flip(
        Stream.runDrain(
          names(listeningTo(source)).pipe(
            Stream.tap(() => Effect.sync(() => source.set([{ broken: true }]))),
          ),
        ),
      );

      expect(error).toBe(brokenEntry);
      expect(source.thrown).toEqual([]);
      expect(source.attached).toBe(0);
    }),
  );
});
