/**
 * THROWAWAY (#126). Dotted path literals, the cheaper way most path libraries
 * take: a union of path strings for the editor to offer, and a per-call walk
 * down the path for its shape, instead of one flattened map.
 *
 * Same Shared Field rule as `dotted.ts`.
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
  Shapes,
  Source,
  ValueAt,
  ValueFor,
} from "./common.ts";

type PathsOf<Sh, P extends string> = {
  [K in AnyKey<Sh>]-?: At<Down<Sh, K>, IsRecord<Sh> extends true ? `${P}${string}` : `${P}${K}`>;
}[AnyKey<Sh>];
type At<Sh, P extends string> =
  | (IsUnion<Sh> extends true ? never : P)
  | ([IsLeaf<Sh>] extends [false] ? PathsOf<Sh, `${P}.`> : never);

/** Every path a source offers. */
export type Paths<S> = PathsOf<Shapes<S>, "">;

/** The shapes at a path. */
type ShapeAt<Sh, P extends string> = P extends `${infer H}.${infer Rest}`
  ? ShapeAt<Down<Sh, H>, Rest>
  : Down<Sh, P>;
/** The value type at a path. */
type ValueOf<Sh, P extends string> = P extends `${infer H}.${infer Rest}`
  ? ValueOf<Down<Sh, H>, Rest>
  : ValueAt<Sh, P>;

export declare const where: <
  S extends Source,
  const P extends Paths<S>,
  const O extends OpsFor<ShapeAt<Shapes<S>, P>> & Op,
>(
  path: P,
  op: O,
  value: ValueFor<O, ValueOf<Shapes<S>, P>>,
) => (self: QueryLike<S>) => Query<S>;

export declare const orderBy: <S extends Source, const P extends Paths<S>>(
  path: P & ("<" extends OpsFor<ShapeAt<Shapes<S>, P>> ? unknown : never),
  direction?: "asc" | "desc",
) => (self: QueryLike<S>) => Query<S>;
