import type * as ClientDocumentSnapshot from "@visiolab/effect-firebase-client/firestore/ClientDocumentSnapshot";
import * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import * as FirestoreAtom from "@visiolab/effect-firebase-client/firestore/FirestoreAtom";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type { Firestore, FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Context, Effect, Layer, Schema, SchemaGetter } from "effect";
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
