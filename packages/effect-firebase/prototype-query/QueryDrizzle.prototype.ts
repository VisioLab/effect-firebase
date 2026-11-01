/**
 * PROTOTYPE - throwaway, never merged. Map "Queries in Firestore" (#117),
 * revisiting "How a query is written" (#120) and "Filter values and field
 * typing" (#121).
 *
 * Question: would a Drizzle-like API work for typesafe Firestore queries, and
 * what does it buy over the settled dotted-string API
 * (`Query.where("address.city", "==", "Berlin")`)?
 *
 * Drizzle's three shapes, mapped onto the settled pipeable `Query` value:
 *   E - column objects + operator functions:  where(and(eq(p.likes, 3), ...))
 *   F - the relational callback:              where((p, { eq, or }) => ...)
 *   G - the relational v2 object filter:      where({ likes: { gte: 3 }, OR: [...] })
 *
 * Unlike the #120 prototype, the field layer is real and runs: field objects
 * are a Proxy that records the path, operators build plain filter data.
 * Operator gating is approximated from the field's Type (#121 decides it from
 * Type and stored form, plus an annotation; that machinery is out of scope).
 *
 * Type-check: `vp check prototype-query`  (from packages/effect-firebase)
 * Run:        `vpx prototype-query/QueryDrizzle.prototype.ts`  prints every query
 *
 * Findings (all three shapes type-check against the real model types):
 * - It works, and fits #120 unchanged: `where`/`orderBy` stay pipe steps
 *   and the source stays in `Query<S>`. Only how a field and a filter are named
 *   changes.
 * - Field objects are a few lines at runtime (a path-recording Proxy, which
 *   covers records via `p.translations["de"]` for free), and they give
 *   autocomplete, go-to-definition and rename on paths, which dotted strings don't.
 * - A filter carries the paths and Types it reads, not its collection, so a
 *   filter built apart from a pipe needs no `Query.or<typeof AllPosts>`
 *   annotation (E3), and a source accepts it if it holds those paths at those
 *   Types. That is structural: a Post filter on `likes` also filters Comments
 *   (E4). Shared Field over a group drops out of the same check (E5).
 * - Gating by kind works in all three (`gt` on bigint, `arrayContains` on a
 *   string), but `never`-parameter gating reads "not assignable to never";
 *   a branded error type would fix that.
 * - A source mismatch errors at the right `where`, but the message is a long
 *   function-assignability error; the `~source does not hold` hint is lost.
 *   The callback (F) and object (G) shapes avoid this entirely, since their
 *   fields come from the piped source.
 * - G (object filter) has the best errors and no imports, but needs dotted
 *   keys for nesting, nests OR/AND awkwardly, and has a parallel op vocabulary.
 */
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import type * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import { pipe, Schema } from "effect";
import type { DateTime } from "effect";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  likes: Schema.Finite,
  views: Schema.BigInt, // stored as a string: must not be ordered
  tags: Schema.Array(Schema.String),
  published: Schema.Boolean,
  publishedAt: FirestoreModel.Timestamp(Schema.Date),
  address: Schema.Struct({ city: Schema.String, zip: Schema.String }),
  translations: FirestoreModel.Record(Schema.String, Schema.String),
}) {}
class Comment extends FirestoreModel.Class<Comment>("Comment")({
  body: Schema.String,
  likes: Schema.Finite,
}) {}

const Users = Collection.make("users", User);
const UserPosts = Users.subcollection("posts", Post);
const Orgs = Collection.make("orgs", User);
const OrgPosts = Orgs.subcollection("posts", Post);
const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);
const Comments = Collection.make("comments", Comment);
// A group whose members hold different models: only `likes` is shared.
const Teams = Collection.make("teams", User);
const MixedPosts = CollectionGroup.make(UserPosts, Teams.subcollection("posts", Comment));

// ---------------------------------------------------------------------------
// Sources (as settled in #120)
// ---------------------------------------------------------------------------

type Source = Collection.CollectionReference<any> | CollectionGroup.Any;
type CollectionsOf<S> =
  S extends Collection.CollectionReference<infer C>
    ? C
    : S extends CollectionGroup.Any
      ? CollectionGroup.Members<S>
      : never;
