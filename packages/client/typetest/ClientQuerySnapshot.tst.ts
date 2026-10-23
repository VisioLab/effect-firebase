import * as ClientQuerySnapshot from "@visiolab/effect-firebase-client/firestore/ClientQuerySnapshot";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import { Schema } from "effect";
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
