import type * as ClientDocumentSnapshot from "@visiolab/effect-firebase-client/firestore/ClientDocumentSnapshot";
import * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import type * as ClientQuerySnapshot from "@visiolab/effect-firebase-client/firestore/ClientQuerySnapshot";
import * as FirestoreAtom from "@visiolab/effect-firebase-client/firestore/FirestoreAtom";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import type {
  Firestore,
  FirestoreError,
  UndefinedCollectionError,
} from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Context, Duration, Effect, Layer, Schema, SchemaGetter } from "effect";
import type { AsyncResult, Atom } from "effect/reactivity";
import type * as ClientSdk from "firebase/firestore";
import { describe, expect, test } from "tstyche";

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

/** A service a document schema might decode through. */
interface Secrets {
  readonly open: (value: string) => string;
}
const Secrets = Context.Service<Secrets>("test/Secrets");

const Sealed = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformEffect((value: string) =>
      Effect.map(Secrets, (secrets) => secrets.open(value)),
    ),
    encode: SchemaGetter.transform((value: string) => value),
  }),
);

class SecretDoc extends FirestoreModel.Class<SecretDoc>("SecretDoc")({ token: Sealed }) {}

const Secret = Collection.make("secret", SecretDoc);
const sealed = Secret.doc(Secret.id.make("sealed"));

declare const FirestoreLive: Layer.Layer<ClientFirestore.ClientFirestore | Firestore, Error>;
declare const SecretsLive: Layer.Layer<Secrets>;

class Db extends FirestoreAtom.Service<Db>()("test/Db", { layer: FirestoreLive }) {}

class SecretDb extends FirestoreAtom.Service<SecretDb>()("test/SecretDb", {
  layer: () => Layer.merge(FirestoreLive, SecretsLive),
}) {}

describe("FirestoreAtom.Service", () => {
  test("is a Context service for Client Firestore under the app's id", () => {
    expect(
      Db.runtime.atom(
        Effect.gen(function* () {
          const db = yield* Db;
          return db.instance;
        }),
      ),
    ).type.toBe<Atom.Atom<AsyncResult.AsyncResult<ClientSdk.Firestore, never>>>();
  });

  test("its runtime provides the class, Client Firestore and what the layer provides", () => {
    expect(Db.runtime).type.toBe<
      Atom.AtomRuntime<Db | ClientFirestore.ClientFirestore | Firestore>
    >();
    expect(SecretDb.runtime).type.toBe<
      Atom.AtomRuntime<SecretDb | ClientFirestore.ClientFirestore | Firestore | Secrets>
    >();
  });

  test("takes a layer that provides Client Firestore", () => {
    const PortableOnly = FirestoreLive as unknown as Layer.Layer<Firestore>;
    // @ts-expect-error is not assignable
    void FirestoreAtom.Service<Db>()("test/Db", { layer: PortableOnly });
  });
});

describe("FirestoreAtom.Service doc", () => {
  test("holds a decoded client snapshot, failing with FirestoreError or SchemaError", () => {
    expect(Db.doc(hello)).type.toBe<
      Atom.Atom<
        AsyncResult.AsyncResult<
          ClientDocumentSnapshot.DecodedClientDocumentSnapshot<typeof Posts>,
          FirestoreError | Schema.SchemaError
        >
      >
    >();
    expect(Db.doc(hello)).type.toBe<Atom.Atom<FirestoreAtom.DocResult<typeof Posts>>>();
  });

  test("takes a ref whose model's Decoding Services the layer provides", () => {
    expect(SecretDb.doc(sealed)).type.toBe<Atom.Atom<FirestoreAtom.DocResult<typeof Secret>>>();
    // @ts-expect-error the service's layer does not provide
    Db.doc(sealed);
  });
});

