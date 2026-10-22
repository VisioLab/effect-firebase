import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Layer, Queue, Schema, Stream } from "effect";
import type { Firestore } from "@visiolab/effect-firebase/firestore/Firestore";
import { deleteDoc, disableNetwork, doc, enableNetwork } from "firebase/firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as App from "../../src/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import { clear, emulator } from "./emulator.ts";

const projectId = "demo-client-read-source";

const layer = ClientFirestore.layer({ emulator }).pipe(
  Layer.provideMerge(App.layer({ projectId }, "read-source")),
);

/** A second client of the same project, with a cache of its own. */
const otherClient = ClientFirestore.layer({ emulator }).pipe(
  Layer.provide(App.layer({ projectId }, "read-source-other")),
);

class Place extends FirestoreModel.Class<Place>("Place")({
  name: Schema.String,
}) {}

const Places = Collection.make("places", Place);

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.id.make("hello");

const fresh = clear(projectId).pipe(Effect.andThen(ClientFirestore.ClientFirestore));

/**
 * Keeps a listener on what `stream` follows for the rest of the test, once it
 * has heard from the server, so the SDK's cache keeps hold of it: without one,
 * what a read has seen is dropped from the memory cache again.
 */
const holding = <A, E>(stream: Stream.Stream<A, E>) =>
  Stream.toQueue(stream, { capacity: "unbounded" }).pipe(Effect.flatMap(Queue.take));

/** Runs `effect` with the network off, toggled through `instance`. */
const offline = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { instance } = yield* ClientFirestore.ClientFirestore;
    yield* Effect.promise(() => disableNetwork(instance));
    return yield* effect.pipe(Effect.ensuring(Effect.promise(() => enableNetwork(instance))));
  });

describe("ClientFirestore, read source", () => {
  it("takes read options on Client Firestore alone", () => {
    expectTypeOf<ClientFirestore.ReadSource>().toEqualTypeOf<"default" | "server" | "cache">();
    type Client = ClientFirestore.ClientFirestore;
    expectTypeOf<Client["getDoc"]>()
      .parameter(1)
      .toEqualTypeOf<ClientFirestore.ReadOptions | undefined>();
    expectTypeOf<Client["getDocs"]>()
      .parameter(1)
      .toEqualTypeOf<ClientFirestore.ReadOptions | undefined>();
    // The portable service reads from wherever its SDK does, and takes no say
    // in it.
    expectTypeOf<Firestore["getDoc"]>().parameters.toEqualTypeOf<
      [ref: Collection.DocumentReference<Collection.Any>]
    >();
    expectTypeOf<Firestore["getDocs"]>().parameters.toEqualTypeOf<
      [ref: Collection.CollectionReference<Collection.Any>]
    >();
  });

  it.live("reads a document it has seen from the cache", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      yield* holding(firestore.streamDoc(Posts.doc(hello)));
      const snapshot = yield* firestore.getDoc(Posts.doc(hello), { source: "cache" });

      expect(snapshot._tag).toBe("Existing");
      expect(snapshot.metadata).toEqual({ fromCache: true, hasPendingWrites: false });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  // Not being cached is not the same as not existing.
  it.effect("fails a document the cache has never seen as unavailable", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      const error = yield* Effect.flip(firestore.getDoc(Posts.doc(hello), { source: "cache" }));

      expect(error).toMatchObject({ _tag: "FirestoreError", code: "unavailable" });
    }).pipe(Effect.provide(layer)),
  );

  it.live("reads a document the cache knows was deleted as missing", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      yield* holding(firestore.streamDoc(Posts.doc(hello)));
      yield* Effect.promise(() => deleteDoc(doc(firestore.instance, Posts.doc(hello).path)));
      const snapshot = yield* firestore.getDoc(Posts.doc(hello), { source: "cache" });

      expect(snapshot._tag).toBe("Missing");
      expect(snapshot.metadata).toEqual({ fromCache: true, hasPendingWrites: false });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  // Unlike a document, a collection read from the cache never fails for what
  // the cache lacks.
  it.effect("reads a collection with nothing cached as empty, from the cache", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      // Written by another client, so that the server holds a document this
      // one's cache has never seen.
      yield* Effect.flatMap(ClientFirestore.ClientFirestore, (other) =>
        other.setDoc(Places.doc(Places.id.make("home")), { name: "Home" }),
      ).pipe(Effect.provide(otherClient));
      const snapshot = yield* firestore.getDocs(Places.collection(), { source: "cache" });

      expect(snapshot.docs).toEqual([]);
      expect(snapshot.metadata).toEqual({ fromCache: true, hasPendingWrites: false });
    }).pipe(Effect.provide(layer)),
  );

  it.live("fails a read from the server while offline, rather than read the cache", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;

      yield* firestore.setDoc(Posts.doc(hello), { title: "Hello", views: 1 });
      yield* holding(firestore.streamDocs(Posts.collection()));
      const [document, collection] = yield* offline(
        Effect.all([
          Effect.flip(firestore.getDoc(Posts.doc(hello), { source: "server" })),
          Effect.flip(firestore.getDocs(Posts.collection(), { source: "server" })),
        ]),
      );

      expect(document).toMatchObject({ _tag: "FirestoreError", code: "unavailable" });
      expect(collection).toMatchObject({ _tag: "FirestoreError", code: "unavailable" });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
