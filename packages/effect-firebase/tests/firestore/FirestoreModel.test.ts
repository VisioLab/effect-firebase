import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Schema } from "effect";
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

/** Stands in for an SDK's own sentinel, which carries what it is to add. */
class SdkIncrement {
  constructor(readonly by: number) {}
}

const encoder = Layer.succeed(FirestoreEncoder)(
  FirestoreEncoder.of({
    timestamp: (value) => new SdkTimestamp(value.seconds, value.nanoseconds),
    serverTimestamp: () => new SdkServerTimestamp(),
    increment: (by) => new SdkIncrement(by),
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
    create: FirestoreSchema.ServerTimestampOr(FirestoreSchema.Timestamp),
  }),
  updatedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
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
    occurredAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
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

  it.effect("holds the instant the way the schema it was handed does", () =>
    Effect.gen(function* () {
      class Visit extends FirestoreModel.Class<Visit>("Visit")({
        seenAt: FirestoreModel.Timestamp(FirestoreSchema.DateTimeUtcFromTimestamp),
      }) {}

      const visit = yield* Schema.decodeEffect(Visit)({
        seenAt: new SdkTimestamp(1_700_000_000, 123_000_000),
      });
      expect(visit.seenAt).toStrictEqual(DateTime.makeUnsafe(1_700_000_000_123));

      const stamped = yield* Schema.encodeEffect(Visit.update)(
        Visit.update.make({ seenAt: DateTime.makeUnsafe(1_700_000_000_123) }),
      );
      expect(stamped.seenAt).toBeInstanceOf(SdkTimestamp);

      const left = yield* Schema.encodeEffect(Visit.update)(
        Visit.update.make({ seenAt: FieldValue.serverTimestamp }),
      );
      expect(left.seenAt).toBeInstanceOf(SdkServerTimestamp);
    }).pipe(Effect.provide(encoder)),
  );
});

describe("Number", () => {
  /** Reads as a number, and is written as one or moved by the server. */
  class Page extends FirestoreModel.Class<Page>("Page")({
    slug: Schema.String,
    visits: FirestoreModel.Number(Schema.Int),
  }) {}

  it("takes a number or a move in the writes, and a number alone in the read", () => {
    expectTypeOf<(typeof Page)["Type"]["visits"]>().toEqualTypeOf<number>();
    expectTypeOf<(typeof Page.update)["Type"]>().toEqualTypeOf<{
      readonly slug?: string;
      readonly visits?: number | FieldValue.Increment;
    }>();
  });

  it.effect("sets the number outright where it was handed one", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.create)(
        Page.create.make({ slug: "home", visits: 0 }),
      );
      expect(encoded.visits).toBe(0);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("leaves the sum to the server where it was handed a move", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.increment(1) }),
      );
      expect(Object.keys(encoded)).toEqual(["visits"]);
      expect(encoded.visits).toBeInstanceOf(SdkIncrement);
      expect((encoded.visits as SdkIncrement).by).toBe(1);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("counts down just as readily", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.decrement(2) }),
      );
      expect((encoded.visits as SdkIncrement).by).toBe(-2);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("reads back as the number the server wrote", () =>
    Effect.gen(function* () {
      const page = yield* Schema.decodeUnknownEffect(Page)({ slug: "home", visits: 12 } as unknown);
      expect(page.visits).toBe(12);
    }),
  );

  it("refuses a move where only a number is read", () => {
    expect(
      () =>
        // @ts-expect-error a document holds the sum rather than the request to add
        new Page({ slug: "home", visits: FieldValue.increment(1) }),
    ).toThrow();
  });

  it.effect("holds the schema it was handed in every variant", () =>
    Effect.gen(function* () {
      // `Schema.Int` is the caller's, so a fraction is refused reading a
      // document and writing one alike - the write as early as the constructor.
      expect(
        yield* Effect.flip(Schema.decodeEffect(Page)({ slug: "a", visits: 1.5 })),
      ).toBeDefined();
      expect(() => Page.update.make({ visits: 1.5 })).toThrow();
    }),
  );

  it.effect("adds up fractions where the schema it was handed does", () =>
    Effect.gen(function* () {
      class Account extends FirestoreModel.Class<Account>("Account")({
        balance: FirestoreModel.Number(Schema.Finite),
      }) {}

      const encoded = yield* Schema.encodeEffect(Account.update)(
        Account.update.make({ balance: FieldValue.increment(0.5) }),
      );
      expect((encoded.balance as SdkIncrement).by).toBe(0.5);
      expect(yield* Schema.decodeEffect(Account)({ balance: 1.5 })).toMatchObject({
        balance: 1.5,
      });
    }).pipe(Effect.provide(encoder)),
  );
});

