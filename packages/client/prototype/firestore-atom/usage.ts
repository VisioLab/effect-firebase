// PROTOTYPE — the same app written against each candidate, so they can be read
// side by side. Hover the `const`s for the inferred atom types.
import * as App from "@visiolab/effect-firebase-client/app/App";
import * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Effect, Layer, Schema } from "effect";
import { Atom, AsyncResult } from "effect/reactivity";
import * as A from "./a-service.ts";
import * as B from "./b-functions.ts";
import * as C from "./c-collection.ts";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}
class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}

const Posts = Collection.make("posts", Post);
const UserPosts = Collection.make("users", User).subcollection("posts", Post);
const AllUserPosts = CollectionGroup.make(UserPosts);

const FirestoreLive = ClientFirestore.layer().pipe(Layer.provide(App.layer({ projectId: "demo" })));

// ── A: service class ────────────────────────────────────────────────────────
class Db extends A.Service<Db>()("app/Db", { layer: FirestoreLive }) {}

export const a = {
  post: Db.doc(Posts.doc(Posts.id.make("hello"))),
  posts: Db.docs(Posts.collection()),
  userPosts: Db.docs(UserPosts.collection(UserPosts.path[0] as never)),
  allUserPosts: Db.docs(AllUserPosts),
  setPost: Db.setDoc(Posts),
  // Derived atoms reuse the same runtime; the Self tag is usable in effects.
  title: Db.runtime.atom((get) =>
    Effect.gen(function* () {
      const snapshot = yield* get.result(Db.doc(Posts.doc(Posts.id.make("hello"))));
      yield* Db; // the app's own tag, as with AtomRpc
      // FINDING: snapshot.data is a lazy decode Effect, so a derived atom decodes
      // on every read; "what read atoms hold" (#214) should decide whether to.
      if (snapshot._tag === "Missing") return "(missing)";
      return (yield* snapshot.data).title;
    }),
  ),
};

// ── B: functions over the app's runtime ─────────────────────────────────────
const runtime = Atom.runtime(FirestoreLive);

export const b = {
  post: B.doc(runtime, Posts.doc(Posts.id.make("hello"))),
  posts: B.docs(runtime)(Posts.collection()),
  allUserPosts: B.docs(runtime)(AllUserPosts),
  setPost: B.setDoc(runtime, Posts),
  // or bind once — at which point it is A without the class:
  bound: B.make(runtime).doc(Posts.doc(Posts.id.make("hello"))),
};

// ── C: collection-bound ─────────────────────────────────────────────────────
const posts = C.collection(runtime, Posts);
const userPosts = C.collection(runtime, UserPosts);

export const c = {
  post: posts.doc(Posts.id.make("hello")),
  posts: posts.all(),
  userPosts: userPosts.all(UserPosts.path[0] as never),
  // Collection Groups have no home here: they aren't a Collection.
  setPost: posts.setDoc,
};

// ── Writing (same for all three; the arg is fixed per collection) ───────────
export const write = (registry: { set: <R, W>(atom: Atom.Writable<R, W>, w: W) => void }) =>
  registry.set(a.setPost, {
    ref: Posts.doc(Posts.id.make("hello")),
    data: { title: "Hi", views: 0 },
  });

// What a component reads, e.g. with a React `useAtomValue(a.post)`:
export const render = (result: Atom.Type<typeof a.post>) =>
  AsyncResult.match(result, {
    onInitial: () => "loading",
    onFailure: (failure) => `error: ${String(failure.cause)}`,
    // Sync render can't run `value.data` (an Effect); needs a decoded atom (#214).
    onSuccess: ({ value }) => (value._tag === "Existing" ? value.id : "missing"),
  });
