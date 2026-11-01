/**
 * THROWAWAY - wayfinder task "Type-check cost of dotted paths and field
 * objects" (#126) on map "Queries in Firestore" (#117). Never merged.
 *
 * What both styles share: how a source turns into the document shapes it
 * reads, and the per-field gates from "Filter values and field typing" (#121),
 * decided from the field's Type and Encoded side.
 */
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import type * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import type * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import type { DateTime } from "effect";

export type Source = Collection.CollectionReference<any> | CollectionGroup.Any;
/** A collection definition or a group, which field objects are built from. */
export type Definition = Collection.Any | CollectionGroup.Any;

export type CollectionsOf<S> =
  S extends Collection.CollectionReference<infer C>
    ? C
    : S extends CollectionGroup.Any
      ? CollectionGroup.Members<S>
      : S extends Collection.Any
        ? S
        : never;

type SchemaOf<C> = C extends Collection.Any ? Collection.DocumentSchema<C> : never;
type MembersOf<S> = S extends FirestoreModel.Union<any> ? S["read"]["members"][number] : S;

/** One document shape, both sides. */
export interface Shape<T, E> {
  readonly T: T;
  readonly E: E;
}
/** The document shapes a source reads: one per collection, one per union member. */
export type Shapes<S> =
  MembersOf<SchemaOf<CollectionsOf<S>>> extends infer M
    ? M extends { readonly Type: infer T; readonly Encoded: infer E }
      ? Shape<T, E>
      : never
    : never;

export type Leaf =
  | string
  | number
  | boolean
  | bigint
  | null
  | Date
  | Timestamp.Timestamp
  | DateTime.DateTime
  | ReadonlyArray<unknown>
  | ReadonlySet<unknown>
  | ReadonlyMap<unknown, unknown>;

export type IsUnion<U> = [U] extends [UnionToIntersection<U>] ? false : true;
export type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (
  i: infer I,
) => void
  ? I
  : never;

/** The keys any shape holds. */
export type AnyKey<Sh> = Sh extends Shape<infer T, any> ? keyof T & string : never;
/** The shapes one level down, from every shape that holds `K`. */
export type Down<Sh, K extends string> =
  Sh extends Shape<infer T, infer E>
    ? K extends keyof T
      ? Shape<NonNullable<T[K]>, NonNullable<E[K & keyof E]>>
      : string extends keyof T
        ? Shape<NonNullable<T[string & keyof T]>, NonNullable<E[string & keyof E]>>
        : never
    : never;
/** The value type a field takes: what its holders accept, including `undefined` from optional keys. */
export type ValueAt<Sh, K extends string> =
  Sh extends Shape<infer T, any> ? (K extends keyof T ? T[K] : T[string & keyof T]) : never;

export type IsLeaf<Sh> =
  Sh extends Shape<infer T, any> ? ([T] extends [Leaf] ? true : false) : never;
export type IsRecord<Sh> =
  Sh extends Shape<infer T, any> ? (string extends keyof T ? true : false) : never;

/** Ordering sorts like the model: same primitive both sides, dates stored as timestamps, booleans. */
export type Orderable<Sh> =
  Sh extends Shape<infer T, infer E>
    ? [T] extends [number]
      ? [E] extends [number]
        ? true
        : false
      : [T] extends [string]
        ? [E] extends [string]
          ? true
          : false
        : [T] extends [boolean]
          ? true
          : [T] extends [Date | DateTime.Utc | Timestamp.Timestamp]
            ? [E] extends [Date | DateTime.Utc | Timestamp.Timestamp]
              ? true
              : false
            : false
    : false;
export type IsArray<Sh> =
  Sh extends Shape<infer T, any> ? ([T] extends [ReadonlyArray<unknown>] ? true : false) : false;
export type Equatable<Sh> =
  Sh extends Shape<infer T, any>
    ? [T] extends [ReadonlySet<unknown> | ReadonlyMap<unknown, unknown>]
      ? false
      : true
    : false;
export type ElemOf<T> = T extends ReadonlyArray<infer E> ? E : never;

export type Op =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not-in"
  | "array-contains"
  | "array-contains-any";

/** Which operators a field takes, by kind (#121). */
export type OpsFor<Sh> =
  | (Equatable<Sh> extends true ? "==" | "!=" | "in" | "not-in" : never)
  | (Orderable<Sh> extends true ? "<" | "<=" | ">" | ">=" : never)
  | (IsArray<Sh> extends true ? "array-contains" | "array-contains-any" : never);

/** The value an operator takes on a field of value type `T`. */
export type ValueFor<O extends Op, T> = O extends "in" | "not-in"
  ? ReadonlyArray<Exclude<T, undefined>>
  : O extends "array-contains"
    ? ElemOf<T>
    : O extends "array-contains-any"
      ? ReadonlyArray<ElemOf<T>>
      : Exclude<T, undefined>;

export interface Query<S extends Source> {
  readonly "~source": S;
}
export type QueryLike<S extends Source> = S | Query<S>;
