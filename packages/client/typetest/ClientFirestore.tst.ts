import type * as App from "@visiolab/effect-firebase-client/App";
import type * as ClientDocumentSnapshot from "@visiolab/effect-firebase-client/firestore/ClientDocumentSnapshot";
import * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import type * as ClientQuerySnapshot from "@visiolab/effect-firebase-client/firestore/ClientQuerySnapshot";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import type * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import type * as Firestore from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { type Effect, type Layer, Schema, type Stream } from "effect";
import type * as ClientSdk from "firebase/firestore";
import { describe, expect, test } from "tstyche";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}

const UserPosts = Collection.make("users", User).subcollection("posts", Post);
const AllUserPosts = CollectionGroup.make(UserPosts);

declare const client: ClientFirestore.ClientFirestore;
declare const portable: Firestore.Firestore;

describe("ClientFirestore", () => {
  test("is a Firestore", () => {
    expect<ClientFirestore.ClientFirestore>().type.toBeAssignableTo<Firestore.Firestore>();
  });

  test("holds the client SDK's own Firestore object as instance", () => {
    expect<ClientFirestore.ClientFirestore["instance"]>().type.toBe<ClientSdk.Firestore>();
  });

  test("leaves Firestore without an instance", () => {
    expect<Firestore.Firestore>().type.not.toHaveProperty("instance");
  });

  test("reads a document into a Document Snapshot carrying Snapshot Metadata", () => {
    expect<ReturnType<ClientFirestore.ClientFirestore["getDoc"]>>().type.toBe<
      Effect.Effect<
        ClientDocumentSnapshot.ClientDocumentSnapshot<Collection.Any>,
        Firestore.FirestoreError
      >
    >();
  });

  test("reads a collection into a Query Snapshot carrying Snapshot Metadata", () => {
    expect(client.getDocs(Posts.collection())).type.toBe<
      Effect.Effect<ClientQuerySnapshot.ClientQuerySnapshot<typeof Posts>, Firestore.FirestoreError>
    >();
  });

  test("reads a Collection Group into a Query Snapshot carrying Snapshot Metadata", () => {
    expect(client.getDocs(AllUserPosts)).type.toBe<
      Effect.Effect<
        ClientQuerySnapshot.ClientQuerySnapshot<typeof UserPosts>,
        Firestore.FirestoreError | Firestore.UndefinedCollectionError
      >
    >();
  });

  test("takes read options when reading a Collection Group", () => {
    expect(client.getDocs).type.toBeCallableWith(AllUserPosts, { source: "cache" });
  });

  test("streams a document as Document Snapshots carrying Snapshot Metadata", () => {
    expect<ReturnType<ClientFirestore.ClientFirestore["streamDoc"]>>().type.toBe<
      Stream.Stream<
        ClientDocumentSnapshot.ClientDocumentSnapshot<Collection.Any>,
        Firestore.FirestoreError
      >
    >();
  });

  test("streams a collection as Query Snapshots carrying Snapshot Metadata", () => {
    expect<ReturnType<ClientFirestore.ClientFirestore["streamDocs"]>>().type.toBe<
      Stream.Stream<
        ClientQuerySnapshot.ClientQuerySnapshot<Collection.Any>,
        Firestore.FirestoreError
      >
    >();
  });

  test("leaves the Document Snapshots Firestore reads without Snapshot Metadata", () => {
    expect<ReturnType<Firestore.Firestore["getDoc"]>>().type.toBe<
      Effect.Effect<DocumentSnapshot.DocumentSnapshot<Collection.Any>, Firestore.FirestoreError>
    >();
  });

  test("takes read options when reading a document", () => {
    expect<Parameters<ClientFirestore.ClientFirestore["getDoc"]>[1]>().type.toBe<
      ClientFirestore.ReadOptions | undefined
    >();
  });

  test("takes read options when reading a collection", () => {
    expect(client.getDocs).type.toBeCallableWith(Posts.collection(), { source: "cache" });
  });

  test("leaves Firestore reading a document without read options", () => {
    expect<Parameters<Firestore.Firestore["getDoc"]>>().type.toBe<
      [ref: Collection.DocumentReference<Collection.Any>]
    >();
  });

  test("leaves Firestore reading a collection without read options", () => {
    // @ts-expect-error Expected 1 arguments, but got 2
    void portable.getDocs(Posts.collection(), { source: "cache" });
  });

  test("takes listen options when streaming a document", () => {
    expect(client.streamDoc).type.toBeCallableWith(hello, {
      includeMetadataChanges: true,
      source: "cache",
    });
  });

  test("takes listen options when streaming a collection", () => {
    expect(client.streamDocs).type.toBeCallableWith(Posts.collection(), {
      includeMetadataChanges: true,
      source: "cache",
    });
  });

  test("leaves Firestore streaming a document without listen options", () => {
    // @ts-expect-error Expected 1 arguments, but got 2
    void portable.streamDoc(hello, { includeMetadataChanges: true });
  });

  test("leaves Firestore streaming a collection without listen options", () => {
    // @ts-expect-error Expected 1 arguments, but got 2
    void portable.streamDocs(Posts.collection(), { source: "cache" });
  });
});

describe("ReadSource", () => {
  test("names where a read is served from", () => {
    expect<ClientFirestore.ReadSource>().type.toBe<"default" | "server" | "cache">();
  });
});

describe("ListenOptions", () => {
  test("may ask for metadata changes and name the source of a listener", () => {
    expect<ClientFirestore.ListenOptions>().type.toBe<{
      readonly includeMetadataChanges?: boolean | undefined;
      readonly source?: "default" | "cache" | undefined;
    }>();
  });
});

describe("layer", () => {
  test("provides Client Firestore and Firestore from the App", () => {
    expect(ClientFirestore.layer()).type.toBe<
      Layer.Layer<ClientFirestore.ClientFirestore | Firestore.Firestore, never, App.App>
    >();
  });
});
