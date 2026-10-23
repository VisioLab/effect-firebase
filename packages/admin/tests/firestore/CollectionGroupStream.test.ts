import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Queue, Schema, Stream } from "effect";
import { Firestore, UndefinedCollectionError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as App from "../../src/App.ts";
import * as AdminFirestore from "../../src/firestore/AdminFirestore.ts";
import { clear } from "./emulator.ts";

const projectId = "demo-admin-collection-group-stream";

const layer = AdminFirestore.layer().pipe(
  Layer.provide(App.layer({ projectId }, "collection-group-stream")),
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

/**
 * Runs `stream` into a queue for the rest of the test.
 *
 * Each snapshot is taken before the next write, so none is dropped for
 * arriving while another was still waiting to be read.
 */
const listening = <A, E>(stream: Stream.Stream<A, E>) =>
  Stream.toQueue(stream, { capacity: "unbounded" });

describe("streamDocs of a Collection Group", () => {
  it.effect("starts with the group as it is, and follows a change under any parent", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;
      yield* firestore.setDoc(UserPosts.doc(alice, hello), { title: "Hello", views: 1 });

      const snapshots = yield* listening(firestore.streamDocs(AllUserPosts));

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

      yield* firestore.updateDoc(UserPosts.doc(alice, hello), { views: 3 });
      const updated = yield* Queue.take(snapshots);
      const byPath = updated.docs.toSorted((a, b) => a.ref.path.localeCompare(b.ref.path));
      expect(yield* Effect.forEach(byPath, (doc) => doc.data)).toEqual([
        { title: "Hello", views: 3 },
        { title: "Intro", views: 2 },
      ]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("follows a change in any collection of a group of several", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;
      yield* firestore.setDoc(UserPosts.doc(alice, hello), { title: "Hello", views: 1 });

      const snapshots = yield* listening(firestore.streamDocs(AllPosts));
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
      yield* firestore.setDoc(UserPosts.doc(alice, hello), { title: "Hello", views: 1 });

      const snapshots = yield* listening(firestore.streamDocs(AllUserPosts));
      expect((yield* Queue.take(snapshots)).docs).toHaveLength(1);

      yield* firestore.setDoc(RootPosts.doc(RootPosts.id.make("stray")), {
        title: "Stray",
        views: 0,
      });

      const error = yield* Effect.flip(Queue.take(snapshots));

      expect(error).toBeInstanceOf(UndefinedCollectionError);
      expect(error).toMatchObject({ path: "posts/stray", collectionId: "posts" });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
