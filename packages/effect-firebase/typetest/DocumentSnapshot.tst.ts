import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import { Context, Effect, Schema, SchemaGetter, Stream } from "effect";
import { describe, expect, test } from "tstyche";

class User extends FirestoreModel.Class<User>("User")({
  name: Schema.String,
  createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
}) {}

const Users = Collection.make("users", User);

const snapshot = DocumentSnapshot.make(Users.doc(Users.id.make("alice")), undefined);

describe("isExisting", () => {
  test("narrows a Document Snapshot to one that exists, without losing its collection", () => {
    if (DocumentSnapshot.isExisting(snapshot)) {
      expect(snapshot).type.toBe<DocumentSnapshot.Existing<typeof Users>>();
    }
  });

  test("decodes the data of an existing document into the model, failing with a schema error", () => {
    if (DocumentSnapshot.isExisting(snapshot)) {
      expect(snapshot.data).type.toBe<Effect.Effect<User, Schema.SchemaError>>();
    }
  });
});

describe("isMissing", () => {
  test("narrows a Document Snapshot to one that is missing, without losing its collection", () => {
    if (DocumentSnapshot.isMissing(snapshot)) {
      expect(snapshot).type.toBe<DocumentSnapshot.Missing<typeof Users>>();
    }
  });

  test("keeps the id of a missing document typed by its collection", () => {
    if (DocumentSnapshot.isMissing(snapshot)) {
      expect(snapshot.id).type.toBe<Collection.Id<typeof Users>>();
    }
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

const Secrets = Collection.make("secrets", Sealed);

declare const existing: DocumentSnapshot.Existing<typeof Users>;
declare const missing: DocumentSnapshot.Missing<typeof Users>;
declare const reads: Stream.Stream<DocumentSnapshot.DocumentSnapshot<typeof Users>>;
declare const decodedExisting: DocumentSnapshot.DecodedExisting<typeof Users>;
declare const decoded: DocumentSnapshot.DecodedDocumentSnapshot<typeof Users>;

describe("decode", () => {
  test("decodes an existing snapshot into one holding the model's value", () => {
    expect(DocumentSnapshot.decode(existing)).type.toBe<
      Effect.Effect<DocumentSnapshot.DecodedExisting<typeof Users>, Schema.SchemaError>
    >();
  });

  test("keeps a missing snapshot missing, and cannot fail on it", () => {
    expect(DocumentSnapshot.decode(missing)).type.toBe<
      Effect.Effect<DocumentSnapshot.Missing<typeof Users>>
    >();
  });

  test("decodes a snapshot that may be missing into either decoded kind", () => {
    expect(DocumentSnapshot.decode(snapshot)).type.toBe<
      Effect.Effect<DocumentSnapshot.DecodedDocumentSnapshot<typeof Users>, Schema.SchemaError>
    >();
  });

  test("requires the services the model decodes through", () => {
    expect(
      DocumentSnapshot.decode(DocumentSnapshot.make(Secrets.doc(Secrets.id.make("a")), {})),
    ).type.toBe<
      Effect.Effect<
        DocumentSnapshot.DecodedDocumentSnapshot<typeof Secrets>,
        Schema.SchemaError,
        Unseal
      >
    >();
  });

  test("decodes each snapshot of a live read", () => {
    expect(reads.pipe(Stream.mapEffect(DocumentSnapshot.decode))).type.toBe<
      Stream.Stream<DocumentSnapshot.DecodedDocumentSnapshot<typeof Users>, Schema.SchemaError>
    >();
  });
});

describe("DecodedExisting", () => {
  test("holds the decoded data as a value, beside what it was read at", () => {
    expect(decodedExisting.data).type.toBe<User>();
    expect(decodedExisting.raw).type.toBe<unknown>();
    expect(decodedExisting.id).type.toBe<Collection.Id<typeof Users>>();
    expect(decodedExisting.ref).type.toBe<Collection.DocumentReference<typeof Users>>();
  });

  test("is not a Document Snapshot, whose data is still to be decoded", () => {
    expect<DocumentSnapshot.DecodedExisting<typeof Users>>().type.not.toBeAssignableTo<
      DocumentSnapshot.Existing<typeof Users>
    >();
  });
});

describe("DecodedDocumentSnapshot", () => {
  test("narrows by tag to the decoded data", () => {
    if (decoded._tag === "Existing") {
      expect(decoded.data).type.toBe<User>();
    } else {
      expect(decoded).type.toBe<DocumentSnapshot.DecodedMissing<typeof Users>>();
    }
  });
});
