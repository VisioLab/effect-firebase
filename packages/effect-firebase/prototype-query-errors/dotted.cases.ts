/** PROTOTYPE (#127): the refused cases, dotted paths (the #126 lookup form). */
import { pipe } from "effect";
import * as Q from "./dottedLookup.ts";
import { AllPosts, alice, Comments, UserPosts } from "./model.ts";

// CASE unknown-field
void pipe(UserPosts.collection(alice), Q.where("nope", "==", 1));
// CASE wrong-value
void pipe(UserPosts.collection(alice), Q.where("likes", "==", "1"));
// CASE op-by-kind (bigint is not orderable)
void pipe(UserPosts.collection(alice), Q.where("views", ">", 1n));
// CASE op-by-kind (array-contains on a string)
void pipe(UserPosts.collection(alice), Q.where("title", "array-contains", "x"));
// CASE other-collection (a Post field on Comments)
void pipe(Comments.collection(), Q.where("title", "==", "x"));
// CASE other-collection (a group: holds every Post path, so nothing to refuse)
void pipe(AllPosts, Q.where("likes", "==", 1));
// CASE orderBy-other-collection
void pipe(Comments.collection(), Q.orderBy("title"));
