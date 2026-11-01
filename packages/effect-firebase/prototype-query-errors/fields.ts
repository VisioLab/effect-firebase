/**
 * THROWAWAY, copied from the #126 bench. Field objects, as the field-object prototypes on
 * `prototype-query-drizzle` build them: `Query.fields(definition)` returns a
 * mapped type whose properties are resolved only when accessed, so a path is
 * worked out one level per property access. Filters are owned by the
 * definition their fields came from (nominal), as in
 * QueryCollectionFields.prototype.ts.
 *
 * Same Shared Field rule as `dotted.ts`, applied per level.
 */
import type {
  AnyKey,
  CollectionsOf,
  Definition,
  Down,
  ElemOf,
  Equatable,
  IsArray,
  IsLeaf,
  IsUnion,
  Orderable,
  Query,
  QueryLike,
  Shapes,
  Source,
  ValueAt,
} from "./common.ts";

declare const FieldId: unique symbol;
export interface Field<O, Sh, V> {
  readonly [FieldId]: {
    readonly owner: (_: O) => void;
    readonly shape: Sh;
    readonly value: (_: V) => V;
  };
}

type Level<O, Sh> = {
  readonly [K in AnyKey<Sh> as Offered<Down<Sh, K>> extends true ? K : never]-?: At<
    O,
    Down<Sh, K>,
    ValueAt<Sh, K>
  >;
};
/** A struct path stays reachable where its shapes differ; a leaf only where they agree. */
type Offered<Sh> = IsUnion<Sh> extends false ? true : [IsLeaf<Sh>] extends [false] ? true : false;
type At<O, Sh, V> = (IsUnion<Sh> extends true ? {} : Field<O, Sh, V>) &
  ([IsLeaf<Sh>] extends [false] ? Level<O, Sh> : {});

export declare const fields: <D extends Definition>(definition: D) => Level<D, Shapes<D>>;

export interface Filter<O> {
  readonly "~owner": (_: O) => void;
}
type Gate<Ok, F> = Ok extends true ? F : never;

export declare const eq: <O, Sh, V>(
  f: Gate<Equatable<Sh>, Field<O, Sh, V>>,
  v: NoInfer<Exclude<V, undefined>>,
) => Filter<O>;
export declare const ne: <O, Sh, V>(
  f: Gate<Equatable<Sh>, Field<O, Sh, V>>,
  v: NoInfer<Exclude<V, undefined>>,
) => Filter<O>;
export declare const inArray: <O, Sh, V>(
  f: Gate<Equatable<Sh>, Field<O, Sh, V>>,
  vs: ReadonlyArray<NoInfer<Exclude<V, undefined>>>,
) => Filter<O>;
export declare const gt: <O, Sh, V>(
  f: Gate<Orderable<Sh>, Field<O, Sh, V>>,
  v: NoInfer<Exclude<V, undefined>>,
) => Filter<O>;
export declare const gte: <O, Sh, V>(
  f: Gate<Orderable<Sh>, Field<O, Sh, V>>,
  v: NoInfer<Exclude<V, undefined>>,
) => Filter<O>;
export declare const lt: <O, Sh, V>(
  f: Gate<Orderable<Sh>, Field<O, Sh, V>>,
  v: NoInfer<Exclude<V, undefined>>,
) => Filter<O>;
export declare const arrayContains: <O, Sh, V>(
  f: Gate<IsArray<Sh>, Field<O, Sh, V>>,
  v: NoInfer<ElemOf<V>>,
) => Filter<O>;

export declare const and: <O>(...filters: ReadonlyArray<Filter<O>>) => Filter<O>;
export declare const or: <O>(...filters: ReadonlyArray<Filter<O>>) => Filter<O>;

/** A source takes a filter when every collection it reads is one the filter's owner reads. */
type Owned<S, O> = [CollectionsOf<S>] extends [CollectionsOf<O>]
  ? unknown
  : { readonly "~not owned by": O };

export declare const where: <O>(
  filter: Filter<O>,
) => <S extends Source>(self: QueryLike<S> & Owned<S, O>) => Query<S>;

export interface Order<O> {
  readonly "~owner": (_: O) => void;
}
export declare const desc: <O, Sh, V>(f: Gate<Orderable<Sh>, Field<O, Sh, V>>) => Order<O>;
export declare const orderBy: <O>(
  order: Order<O>,
) => <S extends Source>(self: QueryLike<S> & Owned<S, O>) => Query<S>;
