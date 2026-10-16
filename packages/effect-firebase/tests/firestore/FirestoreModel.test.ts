import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { DateTime, Effect, Exit, Layer, Schema } from "effect";
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

/** Stands in for an SDK's own sentinel. */
class SdkDeleteField {}

const encoder = Layer.succeed(FirestoreEncoder)(
  FirestoreEncoder.of({
    timestamp: (value) => new SdkTimestamp(value.seconds, value.nanoseconds),
    serverTimestamp: () => new SdkServerTimestamp(),
    increment: (by) => new SdkIncrement(by),
    deleteField: () => new SdkDeleteField(),
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
    expect(Object.keys(User.update.from.fields).sort()).toEqual(["displayName", "updatedAt"]);
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

describe("Optional", () => {
  /** A profile that may go without a nickname or a time last seen. */
  class Profile extends FirestoreModel.Class<Profile>("Profile")({
    name: Schema.String,
    nickname: FirestoreModel.Optional(Schema.String),
    lastSeenAt: FirestoreModel.Optional(FirestoreModel.Timestamp(FirestoreSchema.Timestamp)),
    invitedBy: FirestoreModel.Optional(FirestoreModel.Immutable(Schema.String)),
  }) {}

  it("is an optional key where read and created, and removable where updated", () => {
    expectTypeOf<(typeof Profile)["Type"]["nickname"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<(typeof Profile.create)["Type"]>().toEqualTypeOf<{
      readonly name: string;
      readonly nickname?: string;
      readonly lastSeenAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
      readonly invitedBy?: string;
    }>();
    expectTypeOf<(typeof Profile.update)["Type"]>().toEqualTypeOf<{
      readonly name?: string;
      readonly nickname?: string | FieldValue.DeleteField;
      readonly lastSeenAt?:
        | Timestamp.Timestamp
        | FieldValue.ServerTimestamp
        | FieldValue.DeleteField;
    }>();
  });

  it.effect("reads a document that goes without the field", () =>
    Effect.gen(function* () {
      const profile = yield* Schema.decodeUnknownEffect(Profile)({ name: "alice" } as unknown);
      expect(profile.nickname).toBeUndefined();
      expect("nickname" in profile).toBe(false);
    }),
  );

  it.effect("reads one that holds it", () =>
    Effect.gen(function* () {
      const profile = yield* Schema.decodeUnknownEffect(Profile)({
        name: "alice",
        nickname: "ally",
        lastSeenAt: new SdkTimestamp(1, 2),
      } as unknown);
      expect(profile.nickname).toBe("ally");
      expect(Timestamp.isTimestamp(profile.lastSeenAt)).toBe(true);
    }),
  );

  it.effect("creates a document without the field", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Profile.create)(
        Profile.create.make({ name: "alice" }),
      );
      expect(encoded).toStrictEqual({ name: "alice" });
    }).pipe(Effect.provide(encoder)),
  );

  it("refuses the sentinel where a document is written whole", () => {
    expect(() =>
      // @ts-expect-error `set` removes a field by leaving it out
      Profile.create.make({ name: "alice", nickname: FieldValue.deleteField }),
    ).toThrow();
  });

  it.effect("removes the field where an update was handed the sentinel", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Profile.update)(
        Profile.update.make({ nickname: FieldValue.deleteField }),
      );
      expect(Object.keys(encoded)).toEqual(["nickname"]);
      expect(encoded.nickname).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("keeps what the field it was handed takes", () =>
    Effect.gen(function* () {
      const stamped = yield* Schema.encodeEffect(Profile.update)(
        Profile.update.make({ lastSeenAt: FieldValue.serverTimestamp }),
      );
      expect(stamped.lastSeenAt).toBeInstanceOf(SdkServerTimestamp);

      const removed = yield* Schema.encodeEffect(Profile.update)(
        Profile.update.make({ lastSeenAt: FieldValue.deleteField }),
      );
      expect(removed.lastSeenAt).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
  );

  it("keeps a field with no update out of the update", () => {
    expect(Object.keys(Profile.update.from.fields).sort()).toEqual([
      "lastSeenAt",
      "name",
      "nickname",
    ]);
  });
});

describe("an update reaching into a group", () => {
  const Geo = FirestoreModel.Struct({
    lat: Schema.Finite,
    lng: Schema.Finite,
  });

  const Address = FirestoreModel.Struct({
    city: Schema.String,
    country: FirestoreModel.Immutable(Schema.String),
    nickname: FirestoreModel.Optional(Schema.String),
    verifiedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
    geo: Geo,
  });

  class Place extends FirestoreModel.Class<Place>("Place")({
    name: Schema.String,
    visits: FirestoreModel.Number(Schema.Int),
    address: Address,
    // A plain struct is a value, written whole.
    tags: Schema.Struct({ primary: Schema.String }),
  }) {}

  it("takes a nested partial", () => {
    type T = (typeof Place.update)["Type"];
    expectTypeOf<keyof T>().toEqualTypeOf<"name" | "visits" | "address" | "tags">();
    type A = NonNullable<T["address"]>;
    expectTypeOf<keyof A>().toEqualTypeOf<"city" | "nickname" | "verifiedAt" | "geo">();
    expectTypeOf<NonNullable<A["geo"]>>().toEqualTypeOf<{
      readonly lat?: number;
      readonly lng?: number;
    }>();
    expectTypeOf<NonNullable<T["tags"]>>().toEqualTypeOf<{ readonly primary: string }>();
  });

  it.effect("writes each field of a group at its path", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)(
        Place.update.make({
          address: {
            nickname: FieldValue.deleteField,
            verifiedAt: FieldValue.serverTimestamp,
            geo: { lat: 1.5 },
          },
          visits: FieldValue.increment(1),
        }),
      );
      expect(Object.keys(encoded).sort()).toEqual([
        "address.geo.lat",
        "address.nickname",
        "address.verifiedAt",
        "visits",
      ]);
      expect(encoded["address.nickname"]).toBeInstanceOf(SdkDeleteField);
      expect(encoded["address.verifiedAt"]).toBeInstanceOf(SdkServerTimestamp);
      expect(encoded["address.geo.lat"]).toBe(1.5);
      expect(encoded.visits).toBeInstanceOf(SdkIncrement);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes an encoded value and a plain struct whole", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)({
        address: { verifiedAt: Timestamp.makeUnsafe(1, 2) },
        tags: { primary: "cafe" },
      });
      expect(encoded["address.verifiedAt"]).toBeInstanceOf(SdkTimestamp);
      expect(encoded.tags).toStrictEqual({ primary: "cafe" });
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes nothing for a group handed nothing", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)({ address: {} });
      expect(encoded).toStrictEqual({});
    }).pipe(Effect.provide(encoder)),
  );

  it("refuses a field written once, at any depth", () => {
    // @ts-expect-error `country` cannot be changed after creation
    Place.update.make({ address: { country: "FR" } });
  });

  it.effect("is never read back", () =>
    Effect.gen(function* () {
      const exit = yield* Schema.decodeUnknownEffect(Place.update)({ name: "a" }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it("writes at paths it names in its encoded type", () => {
    expectTypeOf<keyof (typeof Place.update)["Encoded"]>().toEqualTypeOf<
      | "name"
      | "visits"
      | "address.city"
      | "address.nickname"
      | "address.verifiedAt"
      | "address.geo.lat"
      | "address.geo.lng"
      | "tags"
    >();
    expectTypeOf<(typeof Place.update)["Encoded"]["address.city"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<(typeof Place.update)["Encoded"]["address.geo.lat"]>().toEqualTypeOf<
      number | undefined
    >();
    expect(Object.keys(Place.update.from.fields).sort()).toEqual([
      "address.city",
      "address.geo.lat",
      "address.geo.lng",
      "address.nickname",
      "address.verifiedAt",
      "name",
      "tags",
      "visits",
    ]);
  });

  it("refuses a field name a path would read as two", () => {
    expect(() =>
      FirestoreModel.Class<{}>("Bad")({
        group: FirestoreModel.Struct({ "a.b": Schema.String }),
      }),
    ).toThrow(/must not contain/);
  });
});

describe("a group a document may go without", () => {
  const Address = FirestoreModel.Struct({
    city: Schema.String,
    nickname: FirestoreModel.Optional(Schema.String),
    verifiedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
  });

  class Place extends FirestoreModel.Class<Place>("Place")({
    name: Schema.String,
    address: FirestoreModel.Optional(Address),
  }) {}

  it("is an optional key where it is read and created", () => {
    expectTypeOf<(typeof Place)["Type"]["address"]>().toEqualTypeOf<
      | {
          readonly city: string;
          readonly nickname?: string;
          readonly verifiedAt: Timestamp.Timestamp;
        }
      | undefined
    >();
    expectTypeOf<(typeof Place.create)["Type"]["address"]>().toEqualTypeOf<
      | {
          readonly city: string;
          readonly nickname?: string;
          readonly verifiedAt: Timestamp.Timestamp | FieldValue.ServerTimestamp;
        }
      | undefined
    >();
  });

  it("is a patch or a removal where it is updated", () => {
    expectTypeOf<NonNullable<(typeof Place.update)["Type"]["address"]>>().toEqualTypeOf<
      | {
          readonly city?: string;
          readonly nickname?: string | FieldValue.DeleteField;
          readonly verifiedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
        }
      | FieldValue.DeleteField
    >();
    expectTypeOf<keyof (typeof Place.update)["Encoded"]>().toEqualTypeOf<
      "name" | "address" | "address.city" | "address.nickname" | "address.verifiedAt"
    >();
  });

  it.effect("reads a document that goes without it, and one that holds it", () =>
    Effect.gen(function* () {
      const without = yield* Schema.decodeUnknownEffect(Place)({ name: "a" } as unknown);
      expect("address" in without).toBe(false);

      const holding = yield* Schema.decodeUnknownEffect(Place)({
        name: "a",
        address: { city: "Berlin", verifiedAt: new SdkTimestamp(1, 2) },
      } as unknown);
      expect(holding.address?.city).toBe("Berlin");
    }),
  );

  it.effect("creates a document without it", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.create)(Place.create.make({ name: "a" }));
      expect(encoded).toStrictEqual({ name: "a" });
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("removes the whole map", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)(
        Place.update.make({ address: FieldValue.deleteField }),
      );
      expect(Object.keys(encoded)).toEqual(["address"]);
      expect(encoded.address).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("still writes a patch field by field", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)(
        Place.update.make({
          address: { city: "Berlin", nickname: FieldValue.deleteField },
        }),
      );
      expect(Object.keys(encoded).sort()).toEqual(["address.city", "address.nickname"]);
      expect(encoded["address.nickname"]).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
  );

  it("refuses the removal where a document is written whole", () => {
    expect(() =>
      // @ts-expect-error `set` removes a map by leaving it out
      Place.create.make({ name: "a", address: FieldValue.deleteField }),
    ).toThrow();
  });
});
