import { Context, Effect, Result, Schema, Stream } from "effect";
import type * as Collection from "../Collection.ts";
import type * as CollectionGroup from "../CollectionGroup.ts";
import type * as DocumentSnapshot from "../DocumentSnapshot.ts";
import type * as Firestore from "../Firestore.ts";
import type * as FirestoreModel from "../FirestoreModel.ts";
import type * as QuerySnapshot from "../QuerySnapshot.ts";
import * as collectionGroup from "./collectionGroup.ts";
import * as documentSnapshot from "./documentSnapshot.ts";
import * as firestoreValue from "./firestoreValue.ts";
import * as firestoreValueWalk from "./firestoreValueWalk.ts";
import * as querySnapshot from "./querySnapshot.ts";

/**
 * The key of `Firestore.With`'s member that holds its transaction services
 * for the compiler alone. Nothing is ever stored under it.
 *
 * @internal
 */
export const TransactionServicesTypeId =
  "~@visiolab/effect-firebase/firestore/Firestore/TransactionServices";

/** What `getDocs` and `streamDocs` read from: a collection, or a group. */
type Source = Collection.CollectionReference<Collection.Any> | CollectionGroup.Any;

/** The last segment of a document's path: its id. */
const idOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * What a hook is handed for `source`, and how each document it read is
 * addressed: in the collection read, by its id, or, for a group, matched by
 * its path to the collection of the group it lives in.
 */
const resolve = (
  source: Source,
): {
  readonly selector: Firestore.CollectionSelector;
  readonly refOf: (
    path: string,
  ) => Result.Result<
    Collection.DocumentReference<Collection.Any>,
    Firestore.UndefinedCollectionError
  >;
} =>
  collectionGroup.isCollectionGroup(source)
    ? {
        selector: { _tag: "CollectionGroup", id: source.id },
        refOf: (path) => collectionGroup.documentAt(source, path),
      }
    : {
        selector: { _tag: "Collection", path: source.path },
        refOf: (path) => Result.succeed(source.doc(source.collection.id.make(idOf(path)))),
      };

// The snapshot constructors put each field of the `extra` they are handed on
// the snapshot, but are typed without it, so the two below say it is there.

/** A snapshot of the document at `ref`, as a hook read it, with its extra. */
const documentSnapshotOf = <C extends Collection.Any, Extra extends object>(
  ref: Collection.DocumentReference<C>,
  read: Firestore.DocumentRead<Extra>,
): Result.Result<DocumentSnapshot.DocumentSnapshot<C> & Extra, Firestore.FirestoreError> =>
  Result.map(
    firestoreValueWalk.checkDocument(ref.path, read.data),
    (data) =>
      documentSnapshot.make(ref, data, read.extra) as DocumentSnapshot.DocumentSnapshot<C> & Extra,
  );

/**
 * A snapshot of the documents a hook read, each addressed by `refOf`, with the
 * extra of each and of the read as a whole.
 */
const querySnapshotOf = <Extra extends object>(
  refOf: ReturnType<typeof resolve>["refOf"],
  read: Firestore.QueryRead<Extra>,
): Result.Result<
  QuerySnapshot.QuerySnapshot<Collection.Any, Extra> & Extra,
  Firestore.FirestoreError | Firestore.UndefinedCollectionError
> =>
  Result.map(
    Result.all(
      read.docs.map((doc) =>
        Result.flatMap(refOf(doc.path), (ref) =>
          Result.map(firestoreValueWalk.checkDocument(ref.path, doc.data), (data) =>
            documentSnapshot.existing(ref, data, doc.extra),
          ),
        ),
      ),
    ),
    (docs) =>
      querySnapshot.make(docs, read.extra) as QuerySnapshot.QuerySnapshot<Collection.Any, Extra> &
        Extra,
  );

/**
 * Turns what is written, in the shape `schema` takes, into Firestore Values,
 * through the codec derived from `schema`. Whatever services the schema
 * encodes through are left for the caller to provide.
 */
const encode = <S extends Schema.Top>(schema: S, data: S["Type"]) =>
  Schema.encodeEffect(firestoreValue.toCodecFirestore(schema))(data);

