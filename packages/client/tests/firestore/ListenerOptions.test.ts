import { assert, describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Layer, Queue, Schema, Stream } from "effect";
import { disableNetwork, enableNetwork } from "firebase/firestore";
import { Collection, DocumentSnapshot, FirestoreModel } from "@visiolab/effect-firebase/firestore";
import type { Firestore } from "@visiolab/effect-firebase/firestore/Firestore";
import * as App from "../../src/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import { clear, emulator } from "./emulator.ts";

const projectId = "demo-client-listener-options";

const layer = ClientFirestore.layer({ emulator }).pipe(
  Layer.provideMerge(App.layer({ projectId }, "listener-options")),
);

/** A second client of the same project, with a cache of its own. */
const otherClient = ClientFirestore.layer({ emulator }).pipe(
  Layer.provide(App.layer({ projectId }, "listener-options-other")),
);

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

const fresh = clear(projectId).pipe(Effect.andThen(ClientFirestore.ClientFirestore));

/** Runs `stream` into a queue for the rest of the test. */
const listening = <A, E>(stream: Stream.Stream<A, E>) =>
  Stream.toQueue(stream, { capacity: "unbounded" });

describe("ClientFirestore listener options", () => {
  it("are taken by the client streams alone", () => {
    expectTypeOf<ClientFirestore.ListenOptions>().toEqualTypeOf<{
      readonly includeMetadataChanges?: boolean | undefined;
      readonly source?: "default" | "cache" | undefined;
    }>();

    // Never called: only what the compiler makes of it matters.
    expectTypeOf((client: ClientFirestore.ClientFirestore, portable: Firestore) => [
      client.streamDoc(hello, { includeMetadataChanges: true, source: "cache" }),
      client.streamDocs(Posts.collection(), { includeMetadataChanges: true, source: "cache" }),
      // @ts-expect-error The Admin SDK's listeners take no options.
      portable.streamDoc(hello, { includeMetadataChanges: true }),
      // @ts-expect-error The Admin SDK's listeners take no options.
      portable.streamDocs(Posts.collection(), { source: "cache" }),
    ]).toBeFunction();
    expectTypeOf<ClientFirestore.ClientFirestore>().toExtend<Firestore>();
  });

  // Live, because acknowledging a write waits on the SDK's own connection
  // rather than on the test clock.
  it.live("with includeMetadataChanges, emits again once a write is acknowledged", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      const snapshots = yield* listening(
        firestore.streamDoc(hello, { includeMetadataChanges: true }),
      );
      expect((yield* Queue.take(snapshots))._tag).toBe("Missing");

      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });

      const pending = yield* Queue.take(snapshots);
      const acknowledged = yield* Queue.take(snapshots);
      expect(pending).toMatchObject({
        _tag: "Existing",
        metadata: { hasPendingWrites: true },
      });
      expect(acknowledged).toMatchObject({
        _tag: "Existing",
        metadata: { hasPendingWrites: false },
      });
      assert(DocumentSnapshot.isExisting(pending) && DocumentSnapshot.isExisting(acknowledged));
      expect(yield* acknowledged.data).toEqual(yield* pending.data);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.live("without options, emits nothing when only the metadata changes", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      const plain = yield* listening(firestore.streamDocs(Posts.collection()));
      // Listens to the same query, and so hears of the acknowledgement in the
      // same pass as the plain listener would.
      const witness = yield* listening(
        firestore.streamDocs(Posts.collection(), { includeMetadataChanges: true }),
      );
      expect((yield* Queue.take(plain)).docs).toEqual([]);

      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      yield* Queue.take(witness).pipe(
        Effect.repeat({
          until: (snapshot) => snapshot.docs.length === 1 && !snapshot.metadata.hasPendingWrites,
        }),
      );
      yield* firestore.updateDoc(hello, { views: 2 });

      // Had the acknowledgement been emitted, it would come between the two.
      const first = yield* Queue.take(plain);
      const second = yield* Queue.take(plain);
      expect(first.metadata.hasPendingWrites).toBe(true);
      expect(second.metadata.hasPendingWrites).toBe(true);
      assert(first.docs[0] !== undefined && second.docs[0] !== undefined);
      expect(yield* first.docs[0].data).toMatchObject({ views: 1 });
      expect(yield* second.docs[0].data).toMatchObject({ views: 2 });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.live("with source cache, emits from the local cache without reaching the server", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh;
      yield* firestore.setDoc(hello, { title: "Hello", views: 1 });
      // Keeps the document in the memory cache, which drops what no listener
      // holds on to.
      const held = yield* listening(firestore.streamDoc(hello));
      yield* Queue.take(held);

      // Written by another client, so only the server knows of it.
      const other = Posts.doc(Posts.id.make("other"));
      yield* ClientFirestore.ClientFirestore.use((elsewhere) =>
        elsewhere.setDoc(other, { title: "Other", views: 2 }),
      ).pipe(Effect.provide(otherClient));

      // The server has it, but a listener on the cache alone never asks.
      const unseen = yield* Queue.take(
        yield* listening(firestore.streamDoc(other, { source: "cache" })),
      );
      expect(unseen).toMatchObject({ _tag: "Missing", metadata: { fromCache: true } });

      yield* Effect.promise(() => disableNetwork(firestore.instance));
      yield* Effect.addFinalizer(() => Effect.promise(() => enableNetwork(firestore.instance)));

      const cached = yield* Queue.take(
        yield* listening(firestore.streamDoc(hello, { source: "cache" })),
      );
      expect(cached).toMatchObject({
        _tag: "Existing",
        metadata: { fromCache: true, hasPendingWrites: false },
      });
      assert(DocumentSnapshot.isExisting(cached));
      expect(yield* cached.data).toMatchObject({ title: "Hello", views: 1 });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
