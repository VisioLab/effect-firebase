/**
 * What reading a document hands back.
 *
 * A snapshot is a reading of one document at one moment. Firestore answers for
 * a document that is not there rather than failing, so a reading knows which
 * document it looked for whether or not it found one, and `exists` reports
 * which of the two happened.
 *
 * The contents are decoded on demand rather than when the reading is built. A
 * read hands back what the database sent, and deciding whether it is a document
 * of the shape the collection was defined with is a separate step that can fail
 * on its own - so a query whose documents are only counted never decodes one,
 * and a document that does not fit its schema fails where it is read rather
 * than where it was fetched.
 *
 * This is the shape both SDKs agree on. The Admin SDK also reports when a
 * document was written and read, and the web SDK reports whether the reading
 * came from the cache; neither is here, because neither is something a caller
 * can ask for without knowing which SDK is underneath.
 *
 * A snapshot is what a read hands back, so the constructors below exist for
 * whoever performed the read - which is to say the bindings, rather than the
 * code reading through them.
 *
 * @since 0.0.0
 */
import { Effect, Inspectable, Option, Predicate, Schema } from "effect";
import type * as Collection from "./Collection.ts";

const TypeId = "~@visiolab/effect-firebase/firestore/Snapshot";

/**
 * A reading of one document, which may not have been there.
 *
 * @category models
 * @since 0.0.0
 */
export interface DocumentSnapshot<C extends Collection.Any> extends Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  /** The document this is a reading of. */
  readonly ref: Collection.DocumentReference<C>;
  /** Its id, which is the last segment of its path. */
  readonly id: Collection.Id<C>;
  /** Whether the document was there. */
  readonly exists: boolean;
  /**
   * Its contents, decoded through the schema of the collection holding it, and
   * absent when the document was not there.
   *
   * Decodes afresh every time it is run: a reading holds what the database
   * sent, not a decoded value it would have to keep in step with.
   */
  readonly data: Effect.Effect<
    Option.Option<Collection.Document<C>>,
    Schema.SchemaError,
    Collection.DocumentSchema<C>["DecodingServices"]
  >;
}

/**
 * A reading of one document that was there.
 *
 * This is what a query hands back for every document it matched: the same
 * reading, minus the way it can come up empty. Narrowing to it is what
 * {@link exists} is for, since a subtype is not something a field can be
 * checked into.
 *
 * @category models
 * @since 0.0.0
 */
export interface QueryDocumentSnapshot<C extends Collection.Any> extends DocumentSnapshot<C> {
  readonly exists: true;
  /**
   * Its contents, which are only ever there.
   *
   * `Some` rather than the contents themselves, because this reading is a
   * subtype of one that can come up empty and so has to answer with something
   * an `Option` accepts. It is the `Option` that proves it: reach through
   * `.value` for what it holds.
   */
  readonly data: Effect.Effect<
    Option.Some<Collection.Document<C>>,
    Schema.SchemaError,
    Collection.DocumentSchema<C>["DecodingServices"]
  >;
}

/**
 * Any reading, of a document in any collection.
 *
 * @category models
 * @since 0.0.0
 */
export type Any = DocumentSnapshot<Collection.Any>;

/**
 * Whether `u` is a reading of a document.
 *
 * @category guards
 * @since 0.0.0
 */
export const isDocumentSnapshot = (u: unknown): u is Any => Predicate.hasProperty(u, TypeId);

/**
 * Whether the document was there, narrowing a reading to one whose contents
 * cannot come up empty.
 *
 * Written as a function rather than read off `exists`, because the two readings
 * are one type and its subtype rather than a choice between two, so nothing but
 * a guard tells the compiler which one it is holding. It also reads as a filter,
 * which is how a list of readings is narrowed to the documents that answered.
 *
 * @category guards
 * @since 0.0.0
 */
export const exists = <C extends Collection.Any>(
  self: DocumentSnapshot<C>,
): self is QueryDocumentSnapshot<C> => self.exists;

/**
 * The untyped shape behind the two exported ones.
 *
 * Both readings are the same object built around a different `data`, so they
 * share one prototype, and the types above are what keep `exists` and what
 * `data` answers with in step.
 */
interface SnapshotImpl<A, R> {
  readonly ref: Collection.DocumentReference<Collection.Any>;
  readonly id: string;
  readonly exists: boolean;
  readonly data: Effect.Effect<Option.Option<A>, Schema.SchemaError, R>;
}

const Proto = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  // The contents are left out: they are held the way the database sent them,
  // and printing those next to a `data` that decodes would name two different
  // things the same.
  toJSON(this: SnapshotImpl<unknown, unknown>) {
    return { _id: "DocumentSnapshot", path: this.ref.path, exists: this.exists };
  },
};

const makeSnapshot = <A, R>(
  ref: Collection.DocumentReference<Collection.Any>,
  exists: boolean,
  data: Effect.Effect<Option.Option<A>, Schema.SchemaError, R>,
): SnapshotImpl<A, R> =>
  Object.assign(Object.create(Proto) as typeof Proto, { ref, id: ref.id, exists, data });

/**
 * Builds a reading of a document that was there, around an effect that produces
 * the contents the database sent.
 *
 * The contents are asked for rather than handed over, because getting at them
 * costs something of its own: an SDK holds a document the way it arrived over
 * the wire and builds its fields afresh every time. Taking a value here would
 * mean paying that for every document a query answered with, including the ones
 * nobody goes on to read.
 *
 * Nothing therefore knows whether the contents are a document of the shape the
 * collection was defined with until `data` is run, which is what decides it.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  data: Effect.Effect<unknown>,
): QueryDocumentSnapshot<C> => {
  // Named so that the decoder is built against the schema `C` was defined with
  // rather than against `Schema.Top`, which is what keeps the services it
  // decodes through in the type instead of erasing them to `unknown`.
  const schema: Collection.DocumentSchema<C> = ref.collection.schema;
  return makeSnapshot(
    ref,
    true,
    // Both the SDK's fields and the decoding sit behind the effect rather than
    // in front of it, so a reading whose contents are never asked for costs
    // nothing beyond building it.
    Effect.flatMap(data, (contents) => Effect.asSome(Schema.decodeUnknownEffect(schema)(contents))),
  ) as unknown as QueryDocumentSnapshot<C>;
};

/**
 * Builds a reading of a document that was not there.
 *
 * @category constructors
 * @since 0.0.0
 */
export const missing = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
): DocumentSnapshot<C> =>
  makeSnapshot(ref, false, Effect.succeedNone) as unknown as DocumentSnapshot<C>;
