import { Inspectable, Option, Predicate, Result } from "effect";
import type * as Collection from "../Collection.ts";
import type * as CollectionGroup from "../CollectionGroup.ts";
import { UndefinedCollectionError } from "../Firestore.ts";
import * as collection from "./collection.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/firestore/CollectionGroup";

/** @internal */
export const isCollectionGroup = (u: unknown): u is CollectionGroup.Any =>
  Predicate.hasProperty(u, TypeId);

/**
 * Where `member`'s collections sit, with `{id}` standing in for each ancestor
 * id: `users/{id}/posts`.
 */
const memberPattern = (member: Collection.Any): string =>
  collection.pattern(member).slice(0, -"/{id}".length);

const CollectionGroupProto = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  toJSON(this: CollectionGroup.Any) {
    return { _id: "CollectionGroup", members: this.members.map(memberPattern) };
  },
};

/**
 * Rejects the groups that would not mean one thing: one with nothing in it,
 * one whose collections Firestore could not read under one collection id, and
 * one with two collections at the same path, which no document could be told
 * apart between.
 */
const validate = (members: ReadonlyArray<Collection.Any>): void => {
  const reject = (reason: string): never => {
    throw new Error(`Invalid collection group: ${reason}`);
  };
  if (members.length === 0) reject("it must hold at least one collection");
  const [first] = members;
  const seen = new Set<string>();
  for (const member of members) {
    if (member.segment !== first.segment) {
      reject(
        `"${memberPattern(first)}" and "${memberPattern(member)}" do not share their collection id`,
      );
    }
    const pattern = memberPattern(member);
    if (seen.has(pattern)) reject(`it has more than one member at "${pattern}"`);
    seen.add(pattern);
  }
};

/** @internal */
export const make = <const Members extends readonly [Collection.Any, ...Array<Collection.Any>]>(
  ...valid: CollectionGroup.Valid<Members>
): CollectionGroup.CollectionGroup<Members[number]> => {
  // The type checker has refused anything that is not one of `Members`, but
  // a caller that got past it is checked again here.
  const members = valid as ReadonlyArray<unknown> as Members;
  validate(members);
  return Object.assign(Object.create(CollectionGroupProto) as typeof CollectionGroupProto, {
    members,
    id: members[0].segment as string,
  }) as CollectionGroup.CollectionGroup<Members[number]>;
};

/** @internal */
export const documentAt = <G extends CollectionGroup.Any>(
  group: G,
  path: string,
): Result.Result<CollectionGroup.DocumentReference<G>, UndefinedCollectionError> => {
  // The members are read as `Collection.Any`, so the reference found in one is
  // typed back by the member it was found in.
  for (const member of group.members) {
    const ref = collection.fromPath(member, path);
    if (Option.isSome(ref))
      return Result.succeed(ref.value as CollectionGroup.DocumentReference<G>);
  }
  return Result.fail(new UndefinedCollectionError({ path, collectionId: group.id }));
};
