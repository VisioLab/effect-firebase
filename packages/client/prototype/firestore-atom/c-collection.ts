// PROTOTYPE — candidate C: atoms hung off the Collection.
//
// The literal form, `Posts.atom.doc(id)`, cannot be built: `Collection` lives in
// the portable core package, which knows neither the client SDK nor any
// runtime. Hanging atoms on it would need a module-augmented core plus a global,
// library-owned runtime with fixed configuration (research choice 1c).
//
// The closest buildable form binds a collection to a runtime once and reads
// atoms by id, mirroring `Collection.doc(...ids)` / `Collection.collection(...ancestors)`.
import type * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type { Atom } from "effect/reactivity";
import * as core from "./core.ts";

export const collection = <ER, C extends Collection.Any>(
  runtime: Atom.AtomRuntime<ClientFirestore.ClientFirestore, ER>,
  self: C,
) => {
  const atoms = core.make(runtime);
  return {
    doc: (...ids: Parameters<C["doc"]>) =>
      atoms.doc((self.doc as any)(...ids) as Collection.DocumentReference<C>),
    all: (...ancestors: Parameters<C["collection"]>) =>
      atoms.docs((self.collection as any)(...ancestors) as Collection.CollectionReference<C>),
    setDoc: atoms.setDoc(self),
    addDoc: atoms.addDoc(self),
  };
};
