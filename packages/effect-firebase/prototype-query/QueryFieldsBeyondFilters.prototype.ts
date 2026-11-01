/**
 * PROTOTYPE - throwaway, never merged. Wayfinder ticket "Field objects beyond
 * filters" (#125) on map "Queries in Firestore" (#117).
 *
 * Question: beyond `where`, is a field object (`Query.fields(UserPosts).likes`)
 * a better shared handle than a dotted path literal (`"likes"`)? Both styles,
 * side by side, for:
 *   1 - `orderBy`, then a cursor whose values are typed by those orders
 *   2 - an aggregation spec with named aggregates; `sum`/`average` numeric only
 *   3 - a document id filter and order, with full paths on a group
 *
 * D - dotted paths, the #120/#121 shape: the path is checked against the source
 *     the combinator infers from the pipe.
 * F - field objects, the nominal shape of QueryCollectionFields.prototype.ts:
 *     `fieldsOf(definition)`, filters and orders owned by their collections.
 *
 * How cursors and aggregations really work is "Cursors" (#123) and "How
 * aggregations are asked for" (#124); the shapes here only carry the naming.
 * Every API is a `declare` stub; only the types are real.
 *
 * Type-check: `vp check prototype-query`  (from packages/effect-firebase)
 *
 * Findings (everything below type-checks, every refusal is a real error):
 * - Cursors don't depend on the style. Each `orderBy` pushes its field's Type
 *   onto the query (`Query<S, [number, string, Date]>`), and `startAfter` reads
 *   only that. D1 and F1 infer the same type and give the same error
 *   (`'["1000"]' is not assignable to 'readonly [number]'`). Cursors are
 *   positional either way: a field object can't be an object key.
 * - Aggregates are where field objects win. `sum(g.likes)` is checked where
 *   it's written, so a spec is a plain value that can be reused on the group
 *   and on a member (F2). A bare `sum("likes")` has no source to check
 *   against, so D needs a callback that hands out the source's builders (D2).
 *   That's the same problem as `Query.or<typeof AllPosts>` in #120. Both styles
 *   refuse `sum` on a string or a bigint. D's error names the path, and F's
 *   names the Type (`Field<..., string>` to `never`).
 * - Document ids are where dotted paths win. D has one reserved name,
 *   `D.documentId`, a symbol no model key can collide with, and its value
 *   follows the piped source: a plain id on a collection, a reference on a
 *   group. F can't put the document id on `fields`, because a model may store
 *   its own `id` (Comment), so it needs `documentId(definition)`, which
 *   repeats the definition. Owners are contravariant, so a group's
 *   document-id field also fits a member collection (F3d). Its value is then
 *   the group's reference, where the collection wants an id.
 * - Nominal mismatches in F still error as long function-assignability
 *   messages at the pipe step (Comments' document id on posts).
 */
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import type * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import { pipe, Schema } from "effect";
import type { DateTime, Effect } from "effect";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  likes: Schema.Finite,
  views: Schema.BigInt, // stored as a string: not orderable, not summable
  tags: Schema.Array(Schema.String),
  publishedAt: FirestoreModel.Timestamp(Schema.Date),
  address: Schema.Struct({ city: Schema.String, rating: Schema.Finite }),
}) {}
/** Imported data that stores its own `id` field, unrelated to the document id. */
class Comment extends FirestoreModel.Class<Comment>("Comment")({
  id: Schema.String,
  body: Schema.String,
  likes: Schema.Finite,
}) {}

const Users = Collection.make("users", User);
const UserPosts = Users.subcollection("posts", Post);
const Orgs = Collection.make("orgs", User);
const OrgPosts = Orgs.subcollection("posts", Post);
const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);
const Comments = Collection.make("comments", Comment);

declare const alice: Collection.Id<typeof Users>;
declare const lastSeen: Date;

// ---------------------------------------------------------------------------
// Shared: sources, the document shape, and a query that remembers its orders
// ---------------------------------------------------------------------------

type Source = Collection.CollectionReference<any> | CollectionGroup.Any;
type CollectionsOf<S> =
  S extends Collection.CollectionReference<infer C>
    ? C
    : S extends CollectionGroup.Any
      ? CollectionGroup.Members<S>
      : never;
/** A group's document: the keys every member holds (Shared Field, simplified). */
type Doc<S> = CommonShape<Collection.DocumentSchema<CollectionsOf<S>>["Type"]>;
type CommonShape<D> = {
  [K in CommonKeys<D>]: D extends unknown ? D[K & keyof D] : never;
};
type CommonKeys<D> = (D extends unknown ? (x: keyof D) => void : never) extends (x: infer K) => void
  ? K & string
  : never;