/** A document, in its model's `create` shape. */
const encodeCreate = <C extends Collection.Any>(collection: C, data: Firestore.Create<C>) => {
  // Named so that the codec is derived from the schema `C` was defined with
  // rather than from `Schema.Top`, which keeps the services it encodes through
  // in the type instead of erasing them to `unknown`.
  const schema: Collection.DocumentSchema<C>["create"] = collection.schema.create;
  // A model is a struct, so it encodes to a map.
  return encode(schema, data) as Effect.Effect<
    Firestore.DocumentData,
    Schema.SchemaError,
    Collection.DocumentSchema<C>["create"]["EncodingServices"]
  >;
};

/**
 * A patch, in its model's update shape for `mode`, which encodes to a map from
 * the field paths it writes at to what it writes there.
 */
const encodeUpdate = <C extends Collection.Any, Mode extends FirestoreModel.UpdateMode>(
  collection: C,
  data: Firestore.Update<C, Mode>,
  mode: Mode | undefined,
) => {
  const schema = (
    mode === "unchecked" ? collection.schema.updateUnchecked : collection.schema.update
  ) as Firestore.UpdateSchema<C, Mode>;
  // Both modes encode the same fields at the same paths, so they ask for the
  // same services.
  return encode(schema, data) as Effect.Effect<
    Firestore.DocumentData,
    Schema.SchemaError,
    Collection.DocumentSchema<C>["update"]["EncodingServices"]
  >;
};

/**
 * Where reads and writes go: straight to the database, or into one attempt at
 * a transaction, through the hooks of {@link Firestore.MakeOptions}, with
 * `getDocs` only where the backend can read many documents there. `name`
 * prefixes the span of each.
 */
interface Target<ReadOptions, Extra extends object>
  extends
    Pick<Firestore.MakeOptions<ReadOptions, never, Extra>, "getDoc" | "setDoc" | "updateDoc">,
    Partial<Pick<Firestore.MakeOptions<ReadOptions, never, Extra>, "getDocs">> {
  readonly name: string;
}

/**
 * The reads and writes a {@link Firestore.Firestore} and a transaction share,
 * made against `target`. Each runs in a span named after it, so traces read
 * the same whichever backend answered.
 */
const operations = <ReadOptions, Extra extends object>(target: Target<ReadOptions, Extra>) => {
  const span = (name: string) => Effect.withSpan(`${target.name}.${name}`);

  const getDocs = target.getDocs;

  return {
    getDoc: <C extends Collection.Any>(
      ref: Collection.DocumentReference<C>,
      options?: ReadOptions,
    ) =>
      Effect.flatMap(target.getDoc(ref.path, options), (read) =>
        Effect.fromResult(documentSnapshotOf(ref, read)),
      ).pipe(span("getDoc")),

    getDocs:
      getDocs === undefined
        ? undefined
        : (source: Source, options?: ReadOptions) => {
            const { selector, refOf } = resolve(source);
            return Effect.flatMap(getDocs(selector, options), (read) =>
              Effect.fromResult(querySnapshotOf(refOf, read)),
            ).pipe(span("getDocs"));
          },

    setDoc: <C extends Collection.Any>(
      ref: Collection.DocumentReference<C>,
      data: Firestore.Create<C>,
    ) =>
      Effect.flatMap(encodeCreate(ref.collection, data), (encoded) =>
        target.setDoc(ref.path, encoded),
      ).pipe(span("setDoc")),

    updateDoc: <C extends Collection.Any, Mode extends FirestoreModel.UpdateMode = "checked">(
      ref: Collection.DocumentReference<C>,
      data: Firestore.Update<C, Mode>,
      options?: Firestore.UpdateOptions<Mode>,
    ) =>
      Effect.flatMap(encodeUpdate(ref.collection, data, options?.mode), (encoded) =>
        target.updateDoc(ref.path, encoded),
      ).pipe(span("updateDoc")),
  };
};

/**
 * The transaction a body reads and writes through, over the operations of one
 * attempt.
 */
