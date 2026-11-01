/** PROTOTYPE (#127): the refused cases, field objects as #125/#126 built them. */
import { pipe } from "effect";
import * as Q from "./fields.ts";
import { AllPosts, alice, Comments, UserPosts } from "./model.ts";

const p = Q.fields(UserPosts);

// CASE unknown-field
void Q.eq(p.nope, 1);
// CASE wrong-value
void pipe(UserPosts.collection(alice), Q.where(Q.eq(p.likes, "1")));
// CASE op-by-kind (bigint is not orderable)
void pipe(UserPosts.collection(alice), Q.where(Q.gt(p.views, 1n)));
// CASE op-by-kind (array-contains on a string)
void pipe(UserPosts.collection(alice), Q.where(Q.arrayContains(p.title, "x")));
// CASE other-collection (a Post field on Comments)
void pipe(Comments.collection(), Q.where(Q.eq(p.likes, 1)));
// CASE other-collection (a member's filter on its group)
void pipe(AllPosts, Q.where(Q.eq(p.likes, 1)));
// CASE orderBy-other-collection
void pipe(Comments.collection(), Q.orderBy(Q.desc(p.likes)));
