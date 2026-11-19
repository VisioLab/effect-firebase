import type * as ClientDocumentSnapshot from "@visiolab/effect-firebase-client/firestore/ClientDocumentSnapshot";
import * as ClientQuerySnapshot from "@visiolab/effect-firebase-client/firestore/ClientQuerySnapshot";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import { type Effect, Schema, Stream } from "effect";
import { describe, expect, test } from "tstyche";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);

describe("ClientQuerySnapshot", () => {
  test("is a Query Snapshot as well", () => {
    expect<ClientQuerySnapshot.ClientQuerySnapshot<typeof Posts>>().type.toBeAssignableTo<
      QuerySnapshot.QuerySnapshot<typeof Posts>
    >();
  });
});

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}

const UserPosts = Collection.make("users", User).subcollection("posts", Post);
const OrgPosts = Collection.make("orgs", Org).subcollection("posts", Post);

describe("docs", () => {
  test("holds each document as a snapshot of the one collection it is in", () => {
    expect<
      ClientQuerySnapshot.ClientQuerySnapshot<typeof UserPosts | typeof OrgPosts>["docs"]
    >().type.toBe<
      ReadonlyArray<
        | ClientDocumentSnapshot.Existing<typeof UserPosts>
        | ClientDocumentSnapshot.Existing<typeof OrgPosts>
      >
    >();
  });
});

const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);

declare const read: ClientQuerySnapshot.ClientQuerySnapshot<typeof Posts>;
declare const groupRead: ClientQuerySnapshot.ClientQuerySnapshot<
  CollectionGroup.Members<typeof AllPosts>
>;
declare const reads: Stream.Stream<ClientQuerySnapshot.ClientQuerySnapshot<typeof Posts>>;
declare const decodedGroup: ClientQuerySnapshot.DecodedClientQuerySnapshot<
  CollectionGroup.Members<typeof AllPosts>
>;

describe("decode", () => {
  test("decodes every document, keeping the metadata of the read", () => {
    expect(ClientQuerySnapshot.decode(read)).type.toBe<
      Effect.Effect<
        ClientQuerySnapshot.DecodedClientQuerySnapshot<typeof Posts>,
        Schema.SchemaError
      >
    >();
  });

  test("decodes the documents of a Collection Group into a union of its members' own", () => {
    expect(ClientQuerySnapshot.decode(groupRead)).type.toBe<
      Effect.Effect<
        ClientQuerySnapshot.DecodedClientQuerySnapshot<typeof UserPosts | typeof OrgPosts>,
        Schema.SchemaError
      >
    >();
  });

  test("decodes each snapshot of a live read", () => {
    expect(reads.pipe(Stream.mapEffect(ClientQuerySnapshot.decode))).type.toBe<
      Stream.Stream<
        ClientQuerySnapshot.DecodedClientQuerySnapshot<typeof Posts>,
        Schema.SchemaError
      >
    >();
  });
});

describe("DecodedClientQuerySnapshot", () => {
  test("is a decoded Query Snapshot as well", () => {
    expect<ClientQuerySnapshot.DecodedClientQuerySnapshot<typeof Posts>>().type.toBeAssignableTo<
      QuerySnapshot.DecodedQuerySnapshot<typeof Posts>
    >();
  });

  test("keeps the metadata of the read", () => {
    expect(decodedGroup.metadata).type.toBe<ClientDocumentSnapshot.SnapshotMetadata>();
  });

  test("holds each decoded document with its metadata, typed by the one collection it is in", () => {
    expect(decodedGroup.docs).type.toBe<
      ReadonlyArray<
        | ClientDocumentSnapshot.DecodedExisting<typeof UserPosts>
        | ClientDocumentSnapshot.DecodedExisting<typeof OrgPosts>
      >
    >();
    expect(decodedGroup.docs[0]!.metadata).type.toBe<ClientDocumentSnapshot.SnapshotMetadata>();
  });
});
