import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Schema, SchemaGetter } from "effect";
import * as Firestore from "../../src/firestore/Firestore.ts";
import * as Collection from "../../src/firestore/Collection.ts";
import { FirestoreEncoder } from "../../src/firestore/FirestoreEncoder.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";

/** A service a document schema might encode through that is not the encoder. */
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

describe("WriteServices", () => {
  it("asks for nothing when a document encodes on its own", () => {
    expectTypeOf<Firestore.WriteServices<typeof Plain>>().toEqualTypeOf<never>();
  });

  it("answers for the encoder itself, since an implementation has one", () => {
    expectTypeOf<
      Collection.DocumentSchema<typeof Stamped>["create"]["EncodingServices"]
    >().toEqualTypeOf<FirestoreEncoder>();
    expectTypeOf<Firestore.WriteServices<typeof Stamped>>().toEqualTypeOf<never>();
  });

  it("leaves anything else the document encodes through to the caller", () => {
    expectTypeOf<Firestore.WriteServices<typeof Secret>>().toEqualTypeOf<Secrets>();
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
