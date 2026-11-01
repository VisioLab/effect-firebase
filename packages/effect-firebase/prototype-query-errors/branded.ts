/**
 * PROTOTYPE - throwaway, never merged (#127). Field objects, changed for
 * readable errors. Typing otherwise as in `fields.ts` (the #126 bench).
 *
 * Three changes, each aimed at one refused case:
 * - The owner is the collection's name, `"users/{id}/posts"`, not its
 *   `Collection<readonly [...]>` type. A group owns the union of its members'
 *   names. Contravariance works the same, so the nominal check is unchanged.
 * - A field carries its path and a short kind label (`"bigint stored as a
 *   string"`), not its Type/Encoded shape. The operator gates read the label.
 * - Refusals are a property the argument lacks, `"~refused": "<why>"`, never
 *   `never`. TypeScript ends the error with that line.
 *
 * The top-level fields type is a named alias, `Fields<Name, Schema>`, so a
 * missing field reads `Property 'nope' does not exist on type
 * 'Fields<"users/{id}/posts", typeof Post>'`.
 */
import type * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import type * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import type {
  AnyKey,
  CollectionsOf,
  Definition,
  Down,
  ElemOf,
  IsArray,
  IsLeaf,
  IsUnion,
  Orderable,
  Query,
  QueryLike,
  Shape,
  Source,
  ValueAt,
} from "./common.ts";

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

type Segments<L> = L extends readonly [readonly [infer S extends string, any]]
  ? S
  : L extends readonly [readonly [infer S extends string, any], ...infer R]
    ? `${S}/{id}/${Segments<R>}`
    : never;
/** `"users/{id}/posts"`; a union over a group's members. */
export type NameOf<D> = CollectionsOf<D> extends infer C
  ? C extends Collection.Collection<infer L>
    ? Segments<L>
    : never
  : never;
type SchemaOf<D> = CollectionsOf<D> extends infer C
  ? C extends Collection.Any
    ? Collection.DocumentSchema<C>
    : never
  : never;

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

type Describe<T> = [T] extends [bigint]
  ? "bigint"
  : [T] extends [number]
    ? "number"
    : [T] extends [string]
      ? "string"
      : [T] extends [boolean]
        ? "boolean"
        : "value";
/** What a field is, as far as the operators care. */
type KindOf<Sh> =
  Sh extends Shape<infer T, infer E>
    ? IsArray<Sh> extends true
      ? "array"
      : [T] extends [ReadonlySet<unknown>]
        ? "set"
        : [T] extends [ReadonlyMap<unknown, unknown>]
          ? "map"
          : Orderable<Sh> extends true
            ? Describe<T> extends "value"
              ? "timestamp"
              : Describe<T>
            : [IsLeaf<Sh>] extends [false]
              ? "struct"
              : [T] extends [bigint]
                ? "bigint, stored as a string"
                : `${Describe<T>}, stored as a ${Describe<E>}`
    : never;
type Ordered = "number" | "string" | "boolean" | "timestamp";
type Equatable = Ordered | "array" | "struct" | `${string}, stored as a ${string}`;

declare const FieldId: unique symbol;
export interface Field<Owner extends string, Path extends string, V, Kind extends string> {
  readonly [FieldId]: {
    readonly owner: (_: Owner) => void;
    readonly path: Path;
    readonly value: (_: V) => V;
    readonly kind: Kind;
  };
}

type Level<O extends string, Sh, P extends string> = {
  readonly [K in AnyKey<Sh> as Offered<Down<Sh, K>> extends true ? K : never]-?: At<
    O,
    Down<Sh, K>,
    ValueAt<Sh, K>,
    `${P}${K}`
  >;
};
type Offered<Sh> = IsUnion<Sh> extends false ? true : [IsLeaf<Sh>] extends [false] ? true : false;
type At<O extends string, Sh, V, P extends string> = (IsUnion<Sh> extends true
  ? {}
  : Field<O, P, V, KindOf<Sh>>) &
  ([IsLeaf<Sh>] extends [false] ? Level<O, Sh, `${P}.`> : {});

