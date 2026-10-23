import { describe, expect, it } from "@effect/vitest";
import { Effect, Equal, Layer, Schema } from "effect";
import { Firestore, UndefinedCollectionError } from "@visiolab/effect-firebase/firestore/Firestore";
import { Collection, CollectionGroup, FirestoreModel } from "@visiolab/effect-firebase/firestore";
import * as App from "../../src/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import { clear, emulator, fresh } from "./emulator.ts";

const projectId = "demo-client-collection-group";

const layer = ClientFirestore.layer({ emulator }).pipe(
  Layer.provideMerge(App.layer({ projectId }, "collection-group")),
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
const again = UserPosts.id.make("again");
const intro = UserPosts.id.make("intro");

const freshFirestore = clear(projectId).pipe(Effect.andThen(Firestore));

describe("getDocs of a Collection Group", () => {
  it.effect("reads every document of the collection, across all of its parents", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

      yield* firestore.setDoc(UserPosts.doc(alice, hello), { title: "Hello", views: 1 });
      yield* firestore.setDoc(UserPosts.doc(alice, again), { title: "Again", views: 2 });
      yield* firestore.setDoc(UserPosts.doc(bob, intro), { title: "Intro", views: 3 });

      const snapshot = yield* firestore.getDocs(AllUserPosts);

      const read = yield* Effect.forEach(snapshot.docs, (doc) =>
        Effect.map(doc.data, (data) => ({ doc, data })),
      );
      const byPath = read.toSorted((a, b) => a.doc.ref.path.localeCompare(b.doc.ref.path));

      expect(byPath.map(({ doc }) => doc.ref.path)).toEqual([
        "users/alice/posts/again",
        "users/alice/posts/hello",
        "users/bob/posts/intro",
      ]);
      expect(byPath.map(({ doc }) => doc.ref.ancestors)).toEqual([[alice], [alice], [bob]]);
      expect(byPath.map(({ doc }) => doc.id)).toEqual([again, hello, intro]);
      expect(Equal.equals(byPath[2].doc.ref, UserPosts.doc(bob, intro))).toBe(true);
      expect(byPath.map(({ data }) => data)).toEqual([
        { title: "Again", views: 2 },
        { title: "Hello", views: 1 },
        { title: "Intro", views: 3 },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("hands back the metadata of the read and of each document", () =>
    Effect.gen(function* () {
      const firestore = yield* fresh(projectId);

      yield* firestore.setDoc(UserPosts.doc(alice, hello), { title: "Hello", views: 1 });

      const snapshot = yield* firestore.getDocs(AllUserPosts, { source: "server" });

      expect(snapshot.metadata).toEqual({ fromCache: false, hasPendingWrites: false });
      expect(snapshot.docs.map((doc) => doc.metadata)).toEqual([
        { fromCache: false, hasPendingWrites: false },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads a group with nothing in it as a snapshot with no documents", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

      const snapshot = yield* firestore.getDocs(AllUserPosts);

      expect(snapshot.docs).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails on a document under the collection id at a path the group does not define", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

      yield* firestore.setDoc(UserPosts.doc(alice, hello), { title: "Hello", views: 1 });
      yield* firestore.setDoc(RootPosts.doc(RootPosts.id.make("stray")), {
        title: "Stray",
        views: 0,
      });

      const error = yield* Effect.flip(firestore.getDocs(AllUserPosts));

      expect(error).toBeInstanceOf(UndefinedCollectionError);
      expect(error).toMatchObject({ path: "posts/stray", collectionId: "posts" });
    }).pipe(Effect.provide(layer)),
  );
});
