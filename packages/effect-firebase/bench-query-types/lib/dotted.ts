/**
 * THROWAWAY (#126). Dotted path literals, as "Filter values and field typing"
 * (#121) decided: a flattened map from every path the source offers to its
 * shape, a sibling of `UpdatePaths`. `keyof` the map is what the editor
 * offers and what `where` checks.
 *
 * Shared Field: a path is offered where every shape holding it holds it the
 * same way. Structs that differ still offer the paths inside that agree.
 */
import type {
  AnyKey,
  Down,
  IsLeaf,
  IsRecord,
  IsUnion,
  Op,
  OpsFor,
  Query,
  QueryLike,
  Shape,
  Shapes,
  Source,
  UnionToIntersection,
  ValueAt,
  ValueFor,
} from "./common.ts";

/** A path's entry: the shapes it reads and its value type. */
interface Entry<Sh, V> {
  readonly shape: Sh;
  readonly value: V;
}

type Level<Sh, P extends string> = UnionToIntersection<
  {
    [K in AnyKey<Sh>]-?: At<
      Down<Sh, K>,
      ValueAt<Sh, K>,
      IsRecord<Sh> extends true ? `${P}${string}` : `${P}${K}`,
      IsRecord<Sh>
    >;
  }[AnyKey<Sh>]
>;
// A Record entry that is itself a struct gets no key of its own: `rec.${string}`
// would overlap `rec.${string}.x`, and the map would intersect their entries.
type At<Sh, V, P extends string, InRecord> = (IsUnion<Sh> extends true
  ? {}
  : [InRecord, IsLeaf<Sh>] extends [true, false]
    ? {}
    : { readonly [_ in P]: Entry<Sh, V> }) &
  ([IsLeaf<Sh>] extends [false] ? Level<Sh, `${P}.`> : {});

/** Every path a source offers. */
export type PathMap<S> = Level<Shapes<S>, ""> extends infer M ? { [K in keyof M]: M[K] } : never;

export declare const where: <
  S extends Source,
  const P extends keyof PathMap<S> & string,
  const O extends PathOps<S, P>,
>(
  path: P,
  op: O,
  value: ValueFor<O, PathMap<S>[P] extends Entry<any, infer V> ? V : never>,
) => (self: QueryLike<S>) => Query<S>;

type PathOps<S, P extends keyof PathMap<S>> =
  PathMap<S>[P] extends Entry<infer Sh, any> ? OpsFor<Sh> & Op : never;

export declare const orderBy: <S extends Source, const P extends OrderPaths<S>>(
  path: P,
  direction?: "asc" | "desc",
) => (self: QueryLike<S>) => Query<S>;

type OrderPaths<S> = {
  [P in keyof PathMap<S>]: PathMap<S>[P] extends Entry<infer Sh, any>
    ? "<" extends OpsFor<Sh>
      ? P
      : never
    : never;
}[keyof PathMap<S>] &
  string;

export type { Shape };
