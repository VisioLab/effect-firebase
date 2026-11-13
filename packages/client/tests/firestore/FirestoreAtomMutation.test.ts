import { assert, describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { disableNetwork, enableNetwork } from "firebase/firestore";
import type { Atom } from "effect/reactivity";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as App from "../../src/app/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import * as FirestoreAtom from "../../src/firestore/FirestoreAtom.ts";
import { clear, emulator } from "./emulator.ts";

const projectId = "demo-client-firestore-atom-mutation";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

// Each registry builds the layer anew, so each test gets an app of its own
// and does not wait on the previous test's app being deleted.
let apps = 0;

class Db extends FirestoreAtom.Service<Db>()("test/MutationDb", {
  layer: () =>
    ClientFirestore.layer({ emulator }).pipe(
      Layer.provide(App.layer({ projectId }, `firestore-atom-mutation-${++apps}`)),
    ),
}) {}

/**
 * A registry for the rest of the test, with `Db`'s runtime mounted, and the
 * Client Firestore that runtime holds, for reading back what the atoms wrote.
 */
const fresh = Effect.gen(function* () {
  yield* clear(projectId);
  const registry = yield* Effect.acquireRelease(
    Effect.sync(() => AtomRegistry.make()),
    (registry) => Effect.sync(() => registry.dispose()),
  );
  yield* AtomRegistry.mount(registry, Db.runtime);
  const context = yield* AtomRegistry.getResult(registry, Db.runtime);
  return { registry, firestore: Context.get(context, Db) };
});

/**
 * Mounts `atom` for the rest of the test, writes `arg` to it, and waits for
 * the atom to settle on the write's outcome.
 */
const run = <Arg, A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.AtomResultFn<Arg, A, E>,
  arg: Arg,
) =>
  Effect.gen(function* () {
    yield* AtomRegistry.mount(registry, atom);
    registry.set(atom, arg);
    return yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
  });

describe("FirestoreAtom.Service setDoc", () => {
  it.live("writes the document and succeeds", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;

      const result = yield* run(registry, Db.setDoc(hello), {
        data: { title: "Hello", views: 1 },
      });

      expect(result).toBeUndefined();
      const snapshot = yield* firestore.getDoc(hello);
      assert(snapshot._tag === "Existing");
      expect(yield* snapshot.data).toMatchObject({ title: "Hello", views: 1 });
      expect(AsyncResult.isSuccess(registry.get(Db.setDoc(hello)))).toBe(true);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service addDoc", () => {
  it.live("writes a document under a new id and succeeds with its ref", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;

      const ref = yield* run(registry, Db.addDoc(Posts.collection()), {
        data: { title: "Hello", views: 1 },
      });

      expect(ref.path).toMatch(/^posts\/[^/]+$/);
      const snapshot = yield* firestore.getDoc(ref);
      assert(snapshot._tag === "Existing");
      expect(yield* snapshot.data).toMatchObject({ title: "Hello", views: 1 });
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service updateDoc", () => {
  it.live("changes the fields of the patch and succeeds", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });

      const result = yield* run(registry, Db.updateDoc(hello), { data: { views: 2 } });

      expect(result).toBeUndefined();
      const snapshot = yield* firestore.getDoc(hello);
      assert(snapshot._tag === "Existing");
      expect(yield* snapshot.data).toMatchObject({ title: "Hello", views: 2 });
    }).pipe(Effect.scoped),
  );

  it.live("fails with not-found for a document that is not there", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;

      const error = yield* Effect.flip(
        run(registry, Db.updateDoc(hello), { data: { views: 2 }, mode: "unchecked" }),
      );

      assert(error instanceof FirestoreError);
      expect(error.code).toBe("not-found");
      expect(AsyncResult.isFailure(registry.get(Db.updateDoc(hello)))).toBe(true);
    }).pipe(Effect.scoped),
  );
});

