import { Effect, Inspectable, Predicate, type Schema } from "effect";
import type * as Collection from "../Collection.ts";
import type * as DocumentSnapshot from "../DocumentSnapshot.ts";
import type * as QuerySnapshot from "../QuerySnapshot.ts";
import * as documentSnapshot from "./documentSnapshot.ts";
import { attach, extraOf, extraToJson, type WithExtra } from "./snapshotExtra.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/firestore/QuerySnapshot";

/** @internal */
export const DecodedTypeId = "~@visiolab/effect-firebase/firestore/QuerySnapshot/Decoded";

/** @internal */
export const isQuerySnapshot = (u: unknown): u is QuerySnapshot.QuerySnapshot<Collection.Any> =>
  Predicate.hasProperty(u, TypeId);

interface QuerySnapshotImpl extends WithExtra {
  readonly docs: ReadonlyArray<DocumentSnapshot.Existing<Collection.Any>>;
}

const QuerySnapshotProto = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  toJSON(this: QuerySnapshotImpl) {
    return {
      _id: "QuerySnapshot",
      docs: this.docs.map((doc) => doc.toJSON()),
      ...extraToJson(this),
    };
  },
};

/** @internal */
export const make = <C extends Collection.Any>(
  docs: ReadonlyArray<DocumentSnapshot.Existing<C>>,
  extra?: object,
): QuerySnapshot.QuerySnapshot<C> => {
  const self = Object.assign(Object.create(QuerySnapshotProto) as typeof QuerySnapshotProto, {
    docs,
  });
  return attach(self, extra) as unknown as QuerySnapshot.QuerySnapshot<C>;
};

interface DecodedQuerySnapshotImpl extends WithExtra {
  readonly docs: ReadonlyArray<Inspectable.Inspectable>;
}

const DecodedQuerySnapshotProto = {
  ...Inspectable.BaseProto,
  [DecodedTypeId]: DecodedTypeId,
  toJSON(this: DecodedQuerySnapshotImpl) {
    return {
      _id: "QuerySnapshot",
      docs: this.docs.map((doc) => doc.toJSON()),
      ...extraToJson(this),
    };
  },
};

/**
 * Decodes every document of `self`, failing as a whole on the first that does
 * not match its model, and builds the decoded snapshot with `self`'s extra.
 *
 * @internal
 */
export const decode = <C extends Collection.Any, DocumentExtra extends object>(
  self: QuerySnapshot.QuerySnapshot<C, DocumentExtra>,
): Effect.Effect<
  QuerySnapshot.DecodedQuerySnapshot<C, DocumentExtra>,
  Schema.SchemaError,
  DocumentSnapshot.DecodingServices<C>
> =>
  Effect.map(
    Effect.forEach(
      self.docs as ReadonlyArray<DocumentSnapshot.Existing<C>>,
      documentSnapshot.decodeExisting,
    ),
    (docs) => {
      const decoded = Object.assign(
        Object.create(DecodedQuerySnapshotProto) as typeof DecodedQuerySnapshotProto,
        { docs },
      );
      return attach(decoded, extraOf(self)) as unknown as QuerySnapshot.DecodedQuerySnapshot<
        C,
        DocumentExtra
      >;
    },
  );
