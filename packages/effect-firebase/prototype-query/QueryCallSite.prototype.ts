/**
 * PROTOTYPE - throwaway, never merged. Wayfinder ticket "How a query is written
 * and handed to a read" (#120) on map "Queries in Firestore" (#117).
 *
 * Question: what does a query look like at the call site, and how does it reach
 * `getDocs`, `streamDocs` and `AdminTransaction.getDocs`, over a collection or a
 * Collection Group?
 *
 * Every API below is a `declare` stub; only the types are real. Field-path and
 * value typing is deliberately loose (`keyof Type`): that is "Filter values and
 * field typing" (#121), not this ticket. Rule enforcement is #122, cursors #123.
 *
 * Type-check: `vp check packages/effect-firebase/prototype-query` (or open in
 * the editor and hover).
 */
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import type {
  FirestoreError,
  UndefinedCollectionError,
} from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import type * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import { Effect, pipe, Schema, Stream } from "effect";
import type { Pipeable } from "effect";

// ---------------------------------------------------------------------------
// Model shared by every variant
// ---------------------------------------------------------------------------

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  likes: Schema.Number,
  tags: Schema.Array(Schema.String),
  published: Schema.Boolean,
}) {}
class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}

const Users = Collection.make("users", User);
const UserPosts = Users.subcollection("posts", Post);
const Orgs = Collection.make("orgs", Org);
const OrgPosts = Orgs.subcollection("posts", Post);
const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);

declare const userId: Collection.Id<typeof Users>;

/** Loose stand-ins; #121 decides the real ones. */
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
type Field<C extends Collection.Any> = keyof Collection.DocumentSchema<C>["Type"] & string;

/** What a read of many reads from today. */
type Source = Collection.CollectionReference<any> | CollectionGroup.Any;
type CollectionsOf<S extends Source> =
  S extends Collection.CollectionReference<infer C>
    ? C
    : S extends CollectionGroup.Any
      ? CollectionGroup.Members<S>
      : never;
/** Group reads alone can raise UndefinedCollectionError (ADR-0003). */
type ErrorOf<S extends Source> = S extends CollectionGroup.Any
  ? FirestoreError | UndefinedCollectionError
  : FirestoreError;

// ===========================================================================
// Variant A - an inert, pipeable `Query` value
// ===========================================================================
//
// A Query is data, like a Collection or a CollectionGroup: it names a source
// (a collection reference or a group) plus constraints, and reads nothing until
// handed to a read of many. Combinators are data-last so they compose with
// `pipe`. A bare reference or group is accepted wherever a query is, and a
// combinator lifts it, so there is no `Query.make` ceremony.
//
// The query keeps its source in its type, so the reads keep ADR-0003's
// error split: querying a collection fails with FirestoreError alone.

namespace A {
  export interface Query<S extends Source> extends Pipeable.Pipeable {
    readonly source: S;
    // constraints are opaque here
  }
  type QueryLike<S extends Source> = S | Query<S>;

  export declare const where: {
    <S extends Source>(
      field: Field<CollectionsOf<S>>,
      op: Op,
      value: unknown,
    ): (self: QueryLike<S>) => Query<S>;
  };
  export declare const orderBy: <S extends Source>(
    field: Field<CollectionsOf<S>>,
    direction?: "asc" | "desc",
  ) => (self: QueryLike<S>) => Query<S>;
  export declare const limit: (n: number) => <S extends Source>(self: QueryLike<S>) => Query<S>;
  export declare const limitToLast: (
    n: number,
  ) => <S extends Source>(self: QueryLike<S>) => Query<S>;
  /** Cursor shape is #123; shown only to see that it sits on the same value. */
  export declare const startAfter: <S extends Source>(
    doc: QuerySnapshot.Existing<CollectionsOf<S>>,
  ) => (self: QueryLike<S>) => Query<S>;

  /** Composite filters, as values passed to `where`. */
  export interface Filter<S extends Source> {
    readonly _S: S;
  }
  export declare const field: <S extends Source>(
    f: Field<CollectionsOf<S>>,
    op: Op,
    value: unknown,
  ) => Filter<S>;
  export declare const or: <S extends Source>(...filters: Array<Filter<S>>) => Filter<S>;
  export declare const and: <S extends Source>(...filters: Array<Filter<S>>) => Filter<S>;
  export declare const whereFilter: <S extends Source>(
    filter: Filter<S>,
  ) => (self: QueryLike<S>) => Query<S>;

