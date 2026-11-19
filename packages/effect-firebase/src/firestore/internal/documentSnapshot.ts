import { Effect, Inspectable, Predicate, Schema } from "effect";
import type * as Collection from "../Collection.ts";
import type * as DocumentSnapshot from "../DocumentSnapshot.ts";
import * as firestoreValue from "./firestoreValue.ts";
import { attach, extraOf, extraToJson, type WithExtra } from "./snapshotExtra.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/firestore/DocumentSnapshot";

/** @internal */
export const DecodedTypeId = "~@visiolab/effect-firebase/firestore/DocumentSnapshot/Decoded";

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
interface ExistingImpl extends WithExtra {
  readonly ref: {
    readonly path: string;
    readonly collection: { readonly schema: Schema.Decoder<unknown> };
  };
  readonly id: string;
  readonly raw: unknown;
}

interface MissingImpl extends WithExtra {
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
      ...extraToJson(this),
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
    return { _id: "DocumentSnapshot", _tag: "Missing", ref: this.ref.path, ...extraToJson(this) };
  },
};

/** @internal */
export const existing = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  data: unknown,
  extra?: object,
): DocumentSnapshot.Existing<C> => {
  const self = Object.assign(Object.create(ExistingProto) as typeof ExistingProto, {
    ref,
    id: ref.id,
    raw: data,
  });
  return attach(self, extra) as unknown as DocumentSnapshot.Existing<C>;
};

/** @internal */
export const missing = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  extra?: object,
): DocumentSnapshot.Missing<C> => {
  const self: MissingImpl = Object.assign(Object.create(MissingProto) as typeof MissingProto, {
    ref,
    id: ref.id,
  });
  return attach(self, extra) as unknown as DocumentSnapshot.Missing<C>;
};

/** @internal */
export const make = <C extends Collection.Any>(
  ref: Collection.DocumentReference<C>,
  data: unknown,
  extra?: object,
): DocumentSnapshot.DocumentSnapshot<C> =>
  data === undefined ? missing(ref, extra) : existing(ref, data, extra);

interface DecodedExistingImpl extends WithExtra {
  readonly ref: { readonly path: string };
  readonly data: unknown;
}

const DecodedExistingProto = {
  ...Inspectable.BaseProto,
  [DecodedTypeId]: DecodedTypeId,
  _tag: "Existing" as const,
  toJSON(this: DecodedExistingImpl) {
    return {
      _id: "DecodedDocumentSnapshot",
      _tag: "Existing",
      ref: this.ref.path,
      data: Inspectable.toJson(this.data),
      ...extraToJson(this),
    };
  },
};

/**
 * Decodes `self`'s data and builds its decoded form, carrying the same extra.
 *
 * @internal
 */
export const decodeExisting = <C extends Collection.Any>(
  self: DocumentSnapshot.Existing<C>,
): Effect.Effect<
  DocumentSnapshot.DecodedExisting<C>,
  Schema.SchemaError,
  DocumentSnapshot.DecodingServices<C>
> =>
  Effect.map(self.data, (data) => {
    const decoded = Object.assign(
      Object.create(DecodedExistingProto) as typeof DecodedExistingProto,
      { ref: self.ref, id: self.id, raw: self.raw, data },
    );
    return attach(decoded, extraOf(self)) as unknown as DocumentSnapshot.DecodedExisting<C>;
  });

const DecodedMissingProto = {
  ...Inspectable.BaseProto,
  [DecodedTypeId]: DecodedTypeId,
  _tag: "Missing" as const,
  toJSON(this: MissingImpl) {
    return {
      _id: "DecodedDocumentSnapshot",
      _tag: "Missing",
      ref: this.ref.path,
      ...extraToJson(this),
    };
  },
};

/**
 * Builds the decoded form of a missing snapshot, carrying the same extra. There
 * is no data to decode, but it is a value of its own, so a decoded snapshot is
 * never mistaken for a lazy one.
 */
const decodeMissing = <C extends Collection.Any>(
  self: DocumentSnapshot.Missing<C>,
): DocumentSnapshot.DecodedMissing<C> => {
  const decoded = Object.assign(Object.create(DecodedMissingProto) as typeof DecodedMissingProto, {
    ref: self.ref,
    id: self.id,
  });
  return attach(decoded, extraOf(self)) as unknown as DocumentSnapshot.DecodedMissing<C>;
};

/** @internal */
export const decode = <C extends Collection.Any>(
  self: DocumentSnapshot.DocumentSnapshot<C>,
): Effect.Effect<
  DocumentSnapshot.DecodedDocumentSnapshot<C>,
  Schema.SchemaError,
  DocumentSnapshot.DecodingServices<C>
> => (isExisting(self) ? decodeExisting(self) : Effect.succeed(decodeMissing(self)));
