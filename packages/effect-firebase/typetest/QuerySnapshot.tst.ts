import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import { Context, Effect, Schema, SchemaGetter, Stream } from "effect";
import { describe, expect, test } from "tstyche";

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
}) {}

const Users = Collection.make("users", User);

const alice = DocumentSnapshot.existing(Users.doc(Users.id.make("alice")), { name: "Alice" });
const bob = DocumentSnapshot.existing(Users.doc(Users.id.make("bob")), { name: "Bob" });

/** What an SDK might know about each document it read. */
interface Metadata {
  readonly fromCache: boolean;
}
const carol = DocumentSnapshot.existing(
  Users.doc(Users.id.make("carol")),
  { name: "Carol" },
  { metadata: { fromCache: false } as Metadata },
);

describe("make", () => {
  test("holds the documents of the collection they were read from", () => {
    expect(QuerySnapshot.make([alice, bob])).type.toBe<QuerySnapshot.QuerySnapshot<typeof Users>>();
  });

  test("yields existing Document Snapshots of that collection", () => {
    expect(QuerySnapshot.make([alice, bob]).docs).type.toBe<
      ReadonlyArray<DocumentSnapshot.Existing<typeof Users>>
    >();
  });

  test("keeps the extra its documents carry on each of them", () => {
    expect(QuerySnapshot.make([carol])).type.toBe<
      QuerySnapshot.QuerySnapshot<typeof Users, { metadata: Metadata }>
    >();
    expect(QuerySnapshot.make([carol]).docs[0].metadata).type.toBe<Metadata>();
  });

  test("keeps the read's own extra beside its documents' extra", () => {
    expect(QuerySnapshot.make([carol], { metadata: { fromCache: true } as Metadata })).type.toBe<
      QuerySnapshot.QuerySnapshot<typeof Users, { metadata: Metadata }> & { metadata: Metadata }
    >();
  });
});

class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}
class UserPost extends FirestoreModel.Class<UserPost>("UserPost")({ title: Schema.String }) {}
class OrgPost extends FirestoreModel.Class<OrgPost>("OrgPost")({ headline: Schema.String }) {}

const UserPosts = Users.subcollection("posts", UserPost);
const OrgPosts = Collection.make("orgs", Org).subcollection("posts", OrgPost);

describe("QuerySnapshot", () => {
  test("with no extra holds documents that carry none", () => {
    expect<QuerySnapshot.QuerySnapshot<typeof Users>>().type.toBe<
      QuerySnapshot.QuerySnapshot<typeof Users, {}>
    >();
  });

  test("holds each document with the extra it carries", () => {
    expect<QuerySnapshot.QuerySnapshot<typeof Users, { metadata: Metadata }>["docs"]>().type.toBe<
      ReadonlyArray<DocumentSnapshot.Existing<typeof Users> & { metadata: Metadata }>
    >();
  });

  test("holds each document as a snapshot of the one collection it is in", () => {
    expect<QuerySnapshot.QuerySnapshot<typeof UserPosts | typeof OrgPosts>["docs"]>().type.toBe<
      ReadonlyArray<
        DocumentSnapshot.Existing<typeof UserPosts> | DocumentSnapshot.Existing<typeof OrgPosts>
      >
    >();
  });

  test("of one collection is a Query Snapshot of that collection and others", () => {
    expect<QuerySnapshot.QuerySnapshot<typeof UserPosts>>().type.toBeAssignableTo<
      QuerySnapshot.QuerySnapshot<typeof UserPosts | typeof OrgPosts>
    >();
  });
});

/** A service a document schema decodes through. */
interface Unseal {
  readonly open: (value: string) => string;
}
const Unseal = Context.Service<Unseal>("test/Unseal");

class Sealed extends FirestoreModel.Class<Sealed>("Sealed")({
  token: Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transformEffect((value: string) =>
        Effect.map(Unseal, (unseal) => unseal.open(value)),
      ),
      encode: SchemaGetter.transform((s: string) => s),
    }),
  ),
}) {}

const SealedPosts = Collection.make("orgs", Org).subcollection("posts", Sealed);
const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);

declare const groupRead: QuerySnapshot.QuerySnapshot<CollectionGroup.Members<typeof AllPosts>>;
declare const reads: Stream.Stream<QuerySnapshot.QuerySnapshot<typeof Users>>;
declare const mixed: QuerySnapshot.QuerySnapshot<typeof UserPosts | typeof SealedPosts>;
declare const decodedGroup: QuerySnapshot.DecodedQuerySnapshot<
  CollectionGroup.Members<typeof AllPosts>
>;

describe("decode", () => {
  test("decodes every document of a collection, failing with a schema error", () => {
    expect(QuerySnapshot.decode(QuerySnapshot.make([alice, bob]))).type.toBe<
      Effect.Effect<QuerySnapshot.DecodedQuerySnapshot<typeof Users>, Schema.SchemaError>
    >();
  });

  test("keeps the extra its documents carry on each decoded one", () => {
    expect(QuerySnapshot.decode(QuerySnapshot.make([carol]))).type.toBe<
      Effect.Effect<
        QuerySnapshot.DecodedQuerySnapshot<typeof Users, { metadata: Metadata }>,
        Schema.SchemaError
      >
    >();
  });

  test("decodes the documents of a Collection Group into a union of its members' own", () => {
    expect(QuerySnapshot.decode(groupRead)).type.toBe<
      Effect.Effect<
        QuerySnapshot.DecodedQuerySnapshot<typeof UserPosts | typeof OrgPosts>,
        Schema.SchemaError
      >
    >();
  });

  test("requires the services of every collection it decodes through", () => {
    expect(QuerySnapshot.decode(mixed)).type.toBe<
      Effect.Effect<
        QuerySnapshot.DecodedQuerySnapshot<typeof UserPosts | typeof SealedPosts>,
        Schema.SchemaError,
        Unseal
      >
    >();
  });

  test("decodes each snapshot of a live read", () => {
    expect(reads.pipe(Stream.mapEffect(QuerySnapshot.decode))).type.toBe<
      Stream.Stream<QuerySnapshot.DecodedQuerySnapshot<typeof Users>, Schema.SchemaError>
    >();
  });
});

describe("DecodedQuerySnapshot", () => {
  test("holds each decoded document typed by the one collection it is in", () => {
    expect(decodedGroup.docs).type.toBe<
      ReadonlyArray<
        | DocumentSnapshot.DecodedExisting<typeof UserPosts>
        | DocumentSnapshot.DecodedExisting<typeof OrgPosts>
      >
    >();
  });

  test("holds each document's decoded data as the model's value", () => {
    const doc = decodedGroup.docs[0]!;
    expect(doc.data).type.toBe<UserPost | OrgPost>();
  });
});