type Leaf =
  | string
  | number
  | boolean
  | bigint
  | null
  | Date
  | Timestamp.Timestamp
  | DateTime.DateTime
  | ReadonlyArray<unknown>;

/** #121's ordering gate, from Type alone; a document id (plain or reference) sorts too. */
type Orderable =
  | string
  | number
  | boolean
  | Date
  | Timestamp.Timestamp
  | DateTime.Utc
  | Collection.DocumentReference<any>;
type Numeric = number;

/**
 * The value a document id is given as. On a collection a plain id; on a group
 * Firestore needs the full path, which only a reference carries (#118).
 */
type DocumentIdValue<S> = S extends CollectionGroup.Any
  ? CollectionGroup.DocumentReference<S>
  : Collection.Id<CollectionsOf<S>>;

/** `O` is the Type of each `orderBy`, in order: what a cursor must give. */
interface Query<S extends Source, O extends ReadonlyArray<unknown> = readonly []> {
  readonly source: S;
  readonly "~orders": O;
}
/** A cursor gives a value for the first one or more orders. */
type CursorValues<O extends ReadonlyArray<unknown>> = O extends readonly [...infer I, unknown]
  ? O | CursorValues<I>
  : never;

/** Cursors and reads are the same in D and F: they only see the query. */
declare const startAfter: <S extends Source, O extends ReadonlyArray<unknown>>(
  ...values: CursorValues<NoInfer<O>>
) => (self: Query<S, O>) => Query<S, O>;

type AggResult<Spec> = {
  readonly [K in keyof Spec]: Spec[K] extends { readonly _tag: "average" } ? number | null : number;
};
// ===========================================================================
// D - dotted paths
// ===========================================================================

namespace D {
  type Paths<T, Prefix extends string = ""> = {
    [K in keyof T & string]-?: [NonNullable<T[K]>] extends [Leaf]
      ? `${Prefix}${K}`
      : `${Prefix}${K}` | Paths<NonNullable<T[K]>, `${Prefix}${K}.`>;
  }[keyof T & string];
  export type ValueAt<T, P> = P extends `${infer H}.${infer R}`
    ? H extends keyof T
      ? ValueAt<NonNullable<T[H]>, R>
      : never
    : P extends keyof T
      ? T[P]
      : never;
  type PathsWhere<T, V> = {
    [P in Paths<T>]: [Exclude<ValueAt<T, P>, undefined | null>] extends [V] ? P : never;
  }[Paths<T>];

  /** The document id, a reserved name that no model field can take. */
  export declare const documentId: unique symbol;
  export type DocumentId = typeof documentId;
  type ValueOf<S, P> = P extends DocumentId ? DocumentIdValue<S> : ValueAt<Doc<S>, P>;

  export declare const where: <S extends Source, P extends Paths<Doc<S>> | DocumentId>(
    path: P,
    op: "==" | ">=" | "<",
    value: NoInfer<ValueOf<S, P>>,
  ) => <O extends ReadonlyArray<unknown> = readonly []>(self: S | Query<S, O>) => Query<S, O>;

  export declare const orderBy: <
    S extends Source,
    P extends PathsWhere<Doc<S>, Orderable> | DocumentId,
  >(
    path: P,
    direction?: "asc" | "desc",
  ) => <O extends ReadonlyArray<unknown> = readonly []>(
    self: S | Query<S, O>,
  ) => Query<S, readonly [...O, ValueOf<S, P>]>;

  // Aggregates. A bare `sum("likes")` has no source to check against, so the
  // spec is built in a callback that the read gives the source's builders.
  export interface Count {
    readonly _tag: "count";
  }
  export interface Sum {
    readonly _tag: "sum";
    readonly path: string;
  }
  export interface Average {
    readonly _tag: "average";
    readonly path: string;
  }
  export interface Builders<S> {
    readonly count: () => Count;
    readonly sum: (path: PathsWhere<Doc<S>, Numeric>) => Sum;
    readonly average: (path: PathsWhere<Doc<S>, Numeric>) => Average;
  }
  export declare const aggregate: <S extends Source, Spec>(
    query: S | Query<S, any>,
    spec: (a: Builders<S>) => Spec,
  ) => Effect.Effect<AggResult<Spec>>;
}

// D1 - orderBy then a typed cursor, nested path included.
const d1 = pipe(
  UserPosts.collection(alice),
  D.orderBy("likes", "desc"),
  D.orderBy("address.city"),
  D.orderBy("publishedAt"),
  startAfter(1000, "Berlin"),
);
const d1b = pipe(d1, startAfter(1000, "Berlin", lastSeen));