/** The document Type a source holds; a union over a group's members. */
type DocOf<S> =
  CollectionsOf<S> extends infer C extends Collection.Any
    ? Collection.DocumentSchema<C>["Type"]
    : never;

// ---------------------------------------------------------------------------
// Fields - Drizzle's "columns"
// ---------------------------------------------------------------------------
//
// A field is a typed path. It carries the path, the value Type, and what it
// may be compared with. Structs nest as properties, records index with any
// key, arrays and leaves stop.

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

/** Approximation of #121's ordering gate: from Type alone. */
type Orderable = string | number | boolean | Date | Timestamp.Timestamp | DateTime.Utc;

interface Field<P extends string, T> {
  readonly "~path": P;
  readonly "~type": (_: T) => T; // invariant: eq(p.likes, "3") must not widen T
}

type Fields<T, Prefix extends string = ""> = {
  readonly [K in keyof T & string]-?: FieldAt<NonNullable<T[K]>, T[K], `${Prefix}${K}`>;
};
type FieldAt<NN, T, P extends string> = [NN] extends [Leaf]
  ? Field<P, T>
  : string extends keyof NN
    ? Field<P, T> & {
        readonly [k: string]: FieldAt<
          NonNullable<NN[string & keyof NN]>,
          NN[string & keyof NN],
          `${P}.${string}`
        >;
      }
    : Field<P, T> & Fields<NN, `${P}.`>;

/**
 * The fields of a union of documents (a group, a `FirestoreModel.Union`):
 * only paths every member holds with the same Type. Shared Field, simplified.
 */
type FieldsOf<D> = [D] extends [never] ? never : Fields<CommonShape<D>>;
type CommonShape<D> = {
  [K in CommonKeys<D>]: D extends unknown ? D[K & keyof D] : never;
};
type CommonKeys<D> = (D extends unknown ? (x: keyof D) => void : never) extends (x: infer K) => void
  ? K & string
  : never;

const makeFields = (path: ReadonlyArray<string> = []): any =>
  new Proxy(
    {},
    {
      get: (_, key) => (key === "~path" ? path.join(".") : makeFields([...path, String(key)])),
    },
  );

/** Fields of a source: the group's shared ones, or one collection's. */
const fields = <S extends Source>(_source: S): FieldsOf<DocOf<S>> => makeFields();
/** Fields of a model, independent of any collection. */
const modelFields = <M extends FirestoreModel.Any>(_model: M): Fields<M["Type"]> => makeFields();

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
//
// A filter remembers which paths it reads and at which Type (`R`), not which
// collection it came from. A source accepts it when it holds each path at
// exactly that Type. So `gte(postFields.likes, 10)` also filters `Comments`.

type Op =
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
type FilterData =
  | { readonly _tag: "Field"; readonly path: string; readonly op: Op; readonly value: unknown }
  | { readonly _tag: "And" | "Or"; readonly filters: ReadonlyArray<FilterData> };

interface Filter<R> {
  readonly "~requires": (_: R) => void;
  readonly data: FilterData;
}

const leaf = (field: Field<any, any>, op: Op, value: unknown): Filter<any> =>
  ({
    data: { _tag: "Field", path: field["~path"], op, value },
  }) as any;

type ElemOf<T> = T extends ReadonlyArray<infer E> ? E : never;
type Req<P extends string, T> = { readonly [K in P]: T };

const eq = <P extends string, T>(
  f: Field<P, T>,
  v: NoInfer<Exclude<T, undefined>>,
): Filter<Req<P, T>> => leaf(f, "==", v);
const ne = <P extends string, T>(
  f: Field<P, T>,
  v: NoInfer<Exclude<T, undefined>>,
): Filter<Req<P, T>> => leaf(f, "!=", v);
const inArray = <P extends string, T>(
  f: Field<P, T>,
  vs: ReadonlyArray<NoInfer<Exclude<T, undefined>>>,
): Filter<Req<P, T>> => leaf(f, "in", vs);
const notInArray = <P extends string, T>(
  f: Field<P, T>,
  vs: ReadonlyArray<NoInfer<Exclude<T, undefined>>>,
): Filter<Req<P, T>> => leaf(f, "not-in", vs);

type Ordered<P extends string, T> = [Exclude<T, undefined | null>] extends [Orderable]
  ? Field<P, T>
  : never;
