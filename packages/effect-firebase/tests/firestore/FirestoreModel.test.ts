import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as FieldValue from "../../src/firestore/FieldValue.ts";
import { FirestoreEncoder } from "../../src/firestore/FirestoreEncoder.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";
import * as Timestamp from "../../src/firestore/Timestamp.ts";

/** Stands in for an SDK's own `Timestamp`. */
class SdkTimestamp implements Timestamp.TimestampLike {
  constructor(
    readonly seconds: number,
    readonly nanoseconds: number,
  ) {}
}

/** Stands in for an SDK's own sentinel. */
class SdkServerTimestamp {}

const encoder = Layer.succeed(FirestoreEncoder)(
  FirestoreEncoder.of({
    timestamp: (value) => new SdkTimestamp(value.seconds, value.nanoseconds),
    serverTimestamp: () => new SdkServerTimestamp(),
  }),
);

class User extends FirestoreModel.Class<User>("User")({
  displayName: Schema.String,
  signupSource: FirestoreModel.Immutable(Schema.String),
  plan: FirestoreModel.FieldOnly(["read"])(Schema.Literals(["free", "paid"])),
  // Stamped when the document is added and not moved after. Written out by
  // hand, since there is no named field for the shape yet.
  createdAt: FirestoreModel.Field({
    read: FirestoreSchema.Timestamp,
    create: FirestoreSchema.TimestampOrServer,
  }),
  updatedAt: FirestoreModel.Timestamp,
}) {}

/** The shape a snapshot hands back, which is only ever known at runtime. */
const read = (overrides?: Partial<Record<string, unknown>>): unknown => ({
  displayName: "alice",
  signupSource: "web",
  plan: "free",
  createdAt: new SdkTimestamp(1_700_000_000, 0),
  updatedAt: new SdkTimestamp(1_700_000_001, 0),
  ...overrides,
});

describe("Class", () => {
  it("holds one field set per operation", () => {
    expect(Object.keys(User.read.fields).sort()).toEqual([
      "createdAt",
      "displayName",
      "plan",
      "signupSource",
      "updatedAt",
    ]);
    // What is only ever read is not written, and what is written once is not
    // written again.
    expect(Object.keys(User.create.fields).sort()).toEqual([
      "createdAt",
      "displayName",
      "signupSource",
      "updatedAt",
    ]);
    expect(Object.keys(User.update.fields).sort()).toEqual(["displayName", "updatedAt"]);
  });

  it.effect("decodes a snapshot into the class itself", () =>
    Effect.gen(function* () {
      const user = yield* Schema.decodeUnknownEffect(User)(read());
      expect(user).toBeInstanceOf(User);
      expect(user.displayName).toBe("alice");
      expect(Timestamp.isTimestamp(user.createdAt)).toBe(true);
      expect(user.createdAt.seconds).toBe(1_700_000_000);
    }),
  );

  it.effect("reads a document without an encoder at all", () =>
    Effect.gen(function* () {
      expectTypeOf<(typeof User)["DecodingServices"]>().toEqualTypeOf<never>();
      const user = yield* Schema.decodeUnknownEffect(User)(read());
      expect(user.plan).toBe("free");
    }),
  );

  it("keeps the methods a subclass adds", () => {
    class Account extends FirestoreModel.Class<Account>("Account")({
      name: Schema.String,
    }) {
      get shout() {
        return this.name.toUpperCase();
      }
    }
    expect(new Account({ name: "bob" }).shout).toBe("BOB");
    expect(Schema.decodeSync(Account)({ name: "bob" })).toBeInstanceOf(Account);
  });
});

describe("create", () => {
  it.effect("writes the sentinel it was handed", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.create)(
        User.create.make({
          displayName: "alice",
          signupSource: "web",
          createdAt: FieldValue.serverTimestamp,
          updatedAt: FieldValue.serverTimestamp,
        }),
      );
      expect(encoded.createdAt).toBeInstanceOf(SdkServerTimestamp);
      expect(encoded.updatedAt).toBeInstanceOf(SdkServerTimestamp);
      expect(encoded.displayName).toBe("alice");
      expect("plan" in encoded).toBe(false);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes an instant instead, where it was handed one", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.create)(
        User.create.make({
          displayName: "alice",
          signupSource: "web",
          createdAt: Timestamp.makeUnsafe(1_700_000_000, 0),
          updatedAt: FieldValue.serverTimestamp,
        }),
      );
      expect(encoded.createdAt).toBeInstanceOf(SdkTimestamp);
      expect(encoded.updatedAt).toBeInstanceOf(SdkServerTimestamp);
    }).pipe(Effect.provide(encoder)),
  );

  it("asks for an encoder to write", () => {
    expectTypeOf<(typeof User.create)["EncodingServices"]>().toEqualTypeOf<FirestoreEncoder>();
  });

  it("refuses a field it only ever reads", () => {
    User.create.make({
      displayName: "alice",
      signupSource: "web",
      createdAt: FieldValue.serverTimestamp,
      updatedAt: FieldValue.serverTimestamp,
      // @ts-expect-error `plan` is only ever read
      plan: "paid",
    });
  });
});

