/**
 * PROTOTYPE - throwaway, never merged. Map "Queries in Firestore" (#117).
 * Follows QueryDrizzle.prototype.ts.
 *
 * Question: what if fields hang off the collection definition, as Drizzle's
 * columns hang off the table - `UserPosts.fields.likes`, `AllPosts.fields.likes`?
 *
 * Once a field knows its collection, a filter can be checked nominally, as
 * Drizzle does, instead of by the paths and Types it reads. This file tries
 * that: a filter is owned by the collections its fields came from, and a
 * source accepts it when every collection the source reads is one of them.
 *
 * `withFields` stands in for `Collection.make`/`subcollection`/
 * `CollectionGroup.make` growing a `fields` property; nothing in src changes.
 *
 * Type-check: `vp check prototype-query`  (from packages/effect-firebase)
 * Run:        `vpx prototype-query/QueryCollectionFields.prototype.ts`
 */
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import type * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import { pipe, Schema } from "effect";
import type { DateTime } from "effect";

// ---------------------------------------------------------------------------
// Fields, owned by collections
// ---------------------------------------------------------------------------

type Leaf =
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
type Orderable = string | number | boolean | Date | Timestamp.Timestamp | DateTime.Utc;

/** Metadata sits under symbols, so a struct field named `path` cannot collide. */
declare const PathId: unique symbol;
declare const OwnerId: unique symbol;
declare const TypeOf: unique symbol;
interface Field<O, T> {
  readonly [PathId]: string;
  readonly [OwnerId]: (_: O) => void; // contravariant: group fields fit a member
  readonly [TypeOf]: (_: T) => T;
}

type Fields<O, T> = {
  readonly [K in keyof T & string]-?: FieldAt<O, NonNullable<T[K]>, T[K]>;
};
type FieldAt<O, NN, T> = [NN] extends [Leaf]
  ? Field<O, T>
  : string extends keyof NN
    ? Field<O, T> & {
        readonly [k: string]: FieldAt<O, NonNullable<NN[string & keyof NN]>, NN[string & keyof NN]>;
      }
    : Field<O, T> & Fields<O, NN>;

/** A group's fields: the paths every member holds at the same Type. */
type CommonShape<D> = {
  [K in CommonKeys<D>]: D extends unknown ? D[K & keyof D] : never;
};
type CommonKeys<D> = (D extends unknown ? (x: keyof D) => void : never) extends (x: infer K) => void
  ? K & string
  : never;
type DocOf<C extends Collection.Any> = Collection.DocumentSchema<C>["Type"];

const pathKey = "~path"; // runtime stand-in for PathId
const makeFields = (path: ReadonlyArray<string> = []): any =>
  new Proxy(
    {},
    { get: (_, key) => (key === pathKey ? path.join(".") : makeFields([...path, String(key)])) },
  );
const pathOf = (f: Field<any, any>): string => (f as any)[pathKey];

/** The collection a stand-in is, without its `fields`; real `fields` needs no such step. */
type Plain<C> = C extends Collection.Any ? Collection.Collection<C["~levels"]> : never;
type WithFields<X> = X &
  (X extends Collection.Any
    ? { readonly fields: Fields<Plain<X>, DocOf<X>> }
    : X extends CollectionGroup.CollectionGroup<infer M>
      ? { readonly fields: Fields<Plain<M>, CommonShape<DocOf<M>>> }
      : never);
const withFields = <X extends Collection.Any | CollectionGroup.Any>(x: X): WithFields<X> =>
  Object.assign(x, { fields: makeFields() }) as any;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  likes: Schema.Finite,
  views: Schema.BigInt,
  tags: Schema.Array(Schema.String),
  published: Schema.Boolean,
  publishedAt: FirestoreModel.Timestamp(Schema.Date),
  address: Schema.Struct({ city: Schema.String, path: Schema.String }),
  translations: FirestoreModel.Record(Schema.String, Schema.String),
}) {}
class Comment extends FirestoreModel.Class<Comment>("Comment")({
  body: Schema.String,
  likes: Schema.Finite,
}) {}

