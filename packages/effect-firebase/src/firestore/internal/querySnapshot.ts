import { Inspectable, Predicate } from "effect";
import type * as Collection from "../Collection.ts";
import type * as DocumentSnapshot from "../DocumentSnapshot.ts";
import type * as QuerySnapshot from "../QuerySnapshot.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/firestore/QuerySnapshot";

/** @internal */
export const isQuerySnapshot = (u: unknown): u is QuerySnapshot.QuerySnapshot<Collection.Any> =>
  Predicate.hasProperty(u, TypeId);

interface QuerySnapshotImpl {
  readonly docs: ReadonlyArray<DocumentSnapshot.Existing<Collection.Any>>;
}

const QuerySnapshotProto = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  toJSON(this: QuerySnapshotImpl) {
    return { _id: "QuerySnapshot", docs: this.docs.map((doc) => doc.toJSON()) };
  },
};

/** @internal */
export const make = <C extends Collection.Any>(
  docs: ReadonlyArray<DocumentSnapshot.Existing<C>>,
): QuerySnapshot.QuerySnapshot<C> => {
  const self = Object.assign(Object.create(QuerySnapshotProto) as typeof QuerySnapshotProto, {
    docs,
  });
  return self as unknown as QuerySnapshot.QuerySnapshot<C>;
};