const gt = <P extends string, T>(
  f: Ordered<P, T> & Field<P, T>,
  v: NoInfer<Exclude<T, undefined>>,
): Filter<Req<P, T>> => leaf(f, ">", v);
const gte = <P extends string, T>(
  f: Ordered<P, T> & Field<P, T>,
  v: NoInfer<Exclude<T, undefined>>,
): Filter<Req<P, T>> => leaf(f, ">=", v);
const lt = <P extends string, T>(
  f: Ordered<P, T> & Field<P, T>,
  v: NoInfer<Exclude<T, undefined>>,
): Filter<Req<P, T>> => leaf(f, "<", v);
const lte = <P extends string, T>(
  f: Ordered<P, T> & Field<P, T>,
  v: NoInfer<Exclude<T, undefined>>,
): Filter<Req<P, T>> => leaf(f, "<=", v);

type ArrayField<P extends string, T> = [T] extends [ReadonlyArray<unknown>] ? Field<P, T> : never;
const arrayContains = <P extends string, T>(
  f: ArrayField<P, T> & Field<P, T>,
  v: NoInfer<ElemOf<T>>,
): Filter<Req<P, T>> => leaf(f, "array-contains", v);
const arrayContainsAny = <P extends string, T>(
  f: ArrayField<P, T> & Field<P, T>,
  vs: ReadonlyArray<NoInfer<ElemOf<T>>>,
): Filter<Req<P, T>> => leaf(f, "array-contains-any", vs);

type Requires<Fs extends ReadonlyArray<Filter<any>>> = UnionToIntersection<
  { [I in keyof Fs]: Fs[I] extends Filter<infer R> ? R : never }[number]
>;
type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (
  i: infer I,
) => void
  ? I
  : never;
const and = <const Fs extends ReadonlyArray<Filter<any>>>(...filters: Fs): Filter<Requires<Fs>> =>
  ({ data: { _tag: "And", filters: filters.map((f) => f.data) } }) as any;
const or = <const Fs extends ReadonlyArray<Filter<any>>>(...filters: Fs): Filter<Requires<Fs>> =>
  ({ data: { _tag: "Or", filters: filters.map((f) => f.data) } }) as any;

interface Order<R> {
  readonly "~requires": (_: R) => void;
  readonly path: string;
  readonly direction: "asc" | "desc";
}
const asc = <P extends string, T>(f: Ordered<P, T> & Field<P, T>): Order<Req<P, T>> =>
  ({ path: f["~path"], direction: "asc" }) as any;
const desc = <P extends string, T>(f: Ordered<P, T> & Field<P, T>): Order<Req<P, T>> =>
  ({ path: f["~path"], direction: "desc" }) as any;

const ops = {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  arrayContains,
  arrayContainsAny,
  and,
  or,
};
type Ops = typeof ops;

// ---------------------------------------------------------------------------
// Does a source hold every path a filter reads, at exactly that Type?
// ---------------------------------------------------------------------------

type PathValue<D, P extends string> = D extends unknown
  ? P extends `${infer H}.${infer Rest}`
    ? H extends keyof D
      ? PathValue<NonNullable<D[H]>, Rest>
      : string extends keyof D
        ? PathValue<NonNullable<D[string & keyof D]>, Rest>
        : never
    : P extends keyof D
      ? D[P]
      : string extends keyof D
        ? D[string & keyof D]
        : never
  : never;
type Same<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Mismatches<D, R> = {
  [P in keyof R & string]: Same<PathValue<D, P>, R[P]> extends true ? never : P;
}[keyof R & string];
/** Intersected onto the pipe input, so a mismatch errors at the bad step. */
type Check<S, R> = [Mismatches<DocOf<S>, R>] extends [never]
  ? unknown
  : { readonly "~source does not hold": Mismatches<DocOf<S>, R> };

// ---------------------------------------------------------------------------
// Query (as settled in #120, with a real but tiny runtime)
// ---------------------------------------------------------------------------

interface Query<S extends Source> {
  readonly source: S;
  readonly filters: ReadonlyArray<FilterData>;
  readonly orderBy: ReadonlyArray<{ path: string; direction: "asc" | "desc" }>;
  readonly limit?: number;
}
type QueryLike<S extends Source> = S | Query<S>;
const isQuery = (u: unknown): u is Query<any> =>
  typeof u === "object" && u !== null && "filters" in u;
