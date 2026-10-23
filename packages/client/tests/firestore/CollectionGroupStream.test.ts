import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Queue, Schema } from "effect";
import { Firestore, UndefinedCollectionError } from "@visiolab/effect-firebase/firestore/Firestore";
import { Collection, CollectionGroup, FirestoreModel } from "@visiolab/effect-firebase/firestore";
import * as App from "../../src/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import { clear, emulator, fresh, listening } from "./emulator.ts";

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

/** A `posts` at the root, which the group does not define. */
const RootPosts = Collection.make("posts", Post);

const alice = Users.id.make("alice");
const bob = Users.id.make("bob");
const hello = UserPosts.id.make("hello");
const intro = UserPosts.id.make("intro");

class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}
class OrgPost extends FirestoreModel.Class<OrgPost>("OrgPost")({
  headline: Schema.String,
  pinned: Schema.Boolean,
}) {}

const Orgs = Collection.make("orgs", Org);
const OrgPosts = Orgs.subcollection("posts", OrgPost);
const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);

const acme = Orgs.id.make("acme");
const launch = OrgPosts.id.make("launch");

const freshFirestore = clear(projectId).pipe(Effect.andThen(Firestore));

describe("streamDocs of a Collection Group", () => {
  it.effect("starts with the group as it is, and follows a change under any parent", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;
      const snapshots = yield* listening(firestore.streamDocs(AllUserPosts));

      expect((yield* Queue.take(snapshots)).docs).toEqual([]);

      yield* firestore.setDoc(UserPosts.doc(alice, hello), { title: "Hello", views: 1 });
      const first = yield* Queue.take(snapshots);
      expect(first.docs.map((doc) => doc.ref.path)).toEqual(["users/alice/posts/hello"]);
      expect(first.docs.map((doc) => doc.ref.ancestors)).toEqual([[alice]]);
      expect(yield* Effect.forEach(first.docs, (doc) => doc.data)).toEqual([
        { title: "Hello", views: 1 },
      ]);

      yield* firestore.setDoc(UserPosts.doc(bob, intro), { title: "Intro", views: 2 });
      const added = yield* Queue.take(snapshots);
      expect(added.docs.map((doc) => doc.ref.path).toSorted()).toEqual([
        "users/alice/posts/hello",
        "users/bob/posts/intro",
      ]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("follows a change in any collection of a group of several", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;
      const snapshots = yield* listening(firestore.streamDocs(AllPosts));
      expect((yield* Queue.take(snapshots)).docs).toEqual([]);

      yield* firestore.setDoc(UserPosts.doc(alice, hello), { title: "Hello", views: 1 });
      expect((yield* Queue.take(snapshots)).docs.map((doc) => doc.ref.path)).toEqual([
        "users/alice/posts/hello",
      ]);

      yield* firestore.setDoc(OrgPosts.doc(acme, launch), { headline: "Launch", pinned: false });
      const added = yield* Queue.take(snapshots);
      const orgPost = added.docs.find(OrgPosts.contains);
      expect(orgPost?.ref.ancestors).toEqual([acme]);
      expect(yield* orgPost!.data).toEqual({ headline: "Launch", pinned: false });

      yield* firestore.updateDoc(UserPosts.doc(alice, hello), { views: 2 });
      const updated = yield* Queue.take(snapshots);
      const userPost = updated.docs.find(UserPosts.contains);
      expect(yield* userPost!.data).toEqual({ title: "Hello", views: 2 });
      expect(updated.docs.filter(OrgPosts.contains)).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("fails once a document under the collection id appears at an undefined path", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;
      const snapshots = yield* listening(firestore.streamDocs(AllUserPosts));
      expect((yield* Queue.take(snapshots)).docs).toEqual([]);

      yield* firestore.setDoc(RootPosts.doc(RootPosts.id.make("stray")), {
        title: "Stray",
        views: 0,
      });

      const error = yield* Effect.flip(Queue.take(snapshots));

      expect(error).toBeInstanceOf(UndefinedCollectionError);
      expect(error).toMatchObject({ path: "posts/stray", collectionId: "posts" });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

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
