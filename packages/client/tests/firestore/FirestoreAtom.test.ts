import { assert, describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { Cause, Context, Duration, Effect, Layer, Option, Queue, Schema } from "effect";
import { FirebaseError } from "firebase/app";
import * as Sdk from "firebase/firestore";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import type { Atom } from "effect/reactivity";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as App from "../../src/app/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import * as FirestoreAtom from "../../src/firestore/FirestoreAtom.ts";
import { clear, emulator, listening, otherClient } from "./emulator.ts";
import { listeners } from "./listeners.ts";

vi.mock("firebase/firestore", async (importOriginal) =>
  (await import("./listeners.ts")).wrapOnSnapshot(await importOriginal()),
);

const projectId = "demo-client-firestore-atom";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

// Each registry builds the layer anew, so each test gets an app of its own
// and does not wait on the previous test's app being deleted.
let apps = 0;

class Db extends FirestoreAtom.Service<Db>()("test/Db", {
  layer: () =>
    ClientFirestore.layer({ emulator }).pipe(
      Layer.provide(App.layer({ projectId }, `firestore-atom-${++apps}`)),
    ),
}) {}

/**
 * A registry for the rest of the test, with `Db`'s runtime mounted, and the
 * Client Firestore that runtime holds, for writing through the same client the
 * atoms listen with.
 */
const freshWith = (options?: Parameters<typeof AtomRegistry.make>[0]) =>
  Effect.gen(function* () {
    yield* clear(projectId);
    listeners.reset();
    const registry = yield* Effect.acquireRelease(
      Effect.sync(() => AtomRegistry.make(options)),
      (registry) => Effect.sync(() => registry.dispose()),
    );
    yield* AtomRegistry.mount(registry, Db.runtime);
    const context = yield* AtomRegistry.getResult(registry, Db.runtime);
    return { registry, firestore: Context.get(context, Db) };
  });

const fresh = freshWith();

/** The next result in `results` that is not `Initial`, as a `Success`. */
const next = <A, E, Done>(results: Queue.Dequeue<AsyncResult.AsyncResult<A, E>, Done>) =>
  Effect.gen(function* () {
    let result = yield* Queue.take(results);
    while (AsyncResult.isInitial(result)) {
      result = yield* Queue.take(results);
    }
    assert(AsyncResult.isSuccess(result), `expected a Success, got ${result._tag}`);
    return result;
  });

describe("FirestoreAtom.Service doc", () => {
  it.live("is Initial until the first snapshot, then holds the decoded document", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });

      const results = yield* listening(AtomRegistry.toStream(registry, Db.doc(hello)));

      expect(AsyncResult.isInitial(yield* Queue.take(results))).toBe(true);
      const result = yield* Queue.take(results);
      assert(AsyncResult.isSuccess(result));
      assert(result.value._tag === "Existing");
      expect(result.value.data).toBeInstanceOf(Post);
      expect(result.value.data).toMatchObject({ title: "Hello", views: 1 });
      expect(result.value.id).toBe("hello");
      expect(result.waiting).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.live("holds a Missing snapshot as a success for a document that is not there", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;

      const results = yield* listening(AtomRegistry.toStream(registry, Db.doc(hello)));

      yield* Queue.take(results);
      const result = yield* Queue.take(results);
      assert(AsyncResult.isSuccess(result));
      expect(result.value._tag).toBe("Missing");
      expect(result.value.ref).toEqual(hello);
    }).pipe(Effect.scoped),
  );

  it.live("shows a local write at once, with pending writes", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      const results = yield* listening(AtomRegistry.toStream(registry, Db.doc(hello)));
      yield* next(results);

      yield* Effect.forkChild(firestore.setDoc(hello, { title: "Hello", views: 1 }));

      const result = yield* next(results);
      assert(result.value._tag === "Existing");
      expect(result.value.data).toMatchObject({ title: "Hello", views: 1 });
      expect(result.value.metadata.hasPendingWrites).toBe(true);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service doc listen options", () => {
  it.live("with includeMetadataChanges, updates once a write is acknowledged", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      const results = yield* listening(
        AtomRegistry.toStream(registry, Db.doc(hello, { includeMetadataChanges: true })),
      );
      yield* next(results);

      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });

      const pending = yield* next(results);
      const acknowledged = yield* next(results);
      expect(pending.value).toMatchObject({
        _tag: "Existing",
        metadata: { hasPendingWrites: true },
      });
      expect(acknowledged.value).toMatchObject({
        _tag: "Existing",
        data: { title: "Hello", views: 1 },
        metadata: { hasPendingWrites: false },
      });
    }).pipe(Effect.scoped),
  );

  it.live("without includeMetadataChanges, does not update when only the metadata changes", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      const plain = yield* listening(AtomRegistry.toStream(registry, Db.doc(hello)));
      // Listens to the same document, and so hears of the acknowledgement in
      // the same pass as the plain atom would.
      const witness = yield* listening(
        AtomRegistry.toStream(registry, Db.doc(hello, { includeMetadataChanges: true })),
      );
      yield* next(plain);
      yield* next(witness);

      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      yield* next(witness).pipe(
        Effect.repeat({
          until: (result) =>
            result.value._tag === "Existing" && !result.value.metadata.hasPendingWrites,
        }),
      );
      yield* firestore.updateDoc(hello, { views: 2 });

      // Had the acknowledgement reached the atom, it would come between the two.
      const first = yield* next(plain);
      const second = yield* next(plain);
      expect(first.value).toMatchObject({
        data: { views: 1 },
        metadata: { hasPendingWrites: true },
      });
      expect(second.value).toMatchObject({
        data: { views: 2 },
        metadata: { hasPendingWrites: true },
      });
    }).pipe(Effect.scoped),
  );

  it.live("with source cache, reads the local cache without reaching the server", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;
      // Written by another client, so only the server knows of it.
      yield* ClientFirestore.ClientFirestore.use((elsewhere) =>
        elsewhere.setDoc(hello, { title: "Hello", views: 1 }),
      ).pipe(Effect.provide(otherClient(projectId, `firestore-atom-other-${apps}`)));

      const cached = yield* next(
        yield* listening(AtomRegistry.toStream(registry, Db.doc(hello, { source: "cache" }))),
      );
      const server = yield* next(yield* listening(AtomRegistry.toStream(registry, Db.doc(hello))));

      expect(cached.value).toMatchObject({ _tag: "Missing", metadata: { fromCache: true } });
      expect(server.value).toMatchObject({ _tag: "Existing", data: { title: "Hello" } });
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service doc sharing", () => {
  it.live("gives the same atom and one listener for equal keys", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;
      const atom = Db.doc(hello);
      const equal = [
        Db.doc(hello, {}),
        Db.doc(hello, { source: "default", includeMetadataChanges: false }),
        Db.doc(hello, {
          source: undefined,
          includeMetadataChanges: undefined,
          timeToLive: undefined,
        }),
        Db.doc(Posts.doc(Posts.id.make("hello"))),
      ];
      for (const other of equal) {
        expect(other).toBe(atom);
      }
      expect(Db.doc(hello, { timeToLive: "1 minute" })).toBe(
        Db.doc(hello, { timeToLive: Duration.minutes(1) }),
      );

      const results = yield* listening(AtomRegistry.toStream(registry, atom));
      for (const other of equal) {
        yield* AtomRegistry.mount(registry, other);
      }
      yield* next(results);

      expect(listeners.attached).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("gives a different atom and listener for different options or timeToLive", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;
      const atoms = [
        Db.doc(hello),
        Db.doc(hello, { source: "cache" }),
        Db.doc(hello, { includeMetadataChanges: true }),
        Db.doc(hello, { timeToLive: "1 minute" }),
        Db.doc(hello, { timeToLive: "2 minutes" }),
        Db.doc(hello, { timeToLive: Infinity }),
        Db.doc(Posts.doc(Posts.id.make("other"))),
      ];
      expect(new Set(atoms).size).toBe(atoms.length);

      for (const atom of atoms) {
        yield* next(yield* listening(AtomRegistry.toStream(registry, atom)));
      }

      expect(listeners.active).toBe(atoms.length);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service doc lifetime", () => {
  // TTLs are rounded up to the registry's timeout resolution, a second by
  // default.
  const timeoutResolution = 10;

  /** Reads `atom` until its first snapshot, then stops reading it. */
  const readOnce = <A>(
    registry: AtomRegistry.AtomRegistry,
    atom: Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* next(yield* listening(AtomRegistry.toStream(registry, atom)));
      }),
    );

  it.live("detaches the listener once nothing reads the atom", () =>
    Effect.gen(function* () {
      const { registry } = yield* freshWith({ timeoutResolution });
      yield* readOnce(registry, Db.doc(hello));
      expect(listeners.attached).toBe(1);

      yield* Effect.sleep("100 millis");

      expect(listeners.active).toBe(0);
    }).pipe(Effect.scoped),
  );

  it.live("keeps the listener for a finite timeToLive, then detaches it", () =>
    Effect.gen(function* () {
      const { registry } = yield* freshWith({ timeoutResolution });
      yield* readOnce(registry, Db.doc(hello, { timeToLive: "400 millis" }));

      yield* Effect.sleep("100 millis");
      expect(listeners.active).toBe(1);

      yield* Effect.sleep("600 millis");
      expect(listeners.active).toBe(0);
      expect(listeners.attached).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("keeps the listener attached with an infinite timeToLive", () =>
    Effect.gen(function* () {
      const { registry } = yield* freshWith({ timeoutResolution });
      const atom = Db.doc(hello, { timeToLive: Infinity });
      yield* readOnce(registry, atom);

      yield* Effect.sleep("500 millis");
      expect(listeners.active).toBe(1);

      yield* readOnce(registry, atom);
      expect(listeners.attached).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("uses the registry's defaultIdleTTL without a timeToLive", () =>
    Effect.gen(function* () {
      const { registry } = yield* freshWith({ timeoutResolution, defaultIdleTTL: 400 });
      yield* readOnce(registry, Db.doc(hello));

      yield* Effect.sleep("100 millis");
      expect(listeners.active).toBe(1);

      yield* Effect.sleep("600 millis");
      expect(listeners.active).toBe(0);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service doc failures", () => {
  it.live("fails on data that does not decode, and recovers on the next valid write", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      const results = yield* listening(AtomRegistry.toStream(registry, Db.doc(hello)));
      const before = yield* next(results);

      // The model is bypassed, so data it rejects reaches Firestore.
      yield* Effect.promise(() =>
        Sdk.setDoc(Sdk.doc(firestore.instance, hello.path), { title: "Hello", views: "many" }),
      );

      const failed = yield* Queue.take(results);
      assert(AsyncResult.isFailure(failed));
      expect(Cause.squash(failed.cause)).toBeInstanceOf(Schema.SchemaError);
      expect(failed.previousSuccess).toEqual(Option.some(before));

      yield* firestore.setDoc(hello, { title: "Hello", views: 2 });

      const recovered = yield* next(results);
      assert(recovered.value._tag === "Existing");
      expect(recovered.value.data.views).toBe(2);
      expect(listeners.attached).toBe(1);
      expect(listeners.detached).toBe(0);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service doc listen errors", () => {
  it.live("fails when Firestore drops the listen, and listens again only on a refresh", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      const atom = Db.doc(hello);
      const results = yield* listening(AtomRegistry.toStream(registry, atom));
      const before = yield* next(results);

      listeners.drop(
        new FirebaseError("permission-denied", "Missing or insufficient permissions."),
      );

      const failed = yield* Queue.take(results);
      assert(AsyncResult.isFailure(failed));
      const error = Cause.squash(failed.cause);
      assert(error instanceof FirestoreError);
      expect(error.code).toBe("permission-denied");
      expect(failed.previousSuccess).toEqual(Option.some(before));

      // Give a retry the time it would need to show up.
      yield* Effect.sleep("200 millis");
      expect(listeners.attached).toBe(1);
      expect(listeners.active).toBe(0);
      expect(registry.get(atom)).toBe(failed);

      registry.refresh(atom);

      const refreshing = yield* Queue.take(results);
      expect(AsyncResult.isFailure(refreshing) && refreshing.waiting).toBe(true);
      const recovered = yield* next(results);
      assert(recovered.value._tag === "Existing");
      expect(recovered.waiting).toBe(false);
      expect(listeners.attached).toBe(2);
      expect(listeners.active).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.live("detaches and reattaches its listener on a refresh while healthy", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;
      const atom = Db.doc(hello);
      const results = yield* listening(AtomRegistry.toStream(registry, atom));
      yield* next(results);

      registry.refresh(atom);

      const refreshing = yield* Queue.take(results);
      expect(AsyncResult.isSuccess(refreshing) && refreshing.waiting).toBe(true);
      expect((yield* next(results)).waiting).toBe(false);
      expect(listeners.attached).toBe(2);
      expect(listeners.detached).toBe(1);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service runtime", () => {
  it.live("gives Client Firestore to `yield* Db` in a derived atom", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });

      const title = Db.runtime.atom(
        Effect.gen(function* () {
          const db = yield* Db;
          const snapshot = yield* db.getDoc(hello);
          return snapshot._tag === "Existing" ? (yield* snapshot.data).title : undefined;
        }),
      );

      expect(yield* AtomRegistry.getResult(registry, title)).toBe("Hello");
    }).pipe(Effect.scoped),
  );
});
