import { Option } from "effect";
import type * as Collection from "../Collection.ts";
import * as collection_ from "./collection.ts";
import * as FirestoreModel from "../FirestoreModel.ts";

/**
 * The model behind the collections an untyped reference is placed in. A
 * reference Firestore hands back names its path but not the collection it was
 * defined through, so it is placed in one that claims nothing about its
 * documents.
 */
class Untyped extends FirestoreModel.Class<Untyped>("Untyped")({}) {}

/**
 * The collections untyped references are placed in, one per path of collection
 * ids. A reference compares by its collection as well as its path, so reusing
 * them is what makes two references to the same document equal.
 */
const collections = new Map<string, Collection.Any>();

const collectionOf = (segments: ReadonlyArray<string>): Collection.Any => {
  const key = segments.join("/");
  let collection = collections.get(key);
  if (collection === undefined) {
    collection =
      segments.length === 1
        ? collection_.make(segments[0], Untyped)
        : collectionOf(segments.slice(0, -1)).subcollection(segments[segments.length - 1], Untyped);
    collections.set(key, collection);
  }
  return collection;
};

/** @internal */
export const fromPathUntyped = (
  path: string,
): Option.Option<Collection.DocumentReference<Collection.Any>> => {
  const parts = path.split("/");
  if (parts.length % 2 !== 0 || parts.some((part) => part.length === 0)) return Option.none();
  const segments = parts.filter((_, i) => i % 2 === 0);
  try {
    return collection_.fromPath(collectionOf(segments), path);
  } catch {
    // A segment Firestore cannot address, which no reference it hands back holds.
    return Option.none();
  }
};
