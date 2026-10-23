import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import * as Firestore from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import { Context, Effect, Schema, SchemaGetter } from "effect";
import { describe, expect, test } from "tstyche";

/** A service a document schema might encode through. */
interface Secrets {
  readonly seal: (value: string) => string;
}
const Secrets = Context.Service<Secrets>("test/Secrets");

const Sealed = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((s: string) => s),
    encode: SchemaGetter.transformEffect((value: string) =>
      Effect.map(Secrets, (secrets) => secrets.seal(value)),
    ),
  }),
);

class PlainDoc extends FirestoreModel.Class<PlainDoc>("PlainDoc")({ title: Schema.String }) {}
class StampedDoc extends FirestoreModel.Class<StampedDoc>("StampedDoc")({
  title: Schema.String,
  createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
}) {}
class SecretDoc extends FirestoreModel.Class<SecretDoc>("SecretDoc")({ token: Sealed }) {}

const Plain = Collection.make("plain", PlainDoc);
const Stamped = Collection.make("stamped", StampedDoc);
const Secret = Collection.make("secret", SecretDoc);

declare const firestore: Firestore.Firestore;

const plainSet = firestore.setDoc(Plain.doc(Plain.id.make("a")), { title: "x" });
const stampedSet = firestore.setDoc(Stamped.doc(Stamped.id.make("a")), {
  title: "x",
  createdAt: FieldValue.serverTimestamp,
});
const stampedAdd = firestore.addDoc(Stamped.collection(), {
  title: "x",
  createdAt: FieldValue.serverTimestamp,
});
const stampedUpdate = firestore.updateDoc(Stamped.doc(Stamped.id.make("a")), { title: "y" });
const secretSet = firestore.setDoc(Secret.doc(Secret.id.make("a")), { token: "t" });
const secretUpdate = firestore.updateDoc(Secret.doc(Secret.id.make("a")), { token: "t" });

describe("DocumentSchema", () => {
  test("encodes a sentinel in the `create` shape without asking for a service", () => {
    expect<
      Collection.DocumentSchema<typeof Stamped>["create"]["EncodingServices"]
    >().type.toBe<never>();
  });
});

describe("setDoc", () => {
  test("asks for nothing when a document encodes on its own", () => {
    expect<Effect.Services<typeof plainSet>>().type.toBe<never>();
  });

  test("asks for nothing where a document writes a sentinel", () => {
    expect<Effect.Services<typeof stampedSet>>().type.toBe<never>();
  });

  test("leaves anything else the document encodes through to the caller", () => {
    expect<Effect.Services<typeof secretSet>>().type.toBe<Secrets>();
  });
});

describe("addDoc", () => {
  test("asks for nothing where a document writes a sentinel", () => {
    expect<Effect.Services<typeof stampedAdd>>().type.toBe<never>();
  });
});

describe("updateDoc", () => {
  test("asks for nothing where a document writes a sentinel", () => {
    expect<Effect.Services<typeof stampedUpdate>>().type.toBe<never>();
  });

  test("leaves anything else the document encodes through to the caller", () => {
    expect<Effect.Services<typeof secretUpdate>>().type.toBe<Secrets>();
  });
});

class Profile extends FirestoreModel.Class<Profile>("Profile")({
  name: Schema.String,
  address: FirestoreModel.Optional(FirestoreModel.Struct({ city: Schema.String })),
}) {}

const Profiles = Collection.make("profiles", Profile);

const patch = { address: { city: "Berlin" } };

describe("Update", () => {
  test("is checked by default, and takes the model's `update` patch", () => {
    expect<Firestore.Update<typeof Profiles>>().type.toBe<(typeof Profile.update)["Type"]>();
  });

  test("takes the model's `updateUnchecked` patch in unchecked mode", () => {
    expect<Firestore.Update<typeof Profiles, "unchecked">>().type.toBe<
      (typeof Profile.updateUnchecked)["Type"]
    >();
  });

  test("refuses a patch into an optional struct when checked", () => {
    expect(patch).type.not.toBeAssignableTo<Firestore.Update<typeof Profiles>>();
  });

  test("accepts a patch into an optional struct when unchecked", () => {
    expect(patch).type.toBeAssignableTo<Firestore.Update<typeof Profiles, "unchecked">>();
  });
});
