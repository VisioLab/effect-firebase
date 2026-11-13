import * as ClientDocumentSnapshot from "@visiolab/effect-firebase-client/firestore/ClientDocumentSnapshot";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { type Effect, Schema, Stream } from "effect";
import { describe, expect, test } from "tstyche";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);

describe("SnapshotMetadata", () => {
  test("tells whether the read came from the cache and whether writes are pending", () => {
    expect<ClientDocumentSnapshot.SnapshotMetadata>().type.toBe<{
      readonly fromCache: boolean;
      readonly hasPendingWrites: boolean;
    }>();
  });
});

describe("Existing", () => {
  test("is an existing Document Snapshot as well", () => {
    expect<ClientDocumentSnapshot.Existing<typeof Posts>>().type.toBeAssignableTo<
      DocumentSnapshot.Existing<typeof Posts>
    >();
  });
});

describe("Missing", () => {
  test("is a missing Document Snapshot as well", () => {
    expect<ClientDocumentSnapshot.Missing<typeof Posts>>().type.toBeAssignableTo<
      DocumentSnapshot.Missing<typeof Posts>
    >();
  });
});

describe("ClientDocumentSnapshot", () => {
  test("is a Document Snapshot as well", () => {
    expect<ClientDocumentSnapshot.ClientDocumentSnapshot<typeof Posts>>().type.toBeAssignableTo<
      DocumentSnapshot.DocumentSnapshot<typeof Posts>
    >();
  });
});

declare const existing: ClientDocumentSnapshot.Existing<typeof Posts>;
declare const missing: ClientDocumentSnapshot.Missing<typeof Posts>;
declare const snapshot: ClientDocumentSnapshot.ClientDocumentSnapshot<typeof Posts>;
declare const reads: Stream.Stream<ClientDocumentSnapshot.ClientDocumentSnapshot<typeof Posts>>;
declare const decodedExisting: ClientDocumentSnapshot.DecodedExisting<typeof Posts>;

describe("decode", () => {
  test("decodes an existing snapshot into one that keeps its metadata", () => {
    expect(ClientDocumentSnapshot.decode(existing)).type.toBe<
      Effect.Effect<ClientDocumentSnapshot.DecodedExisting<typeof Posts>, Schema.SchemaError>
    >();
  });

  test("keeps a missing snapshot missing, with its metadata", () => {
    expect(ClientDocumentSnapshot.decode(missing)).type.toBe<
      Effect.Effect<ClientDocumentSnapshot.Missing<typeof Posts>>
    >();
  });

  test("decodes a snapshot that may be missing into either decoded kind", () => {
    expect(ClientDocumentSnapshot.decode(snapshot)).type.toBe<
      Effect.Effect<
        ClientDocumentSnapshot.DecodedClientDocumentSnapshot<typeof Posts>,
        Schema.SchemaError
      >
    >();
  });

  test("decodes each snapshot of a live read", () => {
    expect(reads.pipe(Stream.mapEffect(ClientDocumentSnapshot.decode))).type.toBe<
      Stream.Stream<
        ClientDocumentSnapshot.DecodedClientDocumentSnapshot<typeof Posts>,
        Schema.SchemaError
      >
    >();
  });
});

describe("DecodedExisting", () => {
  test("holds the decoded data and the metadata of the read", () => {
    expect(decodedExisting.data).type.toBe<Post>();
    expect(decodedExisting.metadata).type.toBe<ClientDocumentSnapshot.SnapshotMetadata>();
  });

  test("is a decoded existing Document Snapshot as well", () => {
    expect<ClientDocumentSnapshot.DecodedExisting<typeof Posts>>().type.toBeAssignableTo<
      DocumentSnapshot.DecodedExisting<typeof Posts>
    >();
  });
});

describe("DecodedClientDocumentSnapshot", () => {
  test("is a decoded Document Snapshot as well, with metadata on either kind", () => {
    expect<
      ClientDocumentSnapshot.DecodedClientDocumentSnapshot<typeof Posts>
    >().type.toBeAssignableTo<DocumentSnapshot.DecodedDocumentSnapshot<typeof Posts>>();
    expect<
      ClientDocumentSnapshot.DecodedClientDocumentSnapshot<typeof Posts>["metadata"]
    >().type.toBe<ClientDocumentSnapshot.SnapshotMetadata>();
  });
});
