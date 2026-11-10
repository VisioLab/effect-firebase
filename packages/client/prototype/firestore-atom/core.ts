// PROTOTYPE — throwaway, for "What shape does the Firestore atom API take?" (#213).
// Never merged. The shared core every candidate entry point wraps: given an
// AtomRuntime that provides Client Firestore, build read families and
// mutation atoms. Holding / lifetime / mutation semantics are deliberately
// naive (runtime.atom(stream), default auto-dispose); #214–#216 decide them.
import type * as ClientDocumentSnapshot from "@visiolab/effect-firebase-client/firestore/ClientDocumentSnapshot";
import * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import type * as ClientQuerySnapshot from "@visiolab/effect-firebase-client/firestore/ClientQuerySnapshot";
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import type * as Firestore from "@visiolab/effect-firebase/firestore/Firestore";
import { Effect, type Schema, Stream } from "effect";
import type * as Cause from "effect/Cause";
import { Atom, type AsyncResult } from "effect/reactivity";

type Read<A, E> = Atom.Atom<AsyncResult.AsyncResult<A, E | Cause.NoSuchElementError>>;

export interface FirestoreAtoms<ER> {
  readonly doc: <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    options?: ClientFirestore.ListenOptions,
  ) => Read<ClientDocumentSnapshot.ClientDocumentSnapshot<C>, Firestore.FirestoreError | ER>;

  readonly docs: {
    <C extends Collection.Any>(
      ref: Collection.CollectionReference<C>,
      options?: ClientFirestore.ListenOptions,
    ): Read<ClientQuerySnapshot.ClientQuerySnapshot<C>, Firestore.FirestoreError | ER>;
    <G extends CollectionGroup.Any>(
      group: G,
      options?: ClientFirestore.ListenOptions,
    ): Read<
      ClientQuerySnapshot.ClientQuerySnapshot<CollectionGroup.Members<G>>,
      Firestore.FirestoreError | Firestore.UndefinedCollectionError | ER
    >;
  };

  // FINDING: an AtomResultFn's write type is fixed when the atom is made, so a
  // single `setDoc` atom cannot be generic in C the way `ClientFirestore.setDoc`
  // is. The atom has to be made per collection (or per ref, see #216).
  readonly setDoc: <C extends Collection.Any>(
    collection: C,
  ) => Atom.AtomResultFn<
    { readonly ref: Collection.DocumentReference<C>; readonly data: Firestore.Create<C> },
    void,
    Firestore.FirestoreError | Schema.SchemaError | ER
  >;

  readonly addDoc: <C extends Collection.Any>(
    collection: C,
  ) => Atom.AtomResultFn<
    { readonly ref: Collection.CollectionReference<C>; readonly data: Firestore.Create<C> },
    Collection.DocumentReference<C>,
    Firestore.FirestoreError | Schema.SchemaError | ER
  >;
}

export const make = <ER>(
  runtime: Atom.AtomRuntime<ClientFirestore.ClientFirestore, ER>,
): FirestoreAtoms<ER> => {
  // Refs are `Equal` by path, so a plain structural key works as-is.
  const docFamily = Atom.family((key: { ref: Collection.DocumentReference<any>; options: any }) =>
    runtime.atom(
      Stream.unwrap(
        Effect.map(Effect.service(ClientFirestore.ClientFirestore), (db) =>
          db.streamDoc(key.ref, key.options),
        ),
      ),
    ),
  );
  const docsFamily = Atom.family((key: { ref: any; options: any }) =>
    runtime.atom(
      Stream.unwrap(
        Effect.map(Effect.service(ClientFirestore.ClientFirestore), (db) =>
          db.streamDocs(key.ref, key.options),
        ),
      ),
    ),
  );
  // Prototype ignores the model's EncodingServices; the runtime would have to provide them.
  const setDocFamily = Atom.family((_collection: Collection.Any) =>
    runtime.fn(
      (arg: { ref: any; data: any }) =>
        Effect.flatMap(Effect.service(ClientFirestore.ClientFirestore), (db) =>
          db.setDoc(arg.ref, arg.data),
        ) as Effect.Effect<
          void,
          Firestore.FirestoreError | Schema.SchemaError,
          ClientFirestore.ClientFirestore
        >,
    ),
  );
  const addDocFamily = Atom.family((_collection: Collection.Any) =>
    runtime.fn(
      (arg: { ref: any; data: any }) =>
        Effect.flatMap(Effect.service(ClientFirestore.ClientFirestore), (db) =>
          db.addDoc(arg.ref, arg.data),
        ) as Effect.Effect<
          any,
          Firestore.FirestoreError | Schema.SchemaError,
          ClientFirestore.ClientFirestore
        >,
    ),
  );
  return {
    doc: (ref, options) => docFamily({ ref, options }) as any,
    docs: ((ref: any, options: any) => docsFamily({ ref, options })) as any,
    setDoc: (collection) => setDocFamily(collection) as any,
    addDoc: (collection) => addDocFamily(collection) as any,
  };
};
