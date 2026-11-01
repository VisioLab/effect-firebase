/**
 * PROTOTYPE - throwaway, never merged. Wayfinder ticket "Readable errors for
 * field-object queries" (#127) on map "Queries in Firestore" (#117).
 *
 * The model every style's refused cases run against.
 */
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Schema } from "effect";

export class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
export class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  likes: Schema.Finite,
  views: Schema.BigInt, // stored as a string: not orderable
  tags: Schema.Array(Schema.String),
  address: Schema.Struct({ city: Schema.String }),
}) {}
export class Comment extends FirestoreModel.Class<Comment>("Comment")({
  body: Schema.String,
  likes: Schema.Finite,
}) {}

export const Users = Collection.make("users", User);
export const UserPosts = Users.subcollection("posts", Post);
export const OrgPosts = Collection.make("orgs", User).subcollection("posts", Post);
export const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);
export const Comments = Collection.make("comments", Comment);

export const alice = "alice" as Collection.Id<typeof Users>;
