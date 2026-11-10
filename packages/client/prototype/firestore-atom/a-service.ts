// PROTOTYPE — candidate A: an AtomRpc-style `Service<Self>()(id, { layer })`.
// The class is a Context service for Client Firestore under the app's own id,
// and carries `runtime` plus the read and mutation atoms as statics.
import * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import { Context, Effect, Layer } from "effect";
import { Atom } from "effect/reactivity";
import * as core from "./core.ts";

export interface FirestoreAtomService<Self, Id extends string, ER>
  extends Context.ServiceClass<Self, Id, ClientFirestore.ClientFirestore>, core.FirestoreAtoms<ER> {
  readonly runtime: Atom.AtomRuntime<Self | ClientFirestore.ClientFirestore, ER>;
}

export const Service =
  <Self>() =>
  <const Id extends string, ER>(
    id: Id,
    options: {
      readonly layer:
        | Layer.Layer<ClientFirestore.ClientFirestore, ER>
        | ((get: Atom.AtomContext) => Layer.Layer<ClientFirestore.ClientFirestore, ER>);
    },
  ): FirestoreAtomService<Self, Id, ER> => {
    const self: any = Context.Service<Self, ClientFirestore.ClientFirestore>()(id);
    const withSelf = (layer: Layer.Layer<ClientFirestore.ClientFirestore, ER>) =>
      Layer.provideMerge(
        Layer.effect(self, Effect.service(ClientFirestore.ClientFirestore)),
        layer,
      );
    self.runtime = Atom.runtime(
      typeof options.layer === "function"
        ? (get) => withSelf((options.layer as any)(get))
        : withSelf(options.layer),
    );
    Object.assign(self, core.make(self.runtime));
    return self;
  };