describe("FirestoreAtom.Service mutation atoms", () => {
  it("are the same atom for equal refs, and apart for different ones", () => {
    const again = Posts.doc(Posts.id.make("hello"));
    const other = Posts.doc(Posts.id.make("other"));

    expect(Db.setDoc(again)).toBe(Db.setDoc(hello));
    expect(Db.updateDoc(again)).toBe(Db.updateDoc(hello));
    expect(Db.addDoc(Posts.collection())).toBe(Db.addDoc(Posts.collection()));
    expect(Db.setDoc(other)).not.toBe(Db.setDoc(hello));
    expect(Db.updateDoc(hello)).not.toBe(Db.setDoc(hello));
  });

  it.live("show the write in a read atom on the same document", () =>
    Effect.gen(function* () {
      const { registry } = yield* fresh;
      yield* AtomRegistry.mount(registry, Db.doc(hello));

      yield* run(registry, Db.setDoc(hello), { data: { title: "Hello", views: 1 } });

      const read = registry.get(Db.doc(hello));
      assert(AsyncResult.isSuccess(read) && read.value._tag === "Existing");
      expect(read.value.data).toMatchObject({ title: "Hello", views: 1 });
    }).pipe(Effect.scoped),
  );

  it.live("stay waiting while offline, and succeed once the server has the write", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      const atom = Db.setDoc(hello);
      yield* AtomRegistry.mount(registry, atom);
      yield* AtomRegistry.mount(registry, Db.doc(hello));

      yield* Effect.promise(() => disableNetwork(firestore.instance));
      registry.set(atom, { data: { title: "Hello", views: 1 } });
      yield* Effect.sleep("200 millis");

      expect(registry.get(atom).waiting).toBe(true);
      const read = registry.get(Db.doc(hello));
      assert(AsyncResult.isSuccess(read) && read.value._tag === "Existing");
      expect(read.value.metadata.hasPendingWrites).toBe(true);

      yield* Effect.promise(() => enableNetwork(firestore.instance));

      yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
      expect(AsyncResult.isSuccess(registry.get(atom))).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.live("complete every write in flight at once", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      const atom = Db.updateDoc(hello);
      yield* AtomRegistry.mount(registry, atom);

      yield* Effect.promise(() => disableNetwork(firestore.instance));
      registry.set(atom, { data: { title: "Bye" } });
      registry.set(atom, { data: { views: 2 } });
      yield* Effect.sleep("200 millis");
      expect(registry.get(atom).waiting).toBe(true);
      yield* Effect.promise(() => enableNetwork(firestore.instance));

      yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
      const snapshot = yield* firestore.getDoc(hello, { source: "server" });
      assert(snapshot._tag === "Existing");
      expect(yield* snapshot.data).toMatchObject({ title: "Bye", views: 2 });
    }).pipe(Effect.scoped),
  );

  it.live("fail when any write in flight fails", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      const atom = Db.updateDoc(hello);
      yield* AtomRegistry.mount(registry, atom);

      yield* Effect.promise(() => disableNetwork(firestore.instance));
      registry.set(atom, { data: { views: 2 } });
      registry.set(atom, { data: { views: Number.NaN } });
      yield* Effect.promise(() => enableNetwork(firestore.instance));

      const error = yield* Effect.flip(
        AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }),
      );
      expect(error).toBeInstanceOf(Schema.SchemaError);
    }).pipe(Effect.scoped),
  );

  it.live("keep the status of writes to different documents apart", () =>
    Effect.gen(function* () {
      const { registry, firestore } = yield* fresh;
      const other = Posts.doc(Posts.id.make("other"));
      yield* AtomRegistry.mount(registry, Db.setDoc(hello));
      yield* AtomRegistry.mount(registry, Db.setDoc(other));

      yield* Effect.promise(() => disableNetwork(firestore.instance));
      registry.set(Db.setDoc(hello), { data: { title: "Hello", views: 1 } });
      yield* Effect.sleep("100 millis");

      expect(registry.get(Db.setDoc(hello)).waiting).toBe(true);
      const untouched = registry.get(Db.setDoc(other));
      expect(AsyncResult.isInitial(untouched) && !untouched.waiting).toBe(true);

      registry.set(Db.setDoc(other), { data: { title: "Other", views: Number.NaN } });
      expect(AsyncResult.isFailure(registry.get(Db.setDoc(other)))).toBe(true);
      expect(AsyncResult.isFailure(registry.get(Db.setDoc(hello)))).toBe(false);
      expect(registry.get(Db.setDoc(hello)).waiting).toBe(true);

      yield* Effect.promise(() => enableNetwork(firestore.instance));
      yield* AtomRegistry.getResult(registry, Db.setDoc(hello), { suspendOnWaiting: true });
      expect(AsyncResult.isFailure(registry.get(Db.setDoc(other)))).toBe(true);
    }).pipe(Effect.scoped),
  );
});