// D2 - aggregates through the callback: autocomplete offers numeric paths only.
const d2 = D.aggregate(AllPosts, (a) => ({
  total: a.count(),
  likes: a.sum("likes"),
  rating: a.average("address.rating"),
}));

// D3 - document id: a reserved name; its value follows the source.
declare const someAlicePost: Collection.Id<typeof UserPosts>;
declare const someGroupPost: CollectionGroup.DocumentReference<typeof AllPosts>;
const d3a = pipe(
  UserPosts.collection(alice),
  D.where(D.documentId, ">=", someAlicePost),
  D.orderBy(D.documentId),
  startAfter(someAlicePost),
);
const d3b = pipe(AllPosts, D.orderBy(D.documentId), startAfter(someGroupPost));
// The model's own `id` field and the document id never meet.
const d3c = pipe(Comments.collection(), D.where("id", "==", "legacy-7"), D.orderBy(D.documentId));

// @ts-expect-error cursor value has the wrong Type for `likes`
void pipe(UserPosts.collection(alice), D.orderBy("likes"), startAfter("1000"));
// @ts-expect-error more cursor values than orders
void pipe(UserPosts.collection(alice), D.orderBy("likes"), startAfter(1, 2));
// @ts-expect-error bigint is not orderable
void pipe(UserPosts.collection(alice), D.orderBy("views"));
// @ts-expect-error a group's document id needs a full path, not a plain id
void pipe(AllPosts, D.where(D.documentId, "==", someAlicePost));
// @ts-expect-error `sum` on a string
void D.aggregate(AllPosts, (a) => ({ x: a.sum("title") }));
// @ts-expect-error `sum` on bigint, stored as a string
void D.aggregate(AllPosts, (a) => ({ x: a.sum("views") }));

// ===========================================================================
// F - field objects (nominal: owned by the collections they come from)
// ===========================================================================

namespace F {
  declare const OwnerId: unique symbol;
  declare const TypeOf: unique symbol;
  export interface Field<O, T> {
    readonly [OwnerId]: (_: O) => void;
    readonly [TypeOf]: (_: T) => T;
  }
  type Fields<O, T> = {
    readonly [K in keyof T & string]-?: [NonNullable<T[K]>] extends [Leaf]
      ? Field<O, T[K]>
      : Field<O, T[K]> & Fields<O, NonNullable<T[K]>>;
  };
  type Owners<X> = X extends CollectionGroup.CollectionGroup<infer M> ? M : X;
  type Def = Collection.Any | CollectionGroup.Any;
  type DocOfDef<X> = X extends CollectionGroup.Any
    ? Doc<X>
    : X extends Collection.Any
      ? Doc<Collection.CollectionReference<X>>
      : never;

  export declare const fields: <X extends Def>(x: X) => Fields<Owners<X>, DocOfDef<X>>;

  /**
   * The document id is not a member of `fields`: a model may hold a field
   * named `id` (Comment does), and any key would collide with some model.
   */
  export declare const documentId: <X extends Def>(
    x: X,
  ) => Field<
    Owners<X>,
    X extends CollectionGroup.Any
      ? DocumentIdValue<X>
      : DocumentIdValue<Collection.CollectionReference<Extract<X, Collection.Any>>>
  >;

  interface Filter<O> {
    readonly "~owner": (_: O) => void;
  }
  interface Order<O, T> {
    readonly "~owner": (_: O) => void;
    readonly "~type": T;
  }
  type Ordered<T> = [Exclude<T, undefined | null>] extends [Orderable] ? unknown : never;
  type IsNumeric<T> = [Exclude<T, undefined | null>] extends [Numeric] ? unknown : never;

  export declare const eq: <O, T>(f: Field<O, T>, v: NoInfer<T>) => Filter<O>;
  export declare const gte: <O, T>(f: Field<O, T> & Ordered<T>, v: NoInfer<T>) => Filter<O>;
  export declare const asc: <O, T>(f: Field<O, T> & Ordered<T>) => Order<O, T>;
  export declare const desc: <O, T>(f: Field<O, T> & Ordered<T>) => Order<O, T>;

  /** A source takes what is owned by every collection it reads. */
  export declare const where: <F extends Filter<any>>(
    filter: F,
  ) => <S extends Source, O extends ReadonlyArray<unknown> = readonly []>(
    self: (S | Query<S, O>) & ([F] extends [Filter<CollectionsOf<S>>] ? unknown : never),
  ) => Query<S, O>;
  export declare const orderBy: <R extends Order<any, any>>(
    order: R,
  ) => <S extends Source, O extends ReadonlyArray<unknown> = readonly []>(
    self: (S | Query<S, O>) & ([R] extends [Order<CollectionsOf<S>, any>] ? unknown : never),
  ) => Query<S, readonly [...O, R["~type"]]>;

