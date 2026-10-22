import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Schema, SchemaGetter } from "effect";
import * as Firestore from "../../src/firestore/Firestore.ts";
import * as Collection from "../../src/firestore/Collection.ts";
import * as FieldValue from "../../src/firestore/FieldValue.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";

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

/** The writes a portable service makes for each collection, never run. */
const writes = (firestore: Firestore.Firestore) => ({
  plain: firestore.setDoc(Plain.doc(Plain.id.make("a")), { title: "x" }),
  stamped: firestore.setDoc(Stamped.doc(Stamped.id.make("a")), {
    title: "x",
    createdAt: FieldValue.serverTimestamp,
  }),
  stampedAdd: firestore.addDoc(Stamped.collection(), {
    title: "x",
    createdAt: FieldValue.serverTimestamp,
  }),
  stampedUpdate: firestore.updateDoc(Stamped.doc(Stamped.id.make("a")), { title: "y" }),
  secret: firestore.setDoc(Secret.doc(Secret.id.make("a")), { token: "t" }),
  secretUpdate: firestore.updateDoc(Secret.doc(Secret.id.make("a")), { token: "t" }),
});
type Writes = ReturnType<typeof writes>;

describe("writes", () => {
  it("ask for nothing when a document encodes on its own", () => {
    expectTypeOf<Effect.Services<Writes["plain"]>>().toEqualTypeOf<never>();
  });

  it("ask for nothing where a document writes a sentinel", () => {
    expectTypeOf<
      Collection.DocumentSchema<typeof Stamped>["create"]["EncodingServices"]
    >().toEqualTypeOf<never>();
    expectTypeOf<Effect.Services<Writes["stamped"]>>().toEqualTypeOf<never>();
    expectTypeOf<Effect.Services<Writes["stampedAdd"]>>().toEqualTypeOf<never>();
    expectTypeOf<Effect.Services<Writes["stampedUpdate"]>>().toEqualTypeOf<never>();
  });

  it("leave anything else the document encodes through to the caller", () => {
    expectTypeOf<Effect.Services<Writes["secret"]>>().toEqualTypeOf<Secrets>();
    expectTypeOf<Effect.Services<Writes["secretUpdate"]>>().toEqualTypeOf<Secrets>();
  });
});

class Profile extends FirestoreModel.Class<Profile>("Profile")({
  name: Schema.String,
  address: FirestoreModel.Optional(FirestoreModel.Struct({ city: Schema.String })),
}) {}

const Profiles = Collection.make("profiles", Profile);

describe("Update", () => {
  it("is checked by default, and takes the model's `update` patch", () => {
    expectTypeOf<Firestore.Update<typeof Profiles>>().toEqualTypeOf<
      (typeof Profile.update)["Type"]
    >();
  });

  it("takes the model's `updateUnchecked` patch in unchecked mode", () => {
    expectTypeOf<Firestore.Update<typeof Profiles, "unchecked">>().toEqualTypeOf<
      (typeof Profile.updateUnchecked)["Type"]
    >();
  });

  it("refuses a patch into an optional struct unless unchecked", () => {
    const patch = { address: { city: "Berlin" } };
    expectTypeOf(patch).not.toExtend<Firestore.Update<typeof Profiles>>();
    expectTypeOf(patch).toExtend<Firestore.Update<typeof Profiles, "unchecked">>();
  });
});

describe("FirestoreError", () => {
  it("carries what went wrong, and the code where there was one", () => {
    const error = new Firestore.FirestoreError({ message: "Failed to read", code: "unavailable" });
    expect(error._tag).toBe("FirestoreError");
    expect(error.message).toBe("Failed to read");
    expect(error.code).toBe("unavailable");
  });
});
