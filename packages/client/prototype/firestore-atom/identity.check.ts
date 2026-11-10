// PROTOTYPE — run with `vpx prototype/firestore-atom/identity.check.ts`
import * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Layer, Schema } from "effect";
import { Atom } from "effect/reactivity";
import * as core from "./core.ts";

class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
const Posts = Collection.make("posts", Post);
const runtime = Atom.runtime(
  Layer.empty as unknown as Layer.Layer<ClientFirestore.ClientFirestore>,
);
const atoms = core.make(runtime);
const id = Posts.id.make("hello");
console.log("same ref, no options:", atoms.doc(Posts.doc(id)) === atoms.doc(Posts.doc(id)));
console.log(
  "same ref, equal options:",
  atoms.doc(Posts.doc(id), { source: "cache" }) === atoms.doc(Posts.doc(id), { source: "cache" }),
);
console.log(
  "different options:",
  atoms.doc(Posts.doc(id)) === atoms.doc(Posts.doc(id), { source: "cache" }),
);
console.log("same collection mutation:", atoms.setDoc(Posts) === atoms.setDoc(Posts));
console.log(
  "two core.make on one runtime share:",
  core.make(runtime).doc(Posts.doc(id)) === atoms.doc(Posts.doc(id)),
);