const Users = withFields(Collection.make("users", User));
const UserPosts = withFields(Users.subcollection("posts", Post));
const Orgs = withFields(Collection.make("orgs", User));
const OrgPosts = withFields(Orgs.subcollection("posts", Post));
const AllPosts = withFields(CollectionGroup.make(UserPosts, OrgPosts));
const Comments = withFields(Collection.make("comments", Comment));
const Teams = withFields(Collection.make("teams", User));
const TeamPosts = withFields(Teams.subcollection("posts", Comment));
const MixedPosts = withFields(CollectionGroup.make(UserPosts, TeamPosts));

// ---------------------------------------------------------------------------
// Filters and orders: owned by the collections their fields came from
// ---------------------------------------------------------------------------

type Op = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "array-contains";
type FilterData =
  | { readonly _tag: "Field"; readonly path: string; readonly op: Op; readonly value: unknown }
  | { readonly _tag: "And" | "Or"; readonly filters: ReadonlyArray<FilterData> };
interface Filter<O> {
  readonly "~owner": (_: O) => void;
  readonly data: FilterData;
}
const leaf = (f: Field<any, any>, op: Op, value: unknown): any => ({
  data: { _tag: "Field", path: pathOf(f), op, value },
});

type V<T> = NoInfer<Exclude<T, undefined>>;
type Ordered<T> = [Exclude<T, undefined | null>] extends [Orderable] ? unknown : never;
type Arrayish<T> = [T] extends [ReadonlyArray<unknown>] ? unknown : never;

const eq = <O, T>(f: Field<O, T>, v: V<T>): Filter<O> => leaf(f, "==", v);
const inArray = <O, T>(f: Field<O, T>, vs: ReadonlyArray<V<T>>): Filter<O> => leaf(f, "in", vs);
const gt = <O, T>(f: Field<O, T> & Ordered<T>, v: V<T>): Filter<O> => leaf(f, ">", v);
const gte = <O, T>(f: Field<O, T> & Ordered<T>, v: V<T>): Filter<O> => leaf(f, ">=", v);
const arrayContains = <O, T>(
  f: Field<O, T> & Arrayish<T>,
  v: NoInfer<T extends ReadonlyArray<infer E> ? E : never>,
): Filter<O> => leaf(f, "array-contains", v);

/** Owners infer contravariantly: mixing group and member fields yields the member. */
const and = <O>(...filters: ReadonlyArray<Filter<O>>): Filter<O> =>
  ({ data: { _tag: "And", filters: filters.map((f) => f.data) } }) as any;
const or = <O>(...filters: ReadonlyArray<Filter<O>>): Filter<O> =>
  ({ data: { _tag: "Or", filters: filters.map((f) => f.data) } }) as any;

interface Order<O> {
  readonly "~owner": (_: O) => void;
  readonly path: string;
  readonly direction: "asc" | "desc";
}
const desc = <O, T>(f: Field<O, T> & Ordered<T>): Order<O> =>
  ({ path: pathOf(f), direction: "desc" }) as any;

// ---------------------------------------------------------------------------
// Query: a source accepts a filter when it reads only collections it owns
// ---------------------------------------------------------------------------

type Source = Collection.CollectionReference<any> | CollectionGroup.Any;
type CollectionsOf<S> =
  S extends Collection.CollectionReference<infer C>
    ? Plain<C>
    : S extends CollectionGroup.CollectionGroup<infer M>
      ? Plain<M>
      : never;
interface Query<S extends Source> {
  readonly source: S;
  readonly filters: ReadonlyArray<FilterData>;
  readonly orderBy: ReadonlyArray<{ path: string; direction: "asc" | "desc" }>;
}
type QueryLike<S extends Source> = S | Query<S>;
const toQuery = <S extends Source>(self: QueryLike<S>): Query<S> =>
  "filters" in self ? self : { source: self, filters: [], orderBy: [] };