  /** The portable reads: one overload set, taking a source or a query of it. */
  export interface Firestore {
    readonly getDocs: <S extends Source>(
      query: QueryLike<S>,
    ) => Effect.Effect<QuerySnapshot.QuerySnapshot<CollectionsOf<S>>, ErrorOf<S>>;
    readonly streamDocs: <S extends Source>(
      query: QueryLike<S>,
    ) => Stream.Stream<QuerySnapshot.QuerySnapshot<CollectionsOf<S>>, ErrorOf<S>>;
  }
  export interface AdminTransaction {
    readonly getDocs: Firestore["getDocs"];
  }
  /** The client widens with its existing options, untouched (ADR-0001). */
  export interface ClientFirestore extends Firestore {
    readonly getDocs: <S extends Source>(
      query: QueryLike<S>,
      options?: { readonly source?: "default" | "server" | "cache" },
    ) => Effect.Effect<QuerySnapshot.QuerySnapshot<CollectionsOf<S>>, ErrorOf<S>>;
  }
}

declare const fsA: A.Firestore;
declare const txA: A.AdminTransaction;
declare const clientA: A.ClientFirestore;

// A1 (not shown): `UserPosts.collection(userId).pipe(...)` would need
// CollectionReference and CollectionGroup to become Pipeable. A2's `pipe(...)`
// works with today's references unchanged.

// A2: a query over one collection.
const popularByUser = pipe(
  UserPosts.collection(userId),
  A.where("published", "==", true),
  A.orderBy("likes", "desc"),
  A.limit(10),
);
//    ^? A.Query<Collection.CollectionReference<typeof UserPosts>>
const a2 = fsA.getDocs(popularByUser);
//    ^? Effect<QuerySnapshot<typeof UserPosts>, FirestoreError>

// A3: a Collection Group query keeps the group's extra error.
const popularEverywhere = pipe(AllPosts, A.where("likes", ">", 100), A.orderBy("likes", "desc"));
const a3 = fsA.getDocs(popularEverywhere);
//    ^? Effect<QuerySnapshot<UserPosts | OrgPosts>, FirestoreError | UndefinedCollectionError>

// A4: one value, every read of many. Portable code defines it once.
const a4 = Effect.gen(function* () {
  const once = yield* fsA.getDocs(popularByUser);
  const inTx = yield* txA.getDocs(popularByUser);
  const cached = yield* clientA.getDocs(popularByUser, { source: "cache" });
  const live = fsA.streamDocs(popularByUser);
  return { once, inTx, cached, live };
});

// A5: composite filter.
const a5 = pipe(
  AllPosts,
  A.whereFilter(A.or(A.field("tags", "array-contains", "effect"), A.field("likes", ">=", 1000))),
);

// A6: cursor on the same value (shape is #123's).
declare const last: QuerySnapshot.Existing<typeof UserPosts>;
const a6 = pipe(popularByUser, A.startAfter(last));

// A7: unchanged call sites keep working - a bare ref/group is a query.
const a7 = fsA.getDocs(UserPosts.collection(userId));
const a7g = fsA.getDocs(AllPosts);

// A-neg: a field the model does not have (loose typing still catches this).
// @ts-expect-error not assignable
pipe(UserPosts.collection(userId), A.where("nope", "==", 1));

// ===========================================================================
// Variant B - an options argument on the existing reads
// ===========================================================================
//
// No new value: getDocs(ref, { where, orderBy, limit, ... }). The constraint
// types hang off the source's type parameter, so they type-check inline.
// On the client this options object is the same slot as today's ReadOptions /
// ListenOptions, so the two are merged into one bag.

