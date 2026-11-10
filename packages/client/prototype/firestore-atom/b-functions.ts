// PROTOTYPE — candidate B: free functions over an AtomRuntime the app already
// built. Atom families are cached per runtime, so the runtime is the first
// argument of every call (or bound once with `make`, which is just core.make).
import type * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type { Atom } from "effect/reactivity";
import * as core from "./core.ts";

type Runtime<ER> = Atom.AtomRuntime<ClientFirestore.ClientFirestore, ER>;

const cache = new WeakMap<Runtime<any>, core.FirestoreAtoms<any>>();
const atomsOf = <ER>(runtime: Runtime<ER>): core.FirestoreAtoms<ER> => {
  let atoms = cache.get(runtime);
  if (atoms === undefined) {
    atoms = core.make(runtime);
    cache.set(runtime, atoms);
  }
  return atoms;
};

export const make = atomsOf;

export const doc = <ER, C extends Collection.Any>(
  runtime: Runtime<ER>,
  ref: Collection.DocumentReference<C>,
  options?: ClientFirestore.ListenOptions,
) => atomsOf(runtime).doc(ref, options);

export const docs: <ER>(runtime: Runtime<ER>) => core.FirestoreAtoms<ER>["docs"] = (runtime) =>
  atomsOf(runtime).docs;

export const setDoc = <ER, C extends Collection.Any>(runtime: Runtime<ER>, collection: C) =>
  atomsOf(runtime).setDoc(collection);
