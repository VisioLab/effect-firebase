import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Queue, Schema } from "effect";
import { Collection, CollectionGroup, FirestoreModel } from "@visiolab/effect-firebase/firestore";
import * as App from "../../src/app/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import { emulator, fresh, listening } from "./emulator.ts";

// How a Collection Group listener follows changes is in the conformance suite;
// these tests cover the Snapshot Metadata only the client has.

const projectId = "demo-client-collection-group-stream";

const layer = ClientFirestore.layer({ emulator }).pipe(
  Layer.provideMerge(App.layer({ projectId }, "collection-group-stream")),
);

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Users = Collection.make("users", User);
const UserPosts = Users.subcollection("posts", Post);
const AllUserPosts = CollectionGroup.make(UserPosts);

const alice = Users.id.make("alice");
const hello = UserPosts.id.make("hello");

describe("streamDocs of a Collection Group", () => {
  it.effect("emits each snapshot with the metadata of the read and its documents", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(projectId);
      const snapshots = yield* listening(firestore.streamDocs(AllUserPosts));

      const empty = yield* Queue.take(snapshots);
      expect(empty.metadata).toEqual({ fromCache: false, hasPendingWrites: false });

      yield* firestore.setDoc(UserPosts.doc(alice, hello), { title: "Hello", views: 1 });
      const written = yield* Queue.take(snapshots);
      expect(written.metadata).toEqual({ fromCache: false, hasPendingWrites: true });
      expect(written.docs.map((doc) => doc.metadata)).toEqual([
        { fromCache: false, hasPendingWrites: true },
      ]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  // Live, because acknowledging a write waits on the SDK's own connection
  // rather than on the test clock.
  it.live("with includeMetadataChanges, emits again once a write is acknowledged", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(projectId);
      const snapshots = yield* listening(
        firestore.streamDocs(AllUserPosts, { includeMetadataChanges: true }),
      );
      yield* Queue.take(snapshots).pipe(
        Effect.repeat({ until: (snapshot) => !snapshot.metadata.fromCache }),
      );

      yield* firestore.setDoc(UserPosts.doc(alice, hello), { title: "Hello", views: 1 });

      const pending = yield* Queue.take(snapshots);
      const acknowledged = yield* Queue.take(snapshots);
      expect(pending.metadata.hasPendingWrites).toBe(true);
      expect(acknowledged.metadata.hasPendingWrites).toBe(false);
      expect(acknowledged.docs.map((doc) => doc.ref.path)).toEqual(["users/alice/posts/hello"]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