namespace B {
  export interface QueryOptions<C extends Collection.Any> {
    readonly where?: ReadonlyArray<readonly [Field<C>, Op, unknown]>;
    readonly orderBy?: ReadonlyArray<Field<C> | readonly [Field<C>, "asc" | "desc"]>;
    readonly limit?: number;
    readonly limitToLast?: number;
    readonly startAfter?: QuerySnapshot.Existing<C>;
  }
  export interface Firestore {
    readonly getDocs: {
      <C extends Collection.Any>(
        ref: Collection.CollectionReference<C>,
        options?: QueryOptions<C>,
      ): Effect.Effect<QuerySnapshot.QuerySnapshot<C>, FirestoreError>;
      <G extends CollectionGroup.Any>(
        group: G,
        options?: QueryOptions<CollectionGroup.Members<G>>,
      ): Effect.Effect<
        QuerySnapshot.QuerySnapshot<CollectionGroup.Members<G>>,
        FirestoreError | UndefinedCollectionError
      >;
    };
  }
  export interface ClientFirestore extends Firestore {
    readonly getDocs: {
      <C extends Collection.Any>(
        ref: Collection.CollectionReference<C>,
        options?: QueryOptions<C> & { readonly source?: "default" | "server" | "cache" },
      ): Effect.Effect<QuerySnapshot.QuerySnapshot<C>, FirestoreError>;
      <G extends CollectionGroup.Any>(
        group: G,
        options?: QueryOptions<CollectionGroup.Members<G>> & {
          readonly source?: "default" | "server" | "cache";
        },
      ): Effect.Effect<
        QuerySnapshot.QuerySnapshot<CollectionGroup.Members<G>>,
        FirestoreError | UndefinedCollectionError
      >;
    };
  }
}

declare const fsB: B.Firestore;
declare const clientB: B.ClientFirestore;

// B1: inline reads well.
const b1 = fsB.getDocs(UserPosts.collection(userId), {
  where: [["published", "==", true]],
  orderBy: [["likes", "desc"]],
  limit: 10,
});

// B2: reuse means splitting source from options and annotating the options,
// since a bare object literal has no C to check its fields against.
const popularOptions: B.QueryOptions<typeof UserPosts> = {
  where: [["published", "==", true]],
  orderBy: [["likes", "desc"]],
  limit: 10,
};
const b2 = Effect.gen(function* () {
  const once = yield* fsB.getDocs(UserPosts.collection(userId), popularOptions);
  // query and read-source knobs share one bag on the client
  const cached = yield* clientB.getDocs(UserPosts.collection(userId), {
    ...popularOptions,
    source: "cache",
  });
  return { once, cached };
});

// B3: composite filters need a nested-tuple or nested-object grammar inside
// `where`, e.g. { or: [...] } - noticeably harder to read than A5.
// B4: "or" in an options bag cannot express order-dependent things like
// orderBy + startAfter tying to that order beyond position in the object.

// ===========================================================================
// Variant C - fluent methods on references and groups
// ===========================================================================
//
// `UserPosts.collection(userId).where(...).orderBy(...)`, like the SDKs. Shown
// only for contrast: it puts query methods on CollectionReference and
// CollectionGroup (and every future source), departing from the library's
// data-last, inert-definition style, and the methods cannot be tree-shaken.

namespace C {
  export interface Query<S extends Source> {
    readonly where: (field: Field<CollectionsOf<S>>, op: Op, value: unknown) => Query<S>;
    readonly orderBy: (field: Field<CollectionsOf<S>>, direction?: "asc" | "desc") => Query<S>;
    readonly limit: (n: number) => Query<S>;
  }
  export declare const of: <S extends Source>(s: S) => Query<S>; // stands in for methods on the ref
}
const c1 = C.of(UserPosts.collection(userId))
  .where("published", "==", true)
  .orderBy("likes", "desc")
  .limit(10);

export { a2, a3, a4, a5, a6, a7, a7g, b1, b2, c1 };

// Checks that the hover comments above are what the compiler says.
type Same<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
declare const assert: <T extends true>() => void;
assert<
  Same<typeof a2, Effect.Effect<QuerySnapshot.QuerySnapshot<typeof UserPosts>, FirestoreError>>
>();
assert<
  Same<
    typeof a3,
    Effect.Effect<
      QuerySnapshot.QuerySnapshot<typeof UserPosts | typeof OrgPosts>,
      FirestoreError | UndefinedCollectionError
    >
  >
>();
assert<
  Same<typeof b1, Effect.Effect<QuerySnapshot.QuerySnapshot<typeof UserPosts>, FirestoreError>>
>();
// @ts-expect-error B rejects a field the model lacks too
void fsB.getDocs(UserPosts.collection(userId), { where: [["nope", "==", 1]] });
// @ts-expect-error A on a group: field must exist on the members
pipe(AllPosts, A.where("nope", "==", 1));

