/** PROTOTYPE (#127): the refused cases, branded field objects. */
import { pipe } from "effect";
import * as Q from "./branded.ts";
import { AllPosts, alice, Comments, OrgPosts, UserPosts } from "./model.ts";

const p = Q.fields(UserPosts);
const g = Q.fields(AllPosts);

// CASE unknown-field
void Q.eq(p.nope, 1);
// CASE unknown-field (nested)
void Q.eq(p.address.nope, 1);
// CASE wrong-value
void pipe(UserPosts.collection(alice), Q.where(Q.eq(p.likes, "1")));
// CASE op-by-kind (bigint is not orderable)
void pipe(UserPosts.collection(alice), Q.where(Q.gt(p.views, 1n)));
// CASE op-by-kind (bigint, overload layout)
void Q.gtOverloaded(p.views, 1n);
// CASE op-by-kind (array-contains on a string)
void pipe(UserPosts.collection(alice), Q.where(Q.arrayContains(p.title, "x")));
// CASE other-collection (a Post field on Comments)
void pipe(Comments.collection(), Q.where(Q.eq(p.likes, 1)));
// CASE other-collection (a member's filter on its group)
void pipe(AllPosts, Q.where(Q.eq(p.likes, 1)));
// CASE other-collection (mixed owners inside and/or)
void pipe(AllPosts, Q.where(Q.and(Q.eq(g.likes, 1), Q.eq(p.title, "x"))));
// CASE orderBy-other-collection
void pipe(Comments.collection(), Q.orderBy(Q.desc(p.likes)));
// CASE callback unknown-field
void pipe(AllPosts, Q.whereFn((f, q) => q.eq(f.nope, 1)));
// CASE callback wrong-value
void pipe(AllPosts, Q.whereFn((f, q) => q.eq(f.likes, "1")));
// CASE callback op-by-kind
void pipe(AllPosts, Q.whereFn((f, q) => q.gt(f.views, 1n)));
// CASE callback other-collection (an outer filter returned)
void pipe(Comments.collection(), Q.whereFn(() => Q.eq(p.likes, 1)));

// accepted, to check nothing over-refuses
export const ok = [
  pipe(UserPosts.collection(alice), Q.where(Q.and(Q.eq(p.likes, 1), Q.gt(p.likes, 2)))),
  pipe(OrgPosts.collection(alice as never), Q.where(Q.gt(g.likes, 1))),
  pipe(AllPosts, Q.where(Q.arrayContains(g.tags, "x")), Q.orderBy(Q.desc(g.likes))),
  pipe(AllPosts, Q.whereFn((f, q) => q.or(q.eq(f.address.city, "Berlin"), q.gt(f.likes, 3)))),
];