const transactionOf = <Operations extends Firestore.TransactionOperations>(
  transaction: Operations,
): Firestore.BuiltTransaction<Operations> => {
  const readMany = transaction.getDocs;
  const { getDoc, getDocs, setDoc, updateDoc } = operations<never, {}>({
    name: "Firestore.Transaction",
    getDoc: (path) => transaction.getDoc(path),
    getDocs: readMany === undefined ? undefined : (selector) => readMany(selector),
    setDoc: transaction.setDoc,
    updateDoc: transaction.updateDoc,
  });
  // `getDocs` is there exactly where `Operations` has one, which is what
  // `BuiltTransaction` says, though the compiler cannot follow it into the
  // conditional type.
  return (
    getDocs === undefined ? { getDoc, setDoc, updateDoc } : { getDoc, setDoc, updateDoc, getDocs }
  ) as Firestore.BuiltTransaction<Operations>;
};

/**
 * The key a transaction body finds its {@link Firestore.Transaction} under is
 * handed in by the public module that defines it, so that this one only
 * imports it as a type and the two do not import each other.
 *
 * @internal
 */
export const make = <
  ReadOptions,
  ListenOptions,
  Extra extends object,
  Operations extends Firestore.TransactionOperations,
  TransactionServices,
>(
  options: Firestore.MakeOptions<
    ReadOptions,
    ListenOptions,
    Extra,
    Operations,
    TransactionServices
  >,
  Transaction: typeof Firestore.Transaction,
): Firestore.With<ReadOptions, ListenOptions, Extra, TransactionServices> => {
  const { getDoc, getDocs, setDoc, updateDoc } = operations<ReadOptions, Extra>({
    name: "Firestore",
    getDoc: options.getDoc,
    getDocs: options.getDocs,
    setDoc: options.setDoc,
    updateDoc: options.updateDoc,
  });

  const addDoc = <C extends Collection.Any>(
    ref: Collection.CollectionReference<C>,
    data: Firestore.Create<C>,
  ) =>
    Effect.flatMap(encodeCreate(ref.collection, data), (encoded) =>
      Effect.map(options.addDoc(ref.path, encoded), (id) => ref.doc(ref.collection.id.make(id))),
    ).pipe(Effect.withSpan("Firestore.addDoc"));

  // Each read is decoded as it is pulled, so a reader that falls behind only
  // decodes the latest one the hook kept.
  const streamDoc = <C extends Collection.Any>(
    ref: Collection.DocumentReference<C>,
    listenOptions?: ListenOptions,
  ) =>
    Stream.mapEffect(options.streamDoc(ref.path, listenOptions), (read) =>
      Effect.fromResult(documentSnapshotOf(ref, read)),
    ).pipe(Stream.withSpan("Firestore.streamDoc"));

  const streamDocs = (source: Source, listenOptions?: ListenOptions) => {
    const { selector, refOf } = resolve(source);
    return Stream.mapEffect(options.streamDocs(selector, listenOptions), (read) =>
      Effect.fromResult(querySnapshotOf(refOf, read)),
    ).pipe(Stream.withSpan("Firestore.streamDocs"));
  };

  const runTransaction = Effect.fn("Firestore.runTransaction")(function* <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    transactionOptions?: Firestore.TransactionOptions,
  ) {
    // Captured inside the span, so the body's own spans hang off it, and
    // handed to the body whole, so it needs nothing from wherever the hook
    // runs it.
    const context =
      yield* Effect.context<Exclude<R, Firestore.Transaction | TransactionServices>>();
    const offer = options.runTransaction.context;
    const maxAttempts = transactionOptions?.maxAttempts;

    return yield* options.runTransaction.run(
      (operations) => {
        // One transaction, under every tag, so that helpers asking for any of
        // them read and write through it alike.
        const transaction = transactionOf(operations);
        const withTransaction = Context.add(context, Transaction, transaction);
        return Effect.provideContext(
          effect,
          (offer === undefined
            ? withTransaction
            : Context.merge(withTransaction, offer(transaction))) as Context.Context<R>,
        );
      },
      // Left out rather than `undefined` where it is not set, since some
      // backends read `undefined` as no retries at all.
      maxAttempts === undefined ? {} : { maxAttempts },
    );
  });

  return {
    getDoc,
    getDocs: getDocs as Firestore.With<ReadOptions, never, Extra>["getDocs"],
    setDoc,
    updateDoc,
    addDoc,
    streamDoc,
    streamDocs: streamDocs as Firestore.With<never, ListenOptions, Extra>["streamDocs"],
    runTransaction,
  };
};