// ===========================================================================
// Question 2 - how composite `and`/`or` filters are written (on top of A)
// ===========================================================================
//
// SDKs for reference:
//   client: query(ref, or(where("tags", "array-contains", "effect"), where("likes", ">=", 1000)), orderBy("likes"))
//   admin:  ref.where(Filter.or(Filter.where("tags", "array-contains", "effect"), Filter.where("likes", ">=", 1000))).orderBy("likes")

// D1 - a separate `Filter` module, as Admin has: filters are plain values,
// `Query.where` takes a field triple or one Filter.
namespace D1 {
  export interface Filter<S extends Source> {
    readonly _S: (s: S) => void;
  }
  export declare const Filter: {
    readonly where: <S extends Source>(
      field: Field<CollectionsOf<S>>,
      op: Op,
      value: unknown,
    ) => Filter<S>;
    readonly or: <S extends Source>(...filters: Array<Filter<S>>) => Filter<S>;
    readonly and: <S extends Source>(...filters: Array<Filter<S>>) => Filter<S>;
  };
  export declare const where: {
    <S extends Source>(filter: Filter<S>): (self: A.Query<S> | S) => A.Query<S>;
    <S extends Source>(
      field: Field<CollectionsOf<S>>,
      op: Op,
      value: unknown,
    ): (self: A.Query<S> | S) => A.Query<S>;
  };
}
const d1 = pipe(
  AllPosts,
  D1.where("published", "==", true),
  D1.where(
    D1.Filter.or(
      D1.Filter.where("tags", "array-contains", "effect"),
      D1.Filter.where("likes", ">=", 1000),
    ),
  ),
  A.orderBy("likes", "desc"),
);
// D1 reusable filter: has no source yet, so it is annotated or built from one.
const popularOrTagged = (tag: string) =>
  D1.Filter.or<typeof AllPosts>(
    D1.Filter.where("tags", "array-contains", tag),
    D1.Filter.where("likes", ">=", 1000),
  );
void pipe(AllPosts, D1.where(popularOrTagged("effect")));
// @ts-expect-error D1: a field the model lacks, nested inside `or`
void pipe(AllPosts, D1.where(D1.Filter.or(D1.Filter.where("nope", "==", 1))));

// D2 - `or`/`and` live in `Query`, and each takes the same field triples
// `where` does, so there is no leaf constructor.
namespace D2 {
  export type Condition<S extends Source> =
    | readonly [Field<CollectionsOf<S>>, Op, unknown]
    | Composite<S>;
  export interface Composite<S extends Source> {
    readonly _S: (s: S) => void;
  }
  export declare const or: <S extends Source>(...conditions: Array<Condition<S>>) => Composite<S>;
  export declare const and: <S extends Source>(...conditions: Array<Condition<S>>) => Composite<S>;
  export declare const where: {
    <S extends Source>(composite: Composite<S>): (self: A.Query<S> | S) => A.Query<S>;
    <S extends Source>(
      field: Field<CollectionsOf<S>>,
      op: Op,
      value: unknown,
    ): (self: A.Query<S> | S) => A.Query<S>;
  };
}
const d2 = pipe(
  AllPosts,
  D2.where("published", "==", true),
  D2.where(D2.or(["tags", "array-contains", "effect"], ["likes", ">=", 1000])),
  A.orderBy("likes", "desc"),
);
// @ts-expect-error D2: a field the model lacks, nested inside `or`
void pipe(AllPosts, D2.where(D2.or(["nope", "==", 1])));

// D3 - as the client SDK: `Query.where(...)` returns one value that is both a
// pipe step and a filter, so `Query.or(Query.where(...), ...)` nests it.
namespace D3 {
  export interface Where<S extends Source> {
    (self: A.Query<S> | S): A.Query<S>;
    readonly _filter: (s: S) => void;
  }
  export declare const where: <S extends Source>(
    field: Field<CollectionsOf<S>>,
    op: Op,
    value: unknown,
  ) => Where<S>;
  export declare const or: <S extends Source>(...filters: Array<Where<S>>) => Where<S>;
  export declare const and: <S extends Source>(...filters: Array<Where<S>>) => Where<S>;
}
const d3 = pipe(
  AllPosts,
  D3.where("published", "==", true),
  D3.or(D3.where("tags", "array-contains", "effect"), D3.where("likes", ">=", 1000)),
  A.orderBy("likes", "desc"),
);
// @ts-expect-error D3: a field the model lacks, nested inside `or`
void pipe(AllPosts, D3.or(D3.where("nope", "==", 1)));

export { d1, d2, d3 };