describe("FirestoreAtom.Service doc options", () => {
  test("takes the listen options and timeToLive in one flat object", () => {
    expect(
      Db.doc(hello, { source: "cache", includeMetadataChanges: true, timeToLive: "1 minute" }),
    ).type.toBe<Atom.Atom<FirestoreAtom.DocResult<typeof Posts>>>();
    expect(Db.doc(hello, { timeToLive: Infinity })).type.toBe<
      Atom.Atom<FirestoreAtom.DocResult<typeof Posts>>
    >();
    expect(Db.doc(hello, { timeToLive: Duration.minutes(1) })).type.toBe<
      Atom.Atom<FirestoreAtom.DocResult<typeof Posts>>
    >();
    expect(Db.doc(hello, {})).type.toBe<Atom.Atom<FirestoreAtom.DocResult<typeof Posts>>>();
  });

  test("accepts exactly source, includeMetadataChanges and timeToLive", () => {
    expect<FirestoreAtom.ReadAtomOptions>().type.toBe<{
      readonly source?: "default" | "cache" | undefined;
      readonly includeMetadataChanges?: boolean | undefined;
      readonly timeToLive?: Duration.Input | undefined;
    }>();
  });

  test("rejects other sources and unknown options", () => {
    // @ts-expect-error is not assignable
    Db.doc(hello, { source: "server" });
    // @ts-expect-error does not exist in type
    Db.doc(hello, { reactivityKeys: ["posts"] });
  });
});

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Comment extends FirestoreModel.Class<Comment>("Comment")({ body: Schema.String }) {}

const Users = Collection.make("users", User);
const PostComments = Posts.subcollection("comments", Comment);
const UserComments = Users.subcollection("comments", Comment);
const AllComments = CollectionGroup.make(PostComments, UserComments);
const SecretGroup = CollectionGroup.make(Secret);

describe("FirestoreAtom.Service docs", () => {
  test("holds a decoded client query snapshot of a collection, without UndefinedCollectionError", () => {
    expect(Db.docs(Posts.collection())).type.toBe<
      Atom.Atom<
        AsyncResult.AsyncResult<
          ClientQuerySnapshot.DecodedClientQuerySnapshot<typeof Posts>,
          FirestoreError | Schema.SchemaError
        >
      >
    >();
    expect(Db.docs(Posts.collection())).type.toBe<
      Atom.Atom<FirestoreAtom.DocsResult<typeof Posts>>
    >();
  });

  test("holds the union of a group's members, and can fail with UndefinedCollectionError", () => {
    expect(Db.docs(AllComments)).type.toBe<
      Atom.Atom<
        AsyncResult.AsyncResult<
          ClientQuerySnapshot.DecodedClientQuerySnapshot<typeof PostComments | typeof UserComments>,
          FirestoreError | Schema.SchemaError | UndefinedCollectionError
        >
      >
    >();
    expect(Db.docs(AllComments)).type.toBe<
      Atom.Atom<FirestoreAtom.GroupDocsResult<typeof AllComments>>
    >();
  });

  test("types each of a group's documents by the collection it lives in", () => {
    const result = null as unknown as FirestoreAtom.GroupDocsResult<typeof AllComments>;
    if (result._tag === "Success") {
      expect(result.value.docs[0]!.ref).type.toBe<
        | Collection.DocumentReference<typeof PostComments>
        | Collection.DocumentReference<typeof UserComments>
      >();
      expect(result.value.docs[0]!.data).type.toBe<Comment>();
    }
  });

  test("takes the same flat options as doc", () => {
    expect(Db.docs(Posts.collection(), { source: "cache", timeToLive: Infinity })).type.toBe<
      Atom.Atom<FirestoreAtom.DocsResult<typeof Posts>>
    >();
    expect(
      Db.docs(AllComments, { includeMetadataChanges: true, timeToLive: "1 minute" }),
    ).type.toBe<Atom.Atom<FirestoreAtom.GroupDocsResult<typeof AllComments>>>();
    // @ts-expect-error is not assignable
    Db.docs(Posts.collection(), { source: "server" });
  });

  test("takes a collection or group whose models' Decoding Services the layer provides", () => {
    expect(SecretDb.docs(Secret.collection())).type.toBe<
      Atom.Atom<FirestoreAtom.DocsResult<typeof Secret>>
    >();
    expect(SecretDb.docs(SecretGroup)).type.toBe<
      Atom.Atom<FirestoreAtom.GroupDocsResult<typeof SecretGroup>>
    >();
    // @ts-expect-error the service's layer does not provide
    Db.docs(Secret.collection());
    // @ts-expect-error the service's layer does not provide
    Db.docs(SecretGroup);
  });
});
