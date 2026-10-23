import type * as App from "@visiolab/effect-firebase-client/App";
import type * as ClientDocumentSnapshot from "@visiolab/effect-firebase-client/firestore/ClientDocumentSnapshot";
import * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import type * as ClientQuerySnapshot from "@visiolab/effect-firebase-client/firestore/ClientQuerySnapshot";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import type { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { type Effect, type Layer, Schema, type Stream } from "effect";
import type { Firestore as SdkFirestore } from "firebase/firestore";
import { describe, expect, test } from "tstyche";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

declare const client: ClientFirestore.ClientFirestore;
declare const portable: Firestore;

describe("ClientFirestore", () => {
  test("is a Firestore", () => {
    expect<ClientFirestore.ClientFirestore>().type.toBeAssignableTo<Firestore>();
  });

  test("holds the client SDK's own Firestore object as instance", () => {
    expect<ClientFirestore.ClientFirestore["instance"]>().type.toBe<SdkFirestore>();
  });

  test("leaves Firestore without an instance", () => {
    expect<Firestore>().type.not.toHaveProperty("instance");
  });

  test("reads a document into a Document Snapshot carrying Snapshot Metadata", () => {
    expect<ReturnType<ClientFirestore.ClientFirestore["getDoc"]>>().type.toBe<
      Effect.Effect<ClientDocumentSnapshot.ClientDocumentSnapshot<Collection.Any>, FirestoreError>
    >();
  });

  test("reads a collection into a Query Snapshot carrying Snapshot Metadata", () => {
    expect<ReturnType<ClientFirestore.ClientFirestore["getDocs"]>>().type.toBe<
      Effect.Effect<ClientQuerySnapshot.ClientQuerySnapshot<Collection.Any>, FirestoreError>
    >();
  });

  test("streams a document as Document Snapshots carrying Snapshot Metadata", () => {
    expect<ReturnType<ClientFirestore.ClientFirestore["streamDoc"]>>().type.toBe<
      Stream.Stream<ClientDocumentSnapshot.ClientDocumentSnapshot<Collection.Any>, FirestoreError>
    >();
  });

  test("streams a collection as Query Snapshots carrying Snapshot Metadata", () => {
    expect<ReturnType<ClientFirestore.ClientFirestore["streamDocs"]>>().type.toBe<
      Stream.Stream<ClientQuerySnapshot.ClientQuerySnapshot<Collection.Any>, FirestoreError>
    >();
  });

  test("leaves the Document Snapshots Firestore reads without Snapshot Metadata", () => {
    expect<ReturnType<Firestore["getDoc"]>>().type.toBe<
      Effect.Effect<DocumentSnapshot.DocumentSnapshot<Collection.Any>, FirestoreError>
    >();
  });

  test("takes read options when reading a document", () => {
    expect<Parameters<ClientFirestore.ClientFirestore["getDoc"]>[1]>().type.toBe<
      ClientFirestore.ReadOptions | undefined
    >();
  });

  test("takes read options when reading a collection", () => {
    expect<Parameters<ClientFirestore.ClientFirestore["getDocs"]>[1]>().type.toBe<
      ClientFirestore.ReadOptions | undefined
    >();
  });

  test("leaves Firestore reading a document without read options", () => {
    expect<Parameters<Firestore["getDoc"]>>().type.toBe<
      [ref: Collection.DocumentReference<Collection.Any>]
    >();
  });

  test("leaves Firestore reading a collection without read options", () => {
    expect<Parameters<Firestore["getDocs"]>>().type.toBe<
      [ref: Collection.CollectionReference<Collection.Any>]
    >();
  });

  test("takes listen options when streaming a document", () => {
    expect(
      client.streamDoc(hello, { includeMetadataChanges: true, source: "cache" }),
    ).type.not.toRaiseError();
  });

  test("takes listen options when streaming a collection", () => {
    expect(
      client.streamDocs(Posts.collection(), { includeMetadataChanges: true, source: "cache" }),
    ).type.not.toRaiseError();
  });

  // A `toRaiseError` would fail `vp check`, which type-checks this file too.
  // TSTyche checks the message after `@ts-expect-error` instead.
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
      Layer.Layer<ClientFirestore.ClientFirestore | Firestore, never, App.App>
    >();
  });
});