/**
 * `Filter<O>` is contravariant in `O`, so "S reads only collections in O" is
 * plain assignability: Filter<O> extends Filter<CollectionsOf<S>>.
 */
const where: {
  <F extends Filter<any>>(
    filter: F,
  ): <S extends Source>(
    self: QueryLike<S> & ([F] extends [Filter<CollectionsOf<S>>] ? unknown : never),
  ) => Query<S>;
  <S extends Source>(
    build: (
      fields: (S extends CollectionGroup.Any ? S : CollectionsOf<S>) extends {
        readonly fields: infer F;
      }
        ? F
        : never,
    ) => Filter<any>,
  ): (self: QueryLike<S>) => Query<S>;
} = (arg: any) => (self: any) => {
  const q = toQuery(self);
  const s = q.source as any;
  const filter: Filter<any> = typeof arg === "function" ? arg((s.collection ?? s).fields) : arg;
  return { ...q, filters: [...q.filters, filter.data] };
};
const orderBy =
  <R extends Order<any>>(order: R) =>
  <S extends Source>(
    self: QueryLike<S> & ([R] extends [Order<CollectionsOf<S>>] ? unknown : never),
  ): Query<S> => {
    const q = toQuery(self);
    return { ...q, orderBy: [...q.orderBy, { path: order.path, direction: order.direction }] };
  };

// ===========================================================================
// Call sites
// ===========================================================================

const alice = "alice" as Collection.Id<typeof Users>;
const acme = "acme" as Collection.Id<typeof Orgs>;
const P = UserPosts.fields;
const G = AllPosts.fields;

// H1 - Drizzle's look: the definition is the table.
const h1 = pipe(
  UserPosts.collection(alice),
  where(and(eq(P.published, true), or(arrayContains(P.tags, "effect"), gte(P.likes, 1000)))),
  orderBy(desc(P.likes)),
);
// H2 - nested and record paths; a struct field named `path` doesn't collide.
const h2 = pipe(
  UserPosts.collection(alice),
  where(and(eq(P.address.path, "/x"), eq(P.translations["de"], "Hallo"))),
);
// H3 - one filter for several collections: build it from their group.
const popular = gte(G.likes, 1000);
const h3a = pipe(AllPosts, where(popular));
const h3b = pipe(UserPosts.collection(alice), where(popular));
const h3c = pipe(OrgPosts.collection(acme), where(popular));
// H4 - group and member fields mixed: owned by the member, so the member only.
const h4 = pipe(UserPosts.collection(alice), where(and(popular, eq(P.title, "x"))));
// H5 - a mixed-model group offers only what its members share.
const h5 = pipe(MixedPosts, where(gte(MixedPosts.fields.likes, 10)));
// H6 - the callback form gets the piped source's fields, no import needed.
const h6 = pipe(
  AllPosts,
  where((p) => or(eq(p.published, true), inArray(p.address.city, ["Berlin"]))),
);

// ---------------------------------------------------------------------------
// What the types refuse
// ---------------------------------------------------------------------------

// @ts-expect-error a field the model lacks
void P.nope;
// @ts-expect-error not orderable: bigint is stored as a string
void gt(P.views, 1n);
// @ts-expect-error wrong value Type
void eq(P.likes, "1");
// @ts-expect-error nominal: Post's `likes` on Comments, though it holds `likes: number`
void pipe(Comments.collection(), where(gte(P.likes, 1)));
// @ts-expect-error nominal: a member's filter on its group (OrgPosts docs too)
void pipe(AllPosts, where(gte(P.likes, 1)));
// @ts-expect-error nominal: one member's filter on a sibling
void pipe(OrgPosts.collection(acme), where(eq(P.title, "x")));
// @ts-expect-error mixed group and member fields don't fit the group
void pipe(AllPosts, where(and(popular, eq(P.title, "x"))));
// @ts-expect-error orderBy from another collection
void pipe(Comments.collection(), orderBy(desc(P.likes)));
// @ts-expect-error a mixed-model group lacks Post-only fields
void MixedPosts.fields.title;