const toQuery = <S extends Source>(self: QueryLike<S>): Query<S> =>
  isQuery(self) ? self : { source: self as S, filters: [], orderBy: [] };

// E - Drizzle core: a filter value, built from field objects.
// F - Drizzle relational: a callback that gets the source's fields and the ops.
const where: {
  <R>(filter: Filter<R>): <S extends Source>(self: QueryLike<S> & Check<S, R>) => Query<S>;
  <S extends Source>(
    build: (fields: FieldsOf<DocOf<S>>, ops: Ops) => Filter<any>,
  ): (self: QueryLike<S>) => Query<S>;
} = (arg: Filter<any> | ((fields: any, ops: Ops) => Filter<any>)) => (self: any) => {
  const q = toQuery(self);
  const filter = typeof arg === "function" ? arg(makeFields(), ops) : arg;
  return { ...q, filters: [...q.filters, filter.data] };
};

const orderBy: {
  <R>(order: Order<R>): <S extends Source>(self: QueryLike<S> & Check<S, R>) => Query<S>;
  <S extends Source>(
    build: (fields: FieldsOf<DocOf<S>>, o: { asc: typeof asc; desc: typeof desc }) => Order<any>,
  ): (self: QueryLike<S>) => Query<S>;
} = (arg: Order<any> | ((fields: any, o: any) => Order<any>)) => (self: any) => {
  const q = toQuery(self);
  const o = typeof arg === "function" ? arg(makeFields(), { asc, desc }) : arg;
  return { ...q, orderBy: [...q.orderBy, { path: o.path, direction: o.direction }] };
};

const limit =
  (n: number) =>
  <S extends Source>(self: QueryLike<S>): Query<S> => ({ ...toQuery(self), limit: n });

// G - Drizzle relational v2: an object filter, keyed by dotted path.
type Paths<D, Prefix extends string = ""> = D extends unknown
  ? {
      [K in keyof D & string]-?: [NonNullable<D[K]>] extends [Leaf]
        ? `${Prefix}${K}`
        : string extends keyof NonNullable<D[K]>
          ? `${Prefix}${K}` | `${Prefix}${K}.${string}`
          : `${Prefix}${K}` | Paths<NonNullable<D[K]>, `${Prefix}${K}.`>;
    }[keyof D & string]
  : never;
type OpsFor<T> = {
  readonly eq?: T;
  readonly ne?: T;
  readonly in?: ReadonlyArray<T>;
  readonly notIn?: ReadonlyArray<T>;
} & ([Exclude<T, null>] extends [Orderable]
  ? { readonly gt?: T; readonly gte?: T; readonly lt?: T; readonly lte?: T }
  : {}) &
  ([T] extends [ReadonlyArray<infer E>]
    ? { readonly arrayContains?: E; readonly arrayContainsAny?: ReadonlyArray<E> }
    : {});
type ObjectFilter<D> = {
  readonly [P in Paths<D>]?: OpsFor<Exclude<PathValue<D, P>, undefined>>;
} & {
  readonly OR?: ReadonlyArray<ObjectFilter<D>>;
  readonly AND?: ReadonlyArray<ObjectFilter<D>>;
};
const objectOps: Record<string, Op> = {
  eq: "==",
  ne: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  in: "in",
  notIn: "not-in",
  arrayContains: "array-contains",
  arrayContainsAny: "array-contains-any",
};
const fromObject = (o: Record<string, any>): FilterData => ({
  _tag: "And",
  filters: Object.entries(o).flatMap(([key, v]): Array<FilterData> =>
    key === "OR"
      ? [{ _tag: "Or", filters: v.map(fromObject) }]
      : key === "AND"
        ? v.map(fromObject)
        : Object.entries(v).map(([op, value]) => ({
            _tag: "Field",
            path: key,
            op: objectOps[op]!,
            value,
          })),
  ),
});
const whereObject =
  <S extends Source>(filter: ObjectFilter<DocOf<S>>) =>
  (self: QueryLike<S>): Query<S> => {
    const q = toQuery(self);
    return { ...q, filters: [...q.filters, fromObject(filter)] };
  };

// ===========================================================================
// Call sites
// ===========================================================================