type MembersOf<S> = S extends FirestoreModel.Union<any> ? S["read"]["members"][number] : S;
type ShapesOf<Schema> =
  MembersOf<Schema> extends infer M
    ? M extends { readonly Type: infer T; readonly Encoded: infer E }
      ? Shape<T, E>
      : never
    : never;
/** A source's fields, named so errors print the collection and its model. */
export type Fields<Name extends string, Schema> = {
  readonly [K in AnyKey<ShapesOf<Schema>> as Offered<Down<ShapesOf<Schema>, K>> extends true
    ? K
    : never]-?: At<Name, Down<ShapesOf<Schema>, K>, ValueAt<ShapesOf<Schema>, K>, K>;
};

export declare const fields: <D extends Definition>(definition: D) => Fields<NameOf<D>, SchemaOf<D>>;

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export interface Filter<O extends string> {
  readonly "~owner": (_: O) => void;
}
/** Passes, or demands a property whose value says why not. */
type Takes<K extends string, Allowed, Why extends string> = [K] extends [Allowed]
  ? unknown
  : { readonly "~refused": Why };

export declare const eq: <O extends string, P extends string, V, K extends string>(
  f: Field<O, P, V, K> & Takes<K, Equatable, `\`${P}\` is a ${K}, which has no equality`>,
  v: NoInfer<Exclude<V, undefined>>,
) => Filter<O>;
export declare const gt: <O extends string, P extends string, V, K extends string>(
  f: Field<O, P, V, K> &
    Takes<K, Ordered, `\`${P}\` is a ${K}, which doesn't sort like the model`>,
  v: NoInfer<Exclude<V, undefined>>,
) => Filter<O>;
export declare const arrayContains: <O extends string, P extends string, V, K extends string>(
  f: Field<O, P, V, K> & Takes<K, "array", `\`${P}\` is a ${K}, not an array`>,
  v: NoInfer<ElemOf<V>>,
) => Filter<O>;

/** Overload layout: the refusal as a last overload, instead of in the parameter. */
export declare const gtOverloaded: {
  <O extends string, P extends string, V, K extends Ordered>(
    f: Field<O, P, V, K>,
    v: NoInfer<Exclude<V, undefined>>,
  ): Filter<O>;
  <P extends string, K extends string>(
    f: Field<string, P, unknown, K>,
    v: unknown,
    refused: `\`${P}\` is a ${K}, which doesn't sort like the model`,
  ): never;
};

export declare const and: <O extends string>(...filters: ReadonlyArray<Filter<O>>) => Filter<O>;
export declare const or: <O extends string>(...filters: ReadonlyArray<Filter<O>>) => Filter<O>;

// ---------------------------------------------------------------------------
// Pipe steps
// ---------------------------------------------------------------------------

type Owned<S, O extends string> = [NameOf<S>] extends [O]
  ? unknown
  : { readonly "~refused": `the filter is for ${O}, not ${Exclude<NameOf<S>, O>}` };

export declare const where: <O extends string>(
  filter: Filter<O>,
) => <S extends Source>(self: QueryLike<S> & Owned<S, O>) => Query<S>;

export interface Order<O extends string> {
  readonly "~owner": (_: O) => void;
}
export declare const desc: <O extends string, P extends string, V, K extends string>(
  f: Field<O, P, V, K> &
    Takes<K, Ordered, `\`${P}\` is a ${K}, which doesn't sort like the model`>,
) => Order<O>;
export declare const orderBy: <O extends string>(
  order: Order<O>,
) => <S extends Source>(self: QueryLike<S> & Owned<S, O>) => Query<S>;

// ---------------------------------------------------------------------------
// Callback form: fields and operators come from the piped source
// ---------------------------------------------------------------------------

export interface Ops {
  readonly eq: typeof eq;
  readonly gt: typeof gt;
  readonly arrayContains: typeof arrayContains;
  readonly and: typeof and;
  readonly or: typeof or;
}
export declare const whereFn: <S extends Source>(
  build: (fields: Fields<NameOf<S>, SchemaOf<S>>, ops: Ops) => Filter<NameOf<S>>,
) => (self: QueryLike<S>) => Query<S>;

export type { CollectionGroup };
