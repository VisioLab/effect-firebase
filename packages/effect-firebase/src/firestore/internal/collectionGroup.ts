import { Inspectable, Option, Predicate } from "effect";
import type * as Collection from "../Collection.ts";
import type * as CollectionGroup from "../CollectionGroup.ts";
import * as collection from "./collection.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/firestore/CollectionGroup";

/** @internal */
export const isCollectionGroup = (u: unknown): u is CollectionGroup.Any =>
  Predicate.hasProperty(u, TypeId);

interface CollectionGroupImpl {
  readonly members: ReadonlyArray<Collection.Any>;
  readonly id: string;
}

/**
 * Where `member`'s collections sit, with `{id}` standing in for each ancestor
 * id: `users/{id}/posts`.
 */
const where = (member: Collection.Any): string =>
  collection.pattern(member).slice(0, -"/{id}".length);

const CollectionGroupProto = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  toJSON(this: CollectionGroupImpl) {
    return { _id: "CollectionGroup", members: this.members.map(where) };
  },
};

/**
 * Rejects the groups that would not mean one thing: one with nothing in it,
 * one whose collections Firestore could not read under one collection id, and
 * one listing a collection twice.
 */
const validate = (members: ReadonlyArray<Collection.Any>): void => {
  const reject = (reason: string): never => {
    throw new Error(`Invalid collection group: ${reason}`);
  };
  if (members.length === 0) reject("it must hold at least one collection");
  const [first] = members;
  for (let i = 1; i < members.length; i++) {
    const member = members[i];
    if (member.segment !== first.segment) {
      reject(`"${where(first)}" and "${where(member)}" do not share their collection id`);
    }
    if (members.indexOf(member) !== i) {
      reject(`it lists "${where(member)}" more than once`);
    }
  }
};

/** @internal */
export const make = <const Members extends readonly [Collection.Any, ...Array<Collection.Any>]>(
  ...valid: CollectionGroup.Valid<Members>
): CollectionGroup.CollectionGroup<Members[number]> => {
  // The type checker has refused anything that is not one of `Members`, but
  // a caller that got past it is checked again here.
  const members = valid as unknown as Members;
  validate(members);
  const self = Object.assign(Object.create(CollectionGroupProto) as typeof CollectionGroupProto, {
    members,
    id: members[0].segment as string,
  });
  return self as unknown as CollectionGroup.CollectionGroup<Members[number]>;
};

/** @internal */
export const fromPath = <G extends CollectionGroup.Any>(
  group: G,
  path: string,
): Option.Option<CollectionGroup.DocumentReference<G>> => {
  for (const member of (group as unknown as CollectionGroupImpl).members) {
    const ref = collection.fromPath(member, path);
    if (Option.isSome(ref)) return ref as Option.Option<CollectionGroup.DocumentReference<G>>;
  }
  return Option.none();
};
