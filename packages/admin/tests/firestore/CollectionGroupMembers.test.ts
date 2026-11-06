import { describe, expect, it } from "@effect/vitest";
import { Effect, Equal, Layer, Schema } from "effect";
import { Firestore, UndefinedCollectionError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as App from "../../src/app/App.ts";
import * as AdminFirestore from "../../src/firestore/AdminFirestore.ts";
import { clear } from "./emulator.ts";

const projectId = "demo-admin-collection-group-members";

const layer = AdminFirestore.layer().pipe(
  Layer.provide(App.layer({ projectId }, "collection-group-members")),
);

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}
class UserPost extends FirestoreModel.Class<UserPost>("UserPost")({
  title: Schema.String,
  views: Schema.Finite,
}) {}
class OrgPost extends FirestoreModel.Class<OrgPost>("OrgPost")({
  headline: Schema.String,
  pinned: Schema.Boolean,
}) {}

const Users = Collection.make("users", User);
const Orgs = Collection.make("orgs", Org);
const UserPosts = Users.subcollection("posts", UserPost);
const OrgPosts = Orgs.subcollection("posts", OrgPost);
const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);

/** A `posts` under `teams`, which the group does not define. */
const Teams = Collection.make("teams", Org);
const TeamPosts = Teams.subcollection("posts", UserPost);

const alice = Users.id.make("alice");
const acme = Orgs.id.make("acme");

const freshFirestore = clear(projectId).pipe(Effect.andThen(Firestore));

describe("getDocs of a Collection Group of several collections", () => {
  it.effect("reads each document as one of the collection it lives in", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

      yield* firestore.setDoc(UserPosts.doc(alice, UserPosts.id.make("hello")), {
        title: "Hello",
        views: 1,
      });
      yield* firestore.setDoc(OrgPosts.doc(acme, OrgPosts.id.make("launch")), {
        headline: "Launch",
        pinned: true,
      });

      const { docs } = yield* firestore.getDocs(AllPosts);

      const userPosts = docs.filter(UserPosts.contains);
      const orgPosts = docs.filter(OrgPosts.contains);

      expect(userPosts.map((doc) => doc.ref.path)).toEqual(["users/alice/posts/hello"]);
      expect(userPosts.map((doc) => doc.ref.ancestors)).toEqual([[alice]]);
      expect(Equal.equals(userPosts[0].ref, UserPosts.doc(alice, UserPosts.id.make("hello")))).toBe(
        true,
      );
      expect(yield* userPosts[0].data).toEqual({ title: "Hello", views: 1 });

      expect(orgPosts.map((doc) => doc.ref.path)).toEqual(["orgs/acme/posts/launch"]);
      expect(orgPosts.map((doc) => doc.ref.ancestors)).toEqual([[acme]]);
      expect(Equal.equals(orgPosts[0].ref, OrgPosts.doc(acme, OrgPosts.id.make("launch")))).toBe(
        true,
      );
      expect(yield* orgPosts[0].data).toEqual({ headline: "Launch", pinned: true });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails on a document under the collection id that neither collection defines", () =>
    Effect.gen(function* () {
      const firestore = yield* freshFirestore;

      yield* firestore.setDoc(UserPosts.doc(alice, UserPosts.id.make("hello")), {
        title: "Hello",
        views: 1,
      });
      yield* firestore.setDoc(TeamPosts.doc(Teams.id.make("red"), TeamPosts.id.make("stray")), {
        title: "Stray",
        views: 0,
      });

      const error = yield* Effect.flip(firestore.getDocs(AllPosts));

      expect(error).toBeInstanceOf(UndefinedCollectionError);
      expect(error).toMatchObject({ path: "teams/red/posts/stray", collectionId: "posts" });
    }).pipe(Effect.provide(layer)),
  );
});
