import * as ClientDocumentSnapshot from "@visiolab/effect-firebase-client/firestore/ClientDocumentSnapshot";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Schema } from "effect";
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
