import { Effect, Inspectable, Predicate, Schema } from "effect";
import type * as Collection from "../Collection.ts";
import type * as DocumentSnapshot from "../DocumentSnapshot.ts";
import * as firestoreValue from "./firestoreValue.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/firestore/DocumentSnapshot";

/** @internal */
export const isDocumentSnapshot = (
  u: unknown,
): u is DocumentSnapshot.DocumentSnapshot<Collection.Any> => Predicate.hasProperty(u, TypeId);

/** @internal */
export const isExisting = <C extends Collection.Any>(
  self: DocumentSnapshot.DocumentSnapshot<C>,
): self is DocumentSnapshot.Existing<C> => self._tag === "Existing";

/** @internal */
export const isMissing = <C extends Collection.Any>(
  self: DocumentSnapshot.DocumentSnapshot<C>,
): self is DocumentSnapshot.Missing<C> => self._tag === "Missing";

/**
 * The untyped shapes behind the exported ones.
 *
 * The schema is held as one that decodes with no services, which is what is
 * left of the collection's own once its type is erased: `Existing<C>` is what
 * puts the real ones back.
 */
interface ExistingImpl {
  readonly ref: {
    readonly path: string;
    readonly collection: { readonly schema: Schema.Decoder<unknown> };
  };
  readonly id: string;
  readonly raw: unknown;
}

interface MissingImpl {
  readonly ref: Collection.DocumentReference<Collection.Any>;
  readonly id: string;
}

const ExistingProto = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  _tag: "Existing" as const,
  toJSON(this: ExistingImpl) {
    return {
      _id: "DocumentSnapshot",
      _tag: "Existing",
      ref: this.ref.path,
      raw: Inspectable.toJson(this.raw),
    };
  },
  // A getter rather than a field, so that nothing is built until it is asked
  // for. It suspends as well, because a schema that decodes synchronously
  // decodes when it is called rather than when it is run, which would decode
  // on reading `data` and replay that one result on every run.
  // `raw` holds Firestore Values, which the SDK mapped its own values to, so it
  // is decoded through the codec derived from the model rather than the model
  // itself. Derivation is memoized, so this costs nothing after the first read.
  get data(): Effect.Effect<unknown, Schema.SchemaError> {
    const self = this as unknown as ExistingImpl;
    return Effect.suspend(() =>
      Schema.decodeUnknownEffect(firestoreValue.toCodecFirestore(self.ref.collection.schema))(
        self.raw,
      ),
    );
  },
};

const MissingProto = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  _tag: "Missing" as const,
  toJSON(this: MissingImpl) {
    return { _id: "DocumentSnapshot", _tag: "Missing", ref: this.ref.path };
  },
};

/** @internal */
export const existing = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  data: unknown,
): DocumentSnapshot.Existing<C> => {
  const self = Object.assign(Object.create(ExistingProto) as typeof ExistingProto, {
    ref,
    id: ref.id,
    raw: data,
  });
  return self as unknown as DocumentSnapshot.Existing<C>;
};

/** @internal */
export const missing = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
): DocumentSnapshot.Missing<C> => {
  const self: MissingImpl = Object.assign(Object.create(MissingProto) as typeof MissingProto, {
    ref,
    id: ref.id,
  });
  return self as unknown as DocumentSnapshot.Missing<C>;
};

/** @internal */
export const make = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  data: unknown,
): DocumentSnapshot.DocumentSnapshot<C> =>
  data === undefined ? missing(ref) : existing(ref, data);