// ---------------------------------------------------------------------------
// I - the same, through a separate function: `Query.fields(source)`
// ---------------------------------------------------------------------------
//
// Owners come from the argument, so the plain definitions work as they are
// (no `Plain` step), and a reference works too. A WeakMap keeps one fields
// object per definition.

type FieldsFor<X> =
  X extends Collection.CollectionReference<infer C>
    ? Fields<C, DocOf<C>>
    : X extends Collection.Any
      ? Fields<X, DocOf<X>>
      : X extends CollectionGroup.CollectionGroup<infer M>
        ? Fields<M, CommonShape<DocOf<M>>>
        : never;
const cache = new WeakMap<object, unknown>();
const fieldsOf = <
  X extends Collection.Any | Collection.CollectionReference<any> | CollectionGroup.Any,
>(
  x: X,
): FieldsFor<X> => {
  const key = Collection.isCollectionReference(x) ? x.collection : x;
  if (!cache.has(key)) cache.set(key, makeFields());
  return cache.get(key) as FieldsFor<X>;
};

const PlainUsers = Collection.make("users", User);
const PlainUserPosts = PlainUsers.subcollection("posts", Post);
const PlainOrgPosts = Collection.make("orgs", User).subcollection("posts", Post);
const PlainAllPosts = CollectionGroup.make(PlainUserPosts, PlainOrgPosts);
const PlainComments = Collection.make("comments", Comment);

const p = fieldsOf(PlainUserPosts);
const plainAlice = "alice" as Collection.Id<typeof PlainUsers>;
const i1 = pipe(
  PlainUserPosts.collection(plainAlice),
  where(and(eq(p.published, true), gte(p.likes, 1000))),
  orderBy(desc(p.likes)),
);
const plainPopular = gte(fieldsOf(PlainAllPosts).likes, 1000);
const i2 = pipe(PlainUserPosts.collection(plainAlice), where(plainPopular));
const i3 = pipe(PlainAllPosts, where(plainPopular));
// from a reference: same owner as from its definition
const i4 = pipe(
  PlainUserPosts.collection(plainAlice),
  where(eq(fieldsOf(PlainUserPosts.collection(plainAlice)).title, "x")),
);
// @ts-expect-error nominal, as with `.fields`
void pipe(PlainComments.collection(), where(gte(p.likes, 1)));
// @ts-expect-error a member's filter on its group
void pipe(PlainAllPosts, where(gte(p.likes, 1)));

type Same<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const assert = <_T extends true>() => {};
assert<Same<typeof h1, Query<Collection.CollectionReference<Plain<typeof UserPosts>>>>>();
assert<Same<typeof h3a, Query<typeof AllPosts>>>();
assert<Same<typeof popular, Filter<Plain<typeof UserPosts | typeof OrgPosts>>>>();
assert<Same<typeof h6, Query<typeof AllPosts>>>();
assert<Same<typeof i1, Query<Collection.CollectionReference<typeof PlainUserPosts>>>>();
assert<Same<typeof i3, Query<typeof PlainAllPosts>>>();

// ---------------------------------------------------------------------------
// Surface the state
// ---------------------------------------------------------------------------

const show = (name: string, q: Query<any>) =>
  console.log(
    `--- ${name}  (${"path" in q.source ? q.source.path : `group ${q.source.id}`})\n` +
      JSON.stringify({ filters: q.filters, orderBy: q.orderBy }),
  );
show("H1", h1);
show("H2", h2);
show("H3a", h3a);
show("H3b", h3b);
show("H3c", h3c);
show("H4", h4);
show("H5", h5);
show("H6", h6);
show("I1", i1);
show("I2", i2);
show("I3", i3);
show("I4", i4);
console.log(
  "same fields object:",
  fieldsOf(PlainUserPosts) === fieldsOf(PlainUserPosts.collection(plainAlice)),
);
