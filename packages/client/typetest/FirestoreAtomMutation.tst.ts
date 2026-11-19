import type * as ClientFirestore from "@visiolab/effect-firebase-client/firestore/ClientFirestore";
import * as FirestoreAtom from "@visiolab/effect-firebase-client/firestore/FirestoreAtom";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import type {
  Create,
  Firestore,
  FirestoreError,
} from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import { Context, Effect, Layer, Schema, SchemaGetter } from "effect";
import type { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, test } from "tstyche";

class Profile extends FirestoreModel.Class<Profile>("Profile")({
  name: Schema.String,
  address: FirestoreModel.Optional(FirestoreModel.Struct({ city: Schema.String })),
}) {}

const Profiles = Collection.make("profiles", Profile);
const ada = Profiles.doc(Profiles.id.make("ada"));

/** A service a document schema might encode through. */
interface Secrets {
  readonly seal: (value: string) => string;
}
const Secrets = Context.Service<Secrets>("test/Secrets");

const Sealed = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((value: string) => value),
    encode: SchemaGetter.transformEffect((value: string) =>
      Effect.map(Secrets, (secrets) => secrets.seal(value)),
    ),
  }),
);

class SecretDoc extends FirestoreModel.Class<SecretDoc>("SecretDoc")({ token: Sealed }) {}

const Secret = Collection.make("secret", SecretDoc);
const sealed = Secret.doc(Secret.id.make("sealed"));

const AllProfiles = CollectionGroup.make(Profiles);

declare const FirestoreLive: Layer.Layer<ClientFirestore.ClientFirestore | Firestore, WriteError>;
declare const SecretsLive: Layer.Layer<Secrets>;

class Db extends FirestoreAtom.Service<Db>()("test/Db", { layer: FirestoreLive }) {}

class SecretDb extends FirestoreAtom.Service<SecretDb>()("test/SecretDb", {
  layer: Layer.merge(FirestoreLive, SecretsLive),
}) {}

type WriteError = FirestoreError | Schema.SchemaError;

declare const registry: AtomRegistry.AtomRegistry;

describe("FirestoreAtom.Service setDoc", () => {
  test("takes the document and succeeds with void", () => {
    expect(Db.setDoc(ada)).type.toBe<
      Atom.AtomResultFn<{ readonly data: Create<typeof Profiles> }, void, WriteError>
    >();
    expect(Db.setDoc(ada)).type.toBe<
      Atom.AtomResultFn<FirestoreAtom.CreateArg<typeof Profiles>, void, WriteError>
    >();
  });

  test("takes a ref whose model's Encoding Services the layer provides", () => {
    expect(SecretDb.setDoc(sealed)).type.toBe<
      Atom.AtomResultFn<FirestoreAtom.CreateArg<typeof Secret>, void, WriteError>
    >();
    // @ts-expect-error the service's layer does not provide
    Db.setDoc(sealed);
  });
});

describe("FirestoreAtom.Service updateDoc", () => {
  test("takes a patch and succeeds with void", () => {
    expect(Db.updateDoc(ada)).type.toBe<
      Atom.AtomResultFn<FirestoreAtom.UpdateArg<typeof Profiles>, void, WriteError>
    >();
  });

  test("narrows the patch by mode, checked by default", () => {
    expect({ data: { name: "Ada" } }).type.toBeAssignableTo<
      FirestoreAtom.UpdateArg<typeof Profiles>
    >();
    expect({
      data: { address: { city: "Berlin" } },
      mode: "unchecked" as const,
    }).type.toBeAssignableTo<FirestoreAtom.UpdateArg<typeof Profiles>>();
    expect({
      data: { address: { city: "Berlin" } },
      mode: "checked" as const,
    }).type.not.toBeAssignableTo<FirestoreAtom.UpdateArg<typeof Profiles>>();
  });

  test("refuses an unchecked patch without mode: unchecked", () => {
    // @ts-expect-error is not assignable
    registry.set(Db.updateDoc(ada), { data: { address: { city: "Berlin" } } });
  });

  test("takes a ref whose model's Encoding Services the layer provides", () => {
    expect(SecretDb.updateDoc(sealed)).type.toBe<
      Atom.AtomResultFn<FirestoreAtom.UpdateArg<typeof Secret>, void, WriteError>
    >();
    // @ts-expect-error the service's layer does not provide
    Db.updateDoc(sealed);
  });
});

describe("FirestoreAtom.Service addDoc", () => {
  test("takes the document and succeeds with its new ref", () => {
    expect(Db.addDoc(Profiles.collection())).type.toBe<
      Atom.AtomResultFn<
        FirestoreAtom.CreateArg<typeof Profiles>,
        Collection.DocumentReference<typeof Profiles>,
        WriteError
      >
    >();
  });

  test("takes a collection whose model's Encoding Services the layer provides", () => {
    expect(SecretDb.addDoc(Secret.collection())).type.toBe<
      Atom.AtomResultFn<
        FirestoreAtom.CreateArg<typeof Secret>,
        Collection.DocumentReference<typeof Secret>,
        WriteError
      >
    >();
    // @ts-expect-error the service's layer does not provide
    Db.addDoc(Secret.collection());
  });
});

describe("FirestoreAtom.Service mutation atoms on Collection Groups", () => {
  test("do not exist", () => {
    // @ts-expect-error is not assignable
    Db.addDoc(AllProfiles);
  });
});