describe("Number", () => {
  /** Reads as a number, and is written as one or moved by the server. */
  class Page extends FirestoreModel.Class<Page>("Page")({
    slug: Schema.String,
    visits: FirestoreModel.Number(Schema.Int),
  }) {}

  it("takes a number or a move in the writes, and a number alone in the read", () => {
    expectTypeOf<(typeof Page)["Type"]["visits"]>().toEqualTypeOf<number>();
    expectTypeOf<(typeof Page.update)["Type"]>().toEqualTypeOf<{
      readonly slug?: string;
      readonly visits?: number | FieldValue.Increment;
    }>();
  });

  it.effect("sets the number outright where it was handed one", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.create)(
        Page.create.make({ slug: "home", visits: 0 }),
      );
      expect(encoded.visits).toBe(0);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("leaves the sum to the server where it was handed a move", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.increment(1) }),
      );
      expect(Object.keys(encoded)).toEqual(["visits"]);
      expect(encoded.visits).toBeInstanceOf(SdkIncrement);
      expect((encoded.visits as SdkIncrement).by).toBe(1);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("counts down just as readily", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.decrement(2) }),
      );
      expect((encoded.visits as SdkIncrement).by).toBe(-2);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("reads back as the number the server wrote", () =>
    Effect.gen(function* () {
      const page = yield* Schema.decodeUnknownEffect(Page)({ slug: "home", visits: 12 } as unknown);
      expect(page.visits).toBe(12);
    }),
  );

  it("refuses a move where only a number is read", () => {
    expect(
      () =>
        // @ts-expect-error a document holds the sum rather than the request to add
        new Page({ slug: "home", visits: FieldValue.increment(1) }),
    ).toThrow();
  });

  it("is only built from a schema stored as a number", () => {
    // @ts-expect-error the server has no number to add to
    FirestoreModel.Number(Schema.Boolean);
    expectTypeOf<
      // @ts-expect-error the type is held to the same as the constructor
      FirestoreModel.Number<Schema.Boolean>
    >().not.toBeNever();
  });

  it.effect("holds the schema it was handed in every variant", () =>
    Effect.gen(function* () {
      // `Schema.Int` is the caller's, so a fraction is refused reading a
      // document and writing one alike - the write as early as the constructor.
      expect(
        yield* Effect.flip(Schema.decodeEffect(Page)({ slug: "a", visits: 1.5 })),
      ).toBeDefined();
      expect(() => Page.update.make({ visits: 1.5 })).toThrow();
    }),
  );

  it.effect("adds up fractions where the schema it was handed does", () =>
    Effect.gen(function* () {
      class Account extends FirestoreModel.Class<Account>("Account")({
        balance: FirestoreModel.Number(Schema.Finite),
      }) {}

      const encoded = yield* Schema.encodeEffect(Account.update)(
        Account.update.make({ balance: FieldValue.increment(0.5) }),
      );
      expect((encoded.balance as SdkIncrement).by).toBe(0.5);
      expect(yield* Schema.decodeEffect(Account)({ balance: 1.5 })).toMatchObject({
        balance: 1.5,
      });
    }).pipe(Effect.provide(encoder)),
  );
});