  // Aggregates are plain values: the field carries its Type and owner, so
  // `sum(p.likes)` is checked where it is written, with no callback.
  export interface Count {
    readonly _tag: "count";
    readonly "~owner": (_: unknown) => void;
  }
  export interface Sum<O> {
    readonly _tag: "sum";
    readonly "~owner": (_: O) => void;
  }
  export interface Average<O> {
    readonly _tag: "average";
    readonly "~owner": (_: O) => void;
  }
  export declare const count: () => Count;
  export declare const sum: <O, T>(f: Field<O, T> & IsNumeric<T>) => Sum<O>;
  export declare const average: <O, T>(f: Field<O, T> & IsNumeric<T>) => Average<O>;
  type Owned<S> = { readonly "~owner": (_: CollectionsOf<S>) => void };
  export declare const aggregate: <S extends Source, Spec extends Record<string, Owned<S>>>(
    query: S | Query<S, any>,
    spec: Spec,
  ) => Effect.Effect<AggResult<Spec>>;
}

const p = F.fields(UserPosts);
const g = F.fields(AllPosts);

// F1 - orderBy then a typed cursor; identical cursor, the orders carry the Type.
const f1 = pipe(
  UserPosts.collection(alice),
  F.orderBy(F.desc(p.likes)),
  F.orderBy(F.asc(p.address.city)),
  F.orderBy(F.asc(p.publishedAt)),
  startAfter(1000, "Berlin"),
);
const f1b = pipe(f1, startAfter(1000, "Berlin", lastSeen));

// F2 - aggregates as a plain spec; reusable, no callback.
const popularity = { total: F.count(), likes: F.sum(g.likes), rating: F.average(g.address.rating) };
const f2a = F.aggregate(AllPosts, popularity);
const f2b = F.aggregate(UserPosts.collection(alice), popularity);

// F3 - document id: its own function per definition, value follows the source.
const f3a = pipe(
  UserPosts.collection(alice),
  F.where(F.gte(F.documentId(UserPosts), someAlicePost)),
  F.orderBy(F.asc(F.documentId(UserPosts))),
  startAfter(someAlicePost),
);
const f3b = pipe(AllPosts, F.orderBy(F.asc(F.documentId(AllPosts))), startAfter(someGroupPost));
const c = F.fields(Comments);
const f3c = pipe(
  Comments.collection(),
  F.where(F.eq(c.id, "legacy-7")),
  F.orderBy(F.asc(F.documentId(Comments))),
);
// A group's document id field fits a member (owners are contravariant), but
// its value is the group's: a reference, where the collection wants an id.
const f3d = pipe(
  UserPosts.collection(alice),
  F.orderBy(F.asc(F.documentId(AllPosts))),
  startAfter(someGroupPost),
);

// @ts-expect-error cursor value has the wrong Type for `likes`
void pipe(UserPosts.collection(alice), F.orderBy(F.asc(p.likes)), startAfter("1000"));
// @ts-expect-error bigint is not orderable
void F.asc(p.views);
// @ts-expect-error a group's document id needs a full path, not a plain id
void F.gte(F.documentId(AllPosts), someAlicePost);
// @ts-expect-error `sum` on a string
void F.sum(p.title);
// @ts-expect-error `sum` on bigint, stored as a string
void F.sum(p.views);
// @ts-expect-error nominal: a member's aggregate on its group
void F.aggregate(AllPosts, { likes: F.sum(p.likes) });
// @ts-expect-error nominal: Comments' document id on posts
void pipe(UserPosts.collection(alice), F.orderBy(F.asc(F.documentId(Comments))));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

type Same<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const assert = <_T extends true>() => {};
type PostsRef = Collection.CollectionReference<typeof UserPosts>;
type Orders = readonly [number, string, Date];
assert<Same<typeof d1, Query<PostsRef, Orders>>>();
assert<Same<typeof f1, Query<PostsRef, Orders>>>();
assert<Same<typeof d1b, typeof f1b>>();
type Agg = Effect.Effect<{
  readonly total: number;
  readonly likes: number;
  readonly rating: number | null;
}>;
assert<Same<typeof d2, Agg>>();
assert<Same<typeof f2a, Agg>>();
assert<Same<typeof d3a, Query<PostsRef, readonly [Collection.Id<typeof UserPosts>]>>>();
assert<Same<typeof f3a, typeof d3a>>();
assert<
  Same<
    typeof d3b,
    Query<typeof AllPosts, readonly [CollectionGroup.DocumentReference<typeof AllPosts>]>
  >
>();
assert<Same<typeof f3b, typeof d3b>>();
void [d3c, f3c, f3d, f2b];