declare const userId: Collection.Id<typeof Users>;
const userPosts = UserPosts.collection("alice" as typeof userId);
const p = fields(userPosts);
const g = fields(AllPosts);
const post = modelFields(Post);

// E1 - the #120 example, Drizzle style.
const e1 = pipe(
  userPosts,
  where(and(eq(p.published, true), or(arrayContains(p.tags, "effect"), gte(p.likes, 1000)))),
  orderBy(desc(p.likes)),
  limit(10),
);
// E2 - nested structs and records are property access; rename/F12 work.
const e2 = pipe(
  AllPosts,
  where(and(eq(g.address.city, "Berlin"), eq(g.translations["de"]!, "Hallo"))),
);
// E3 - a filter is a plain value, reusable with no source annotation
// (the #120 string API needs `Query.or<typeof AllPosts>(...)` here).
const popularOrTagged = (tag: string) => or(arrayContains(post.tags, tag), gte(post.likes, 1000));
const e3a = pipe(userPosts, where(popularOrTagged("effect")));
const e3b = pipe(AllPosts, where(popularOrTagged("effect")));
// E4 - structural: a Post filter on `likes` also applies to Comments.
const e4 = pipe(Comments.collection(), where(gte(post.likes, 10)));

// E5 - a group of different models offers only the shared fields.
const e5 = pipe(MixedPosts, where(gte(fields(MixedPosts).likes, 10)));

// F1 - relational callback; fields come from the piped source.
const f1 = pipe(
  AllPosts,
  where((p, { and, eq, gte }) => and(eq(p.published, true), gte(p.likes, 1000))),
  orderBy((p, { desc }) => desc(p.publishedAt)),
);

// G1 - relational v2 object filter.
const g1 = pipe(
  userPosts,
  whereObject({
    published: { eq: true },
    "address.city": { in: ["Berlin", "Hamburg"] },
    OR: [{ tags: { arrayContains: "effect" } }, { likes: { gte: 1000 } }],
  }),
);

// ---------------------------------------------------------------------------
// What the types refuse
// ---------------------------------------------------------------------------

// @ts-expect-error a field the model lacks
void p.nope;
// @ts-expect-error wrong value Type
void eq(p.likes, "1000");
// @ts-expect-error bigint is stored as a string, so it is not orderable
void gt(p.views, 9n);
// @ts-expect-error array-contains on a non-array
void arrayContains(p.title, "x");
// @ts-expect-error a filter reading a path the source lacks
void pipe(Users.collection(), where(eq(post.title, "x")));
// @ts-expect-error same, nested in `or`
void pipe(Comments.collection(), where(or(gte(post.likes, 1), eq(post.title, "x"))));
// @ts-expect-error orderBy on a path the source lacks
void pipe(Comments.collection(), orderBy(desc(post.publishedAt)));
void pipe(
  userPosts,
  // @ts-expect-error callback: not orderable
  where((p, { gt }) => gt(p.views, 1n)),
);
// @ts-expect-error object filter: not orderable
void pipe(userPosts, whereObject({ views: { gt: 1n } }));
// @ts-expect-error object filter: wrong value Type
void pipe(userPosts, whereObject({ likes: { eq: "1" } }));
// @ts-expect-error group fields are the shared ones only
void fields(MixedPosts).title;

// Inferred types stay as #120 settled them.
const assert = <_T extends true>() => {};
assert<Same<typeof e1, Query<Collection.CollectionReference<typeof UserPosts>>>>();
assert<Same<typeof f1, Query<typeof AllPosts>>>();
assert<Same<typeof g1, Query<Collection.CollectionReference<typeof UserPosts>>>>();
assert<Same<typeof e3b, Query<typeof AllPosts>>>();

// ---------------------------------------------------------------------------
// Surface the state
// ---------------------------------------------------------------------------

const show = (name: string, q: Query<any>) =>
  console.log(
    `--- ${name}  (${"path" in q.source ? q.source.path : "group"})\n` +
      JSON.stringify({ filters: q.filters, orderBy: q.orderBy, limit: q.limit }, null, 1).replace(
        /\n\s*/g,
        " ",
      ),
  );
show("E1", e1);
show("E2", e2);
show("E3a", e3a);
show("E3b", e3b);
show("E4", e4);
show("E5", e5);
show("F1", f1);
show("G1", g1);