describe("update", () => {
  it("makes every field it carries optional", () => {
    expectTypeOf<(typeof User.update)["Type"]>().toEqualTypeOf<{
      readonly displayName?: string;
      readonly updatedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
    }>();
  });

  it.effect("writes only the fields it was handed", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.update)(
        User.update.make({ displayName: "alice in chains" }),
      );
      expect(Object.keys(encoded)).toEqual(["displayName"]);
      expect(encoded.displayName).toBe("alice in chains");
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("leaves the time to the server where it is handed the sentinel", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.update)(
        User.update.make({ updatedAt: FieldValue.serverTimestamp }),
      );
      expect(Object.keys(encoded)).toEqual(["updatedAt"]);
      expect(encoded.updatedAt).toBeInstanceOf(SdkServerTimestamp);
    }).pipe(Effect.provide(encoder)),
  );

  it("refuses a field that is written once", () => {
    // @ts-expect-error `signupSource` cannot be changed after creation
    User.update.make({ signupSource: "ios" });
  });
});

describe("fields", () => {
  it("carries a group through every variant", () => {
    const Address = FirestoreModel.Struct({
      city: Schema.String,
      verifiedAt: FirestoreModel.FieldOnly(["read"])(Schema.String),
    });

    class Place extends FirestoreModel.Class<Place>("Place")({
      name: Schema.String,
      address: Address,
    }) {}

    expect(Object.keys(Place.read.fields.address.fields).sort()).toEqual(["city", "verifiedAt"]);
    expect(Object.keys(Place.create.fields.address.fields)).toEqual(["city"]);
  });

  it("holds a field only the named variants see", () => {
    const field = FirestoreModel.FieldOnly(["create"])(Schema.String);
    expect(Object.keys(field.schemas)).toEqual(["create"]);
  });

  it("hands back the definitions it was built from", () => {
    expect(Object.keys(FirestoreModel.fields(User)).sort()).toEqual([
      "createdAt",
      "displayName",
      "plan",
      "signupSource",
      "updatedAt",
    ]);
  });
});

describe("fields", () => {
  it("carries a group through every variant", () => {
    const Address = FirestoreModel.Struct({
      city: Schema.String,
      verifiedAt: FirestoreModel.FieldOnly(["read"])(Schema.String),
    });

    class Place extends FirestoreModel.Class<Place>("Place")({
      name: Schema.String,
      address: Address,
    }) {}

    expect(Object.keys(Place.read.fields.address.fields).sort()).toEqual(["city", "verifiedAt"]);
    expect(Object.keys(Place.create.fields.address.fields)).toEqual(["city"]);
  });

  it("holds a field only the named variants see", () => {
    const field = FirestoreModel.FieldOnly(["create"])(Schema.String);
    expect(Object.keys(field.schemas)).toEqual(["create"]);
  });

  it("hands back the definitions it was built from", () => {
    expect(Object.keys(FirestoreModel.fields(User)).sort()).toEqual([
      "createdAt",
      "displayName",
      "plan",
      "signupSource",
      "updatedAt",
    ]);
  });
});

describe("a field written either way", () => {
  /** Reads as a timestamp, and is written as one or left to the server. */
  class Event extends FirestoreModel.Class<Event>("Event")({
    name: Schema.String,
    occurredAt: FirestoreModel.Timestamp,
  }) {}

  it("keeps the encoder it asks for, rather than widening to unknown", () => {
    expectTypeOf<(typeof Event.create)["EncodingServices"]>().toEqualTypeOf<FirestoreEncoder>();
  });

  it.effect("writes the instant this client picked", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Event.create)(
        Event.create.make({ name: "a", occurredAt: Timestamp.makeUnsafe(1, 2) }),
      );
      expect(encoded.occurredAt).toBeInstanceOf(SdkTimestamp);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes the one the server picks", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Event.update)(
        Event.update.make({ occurredAt: FieldValue.serverTimestamp }),
      );
      expect(encoded.occurredAt).toBeInstanceOf(SdkServerTimestamp);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("reads back as a timestamp either way", () =>
    Effect.gen(function* () {
      const event = yield* Schema.decodeUnknownEffect(Event)({
        name: "a",
        occurredAt: new SdkTimestamp(1, 2),
      } as unknown);
      expect(Timestamp.isTimestamp(event.occurredAt)).toBe(true);
    }),
  );
});
