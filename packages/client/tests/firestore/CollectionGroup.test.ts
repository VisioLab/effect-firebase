import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Collection, CollectionGroup, FirestoreModel } from "@visiolab/effect-firebase/firestore";
import * as App from "../../src/app/App.ts";
import * as ClientFirestore from "../../src/firestore/ClientFirestore.ts";
import { emulator, fresh } from "./emulator.ts";

// The portable Collection Group tests live in the conformance suite; this file
// keeps what only the client has, Snapshot Metadata.

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

const alice = Users.id.make("alice");
const hello = UserPosts.id.make("hello");

describe("getDocs of a Collection Group", () => {
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
});
