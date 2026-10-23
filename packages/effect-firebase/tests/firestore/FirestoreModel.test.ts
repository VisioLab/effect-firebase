import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Context, DateTime, Effect, Exit, Schema, SchemaGetter } from "effect";
import type { VariantSchema } from "effect/schema";
import * as Collection from "../../src/firestore/Collection.ts";
import * as DocumentPath from "../../src/firestore/DocumentPath.ts";
import * as FieldValue from "../../src/firestore/FieldValue.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";
import * as FirestoreValue from "../../src/firestore/FirestoreValue.ts";
import * as GeoPoint from "../../src/firestore/GeoPoint.ts";
import * as Patch from "../../src/firestore/Patch.ts";
import * as Timestamp from "../../src/firestore/Timestamp.ts";

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

/** A model's update in either mode, for a test that holds for both. */
const modes = <M extends FirestoreModel.Any>(model: M) =>
  [
    { mode: "update", update: model.update as M["update"] },
    { mode: "updateUnchecked", update: model.updateUnchecked as M["updateUnchecked"] },
  ] as const;

/** The shape a snapshot hands back, which is only ever known at runtime. */
const read = (overrides?: Partial<Record<string, unknown>>): unknown => ({
  displayName: "alice",
  signupSource: "web",
  plan: "free",
  createdAt: Timestamp.makeUnsafe(1_700_000_000, 0),
  updatedAt: Timestamp.makeUnsafe(1_700_000_001, 0),
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

  it.effect("reads a document with no services at all", () =>
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
      expect(encoded.createdAt).toBe(FieldValue.serverTimestamp);
      expect(encoded.updatedAt).toBe(FieldValue.serverTimestamp);
      expect(encoded.displayName).toBe("alice");
      expect("plan" in encoded).toBe(false);
    }),
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
      expect(Timestamp.isTimestamp(encoded.createdAt)).toBe(true);
      expect(encoded.updatedAt).toBe(FieldValue.serverTimestamp);
    }),
  );

  it("is written with no services", () => {
    expectTypeOf<(typeof User.create)["EncodingServices"]>().toEqualTypeOf<never>();
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
    }),
  );

  it.effect("leaves the time to the server where it is handed the sentinel", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.update)(
        User.update.make({ updatedAt: FieldValue.serverTimestamp }),
      );
      expect(Object.keys(encoded)).toEqual(["updatedAt"]);
      expect(encoded.updatedAt).toBe(FieldValue.serverTimestamp);
    }),
  );

  it("refuses a field that is written once", () => {
    // @ts-expect-error `signupSource` cannot be changed after creation
    User.update.make({ signupSource: "ios" });
  });
});

describe("fields", () => {
  it("carries a struct through every variant", () => {
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

  it("is written with no services, rather than widening to unknown", () => {
    expectTypeOf<(typeof Event.create)["EncodingServices"]>().toEqualTypeOf<never>();
  });

  it.effect("writes the instant this client picked", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Event.create)(
        Event.create.make({ name: "a", occurredAt: Timestamp.makeUnsafe(1, 2) }),
      );
      expect(Timestamp.isTimestamp(encoded.occurredAt)).toBe(true);
    }),
  );

  it.effect("writes the one the server picks", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Event.update)(
        Event.update.make({ occurredAt: FieldValue.serverTimestamp }),
      );
      expect(encoded.occurredAt).toBe(FieldValue.serverTimestamp);
    }),
  );

  it.effect("reads back as a timestamp either way", () =>
    Effect.gen(function* () {
      const event = yield* Schema.decodeUnknownEffect(Event)({
        name: "a",
        occurredAt: Timestamp.makeUnsafe(1, 2),
      } as unknown);
      expect(Timestamp.isTimestamp(event.occurredAt)).toBe(true);
    }),
  );

  it.effect("holds the instant the way the schema it was handed does", () =>
    Effect.gen(function* () {
      class Visit extends FirestoreModel.Class<Visit>("Visit")({
        seenAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
        leftAt: FirestoreModel.Timestamp(Schema.Date),
      }) {}

      const visit = yield* Schema.decodeEffect(FirestoreValue.toCodecFirestore(Visit))({
        seenAt: Timestamp.makeUnsafe(1_700_000_000, 123_000_000),
        leftAt: Timestamp.makeUnsafe(1_700_000_001, 0),
      });
      expect(visit.seenAt).toStrictEqual(DateTime.makeUnsafe(1_700_000_000_123));
      expect(visit.leftAt).toStrictEqual(new Date(1_700_000_001_000));

      const stamped = yield* Schema.encodeEffect(FirestoreValue.toCodecFirestore(Visit.update))(
        Visit.update.make({
          seenAt: DateTime.makeUnsafe(1_700_000_000_123),
          leftAt: new Date(1_700_000_001_000),
        }),
      );
      expect(stamped).toStrictEqual({
        seenAt: Timestamp.makeUnsafe(1_700_000_000, 123_000_000),
        leftAt: Timestamp.makeUnsafe(1_700_000_001, 0),
      });

      const left = yield* Schema.encodeEffect(FirestoreValue.toCodecFirestore(Visit.create))(
        Visit.create.make({
          seenAt: FieldValue.serverTimestamp,
          leftAt: FieldValue.serverTimestamp,
        }),
      );
      expect((left as { seenAt: unknown }).seenAt).toBe(FieldValue.serverTimestamp);
      expect((left as { leftAt: unknown }).leftAt).toBe(FieldValue.serverTimestamp);
    }),
  );

  it("is only built from a schema Firestore stores as a timestamp", () => {
    // @ts-expect-error a string is stored as a string, not a timestamp
    FirestoreModel.Timestamp(Schema.String);
  });
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
    }),
  );

  it.effect("leaves the sum to the server where it was handed a move", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.increment(1) }),
      );
      expect(Object.keys(encoded)).toEqual(["visits"]);
      expect(encoded.visits).toSatisfy(FieldValue.isIncrement);
      expect((encoded.visits as FieldValue.Increment).by).toBe(1);
    }),
  );

  it.effect("counts down just as readily", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Page.update)(
        Page.update.make({ visits: FieldValue.decrement(2) }),
      );
      expect((encoded.visits as FieldValue.Increment).by).toBe(-2);
    }),
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
      expect((encoded.balance as FieldValue.Increment).by).toBe(0.5);
      expect(yield* Schema.decodeEffect(Account)({ balance: 1.5 })).toMatchObject({
        balance: 1.5,
      });
    }),
  );
});

describe("Array", () => {
  /** Reads as an array, and is written as one or grown and shrunk by the server. */
  class Article extends FirestoreModel.Class<Article>("Article")({
    name: Schema.String,
    tags: FirestoreModel.Array(Schema.String),
    editors: FirestoreModel.Optional(FirestoreModel.Array(Schema.String)),
    meta: FirestoreModel.Struct({
      keywords: FirestoreModel.Array(Schema.String),
    }),
  }) {}

  it("takes the array alone in the read and the create, and a sentinel besides in the update", () => {
    expectTypeOf<(typeof Article)["Type"]["tags"]>().toEqualTypeOf<ReadonlyArray<string>>();
    expectTypeOf<(typeof Article.create)["Type"]["tags"]>().toEqualTypeOf<ReadonlyArray<string>>();
    expectTypeOf<(typeof Article.update)["Type"]["tags"]>().toEqualTypeOf<
      | ReadonlyArray<string>
      | FieldValue.ArrayUnion<string>
      | FieldValue.ArrayRemove<string>
      | undefined
    >();
  });

  it.effect("writes the array whole where it was handed one", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Article.create)(
        Article.create.make({ name: "a", tags: ["news"], meta: { keywords: [] } }),
      );
      expect(encoded).toStrictEqual({
        name: "a",
        tags: ["news"],
        meta: { keywords: [] },
      });
    }),
  );

  it("refuses a sentinel where a document is written whole", () => {
    expect(() =>
      Article.create.make({
        name: "a",
        // @ts-expect-error growing an array that is not there yet is writing it
        tags: FieldValue.arrayUnion("news"),
        meta: { keywords: [] },
      }),
    ).toThrow();
  });

  it.effect("leaves the elements to the server where an update was handed a sentinel", () =>
    Effect.gen(function* () {
      const grown = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ tags: FieldValue.arrayUnion("opinion") }),
      );
      expect(Object.keys(grown)).toEqual(["tags"]);
      expect(grown.tags).toSatisfy(FieldValue.isArrayUnion);
      expect((grown.tags as FieldValue.ArrayUnion<unknown>).elements).toEqual(["opinion"]);

      const shrunk = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ tags: FieldValue.arrayRemove("news") }),
      );
      expect(shrunk.tags).toSatisfy(FieldValue.isArrayRemove);
    }),
  );

  it.effect("writes a sentinel at its path inside a struct", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ meta: { keywords: FieldValue.arrayUnion("effect") } }),
      );
      expect(Object.keys(encoded)).toEqual(["meta.keywords"]);
      expect(encoded["meta.keywords"]).toSatisfy(FieldValue.isArrayUnion);
    }),
  );

  it.effect("composes with Optional, which takes the removal besides", () =>
    Effect.gen(function* () {
      const grown = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ editors: FieldValue.arrayUnion("alice") }),
      );
      expect(grown.editors).toSatisfy(FieldValue.isArrayUnion);

      const removed = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ editors: FieldValue.deleteField }),
      );
      expect(removed.editors).toBe(FieldValue.deleteField);
    }),
  );

  it.effect("encodes the elements of a sentinel as it encodes those of the array", () =>
    Effect.gen(function* () {
      class Log extends FirestoreModel.Class<Log>("Log")({
        seenAt: FirestoreModel.Array(FirestoreSchema.Timestamp),
      }) {}

      const whole = yield* Schema.encodeEffect(Log.update)(
        Log.update.make({ seenAt: [Timestamp.makeUnsafe(1, 2)] }),
      );
      const grown = yield* Schema.encodeEffect(Log.update)(
        Log.update.make({ seenAt: FieldValue.arrayUnion(Timestamp.makeUnsafe(1, 2)) }),
      );
      expect((whole.seenAt as ReadonlyArray<unknown>)[0]).toStrictEqual(Timestamp.makeUnsafe(1, 2));
      expect((grown.seenAt as FieldValue.ArrayUnion<unknown>).elements[0]).toStrictEqual(
        Timestamp.makeUnsafe(1, 2),
      );
    }),
  );

  it.effect("reads back as the array the server wrote", () =>
    Effect.gen(function* () {
      const article = yield* Schema.decodeUnknownEffect(Article)({
        name: "a",
        tags: ["news", "opinion"],
        meta: { keywords: [] },
      } as unknown);
      expect(article.tags).toEqual(["news", "opinion"]);
    }),
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
        lastSeenAt: Timestamp.makeUnsafe(1, 2),
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
    }),
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
      expect(encoded.nickname).toBe(FieldValue.deleteField);
    }),
  );

  it.effect("keeps what the field it was handed takes", () =>
    Effect.gen(function* () {
      const stamped = yield* Schema.encodeEffect(Profile.update)(
        Profile.update.make({ lastSeenAt: FieldValue.serverTimestamp }),
      );
      expect(stamped.lastSeenAt).toBe(FieldValue.serverTimestamp);

      const removed = yield* Schema.encodeEffect(Profile.update)(
        Profile.update.make({ lastSeenAt: FieldValue.deleteField }),
      );
      expect(removed.lastSeenAt).toBe(FieldValue.deleteField);
    }),
  );

  it("keeps a field with no update out of the update", () => {
    expect(Object.keys(Profile.update.from.fields).sort()).toEqual([
      "lastSeenAt",
      "name",
      "nickname",
    ]);
  });
});

describe("an update reaching into a struct", () => {
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
    expectTypeOf<NonNullable<A["geo"]>>().toEqualTypeOf<
      | { readonly lat?: number; readonly lng?: number }
      | Patch.Replace<{ readonly lat: number; readonly lng: number }>
    >();
    expectTypeOf<NonNullable<T["tags"]>>().toEqualTypeOf<{ readonly primary: string }>();
  });

  it.effect("writes each field of a struct at its path", () =>
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
      expect(encoded["address.nickname"]).toBe(FieldValue.deleteField);
      expect(encoded["address.verifiedAt"]).toBe(FieldValue.serverTimestamp);
      expect(encoded["address.geo.lat"]).toBe(1.5);
      expect(encoded.visits).toSatisfy(FieldValue.isIncrement);
    }),
  );

  it.effect("writes an encoded value and a plain struct whole", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)({
        address: { verifiedAt: Timestamp.makeUnsafe(1, 2) },
        tags: { primary: "cafe" },
      });
      expect(Timestamp.isTimestamp(encoded["address.verifiedAt"])).toBe(true);
      expect(encoded.tags).toStrictEqual({ primary: "cafe" });
    }),
  );

  it.effect("writes nothing for a struct handed nothing", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)({ address: {} });
      expect(encoded).toStrictEqual({});
    }),
  );

  it("refuses a field written once, at any depth", () => {
    // @ts-expect-error `country` cannot be changed after creation
    Place.update.make({ address: { country: "FR" } });
  });

  it.effect("is never read back", () =>
    Effect.gen(function* () {
      const exit = yield* Schema.decodeEffect(Place.update)({ name: "a" }).pipe(Effect.exit);
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
      | "address.geo"
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
      "address.geo",
      "address.geo.lat",
      "address.geo.lng",
      "address.nickname",
      "address.verifiedAt",
      "name",
      "tags",
      "visits",
    ]);
  });

  it.effect.each(modes(Place))(
    "writes a struct handed a replacement whole, at its path ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(update)(
          update.make({ address: { geo: Patch.replace({ lat: 1, lng: 2 }) } }),
        );
        expect(encoded).toStrictEqual({ "address.geo": { lat: 1, lng: 2 } });
      }),
  );

  it("refuses to replace a struct holding a field no update writes", () => {
    expect(() =>
      Place.update.make({
        // @ts-expect-error replacing the address would write `country`, which is written once
        address: Patch.replace({
          city: "Paris",
          country: "FR",
          verifiedAt: Timestamp.makeUnsafe(1, 2),
          geo: { lat: 1, lng: 2 },
        }),
      }),
    ).toThrow();
  });

  it("refuses a field name a path would read as two", () => {
    expect(() =>
      FirestoreModel.Class<{}>("Bad")({
        nested: FirestoreModel.Struct({ "a.b": Schema.String }),
      }),
    ).toThrow(/must not contain/);
  });
});

describe("a struct a document may go without", () => {
  const Geo = FirestoreModel.Struct({
    lat: Schema.Finite,
    lng: Schema.Finite,
  });

  const Address = FirestoreModel.Struct({
    city: Schema.String,
    nickname: FirestoreModel.Optional(Schema.String),
    verifiedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
    geo: Geo,
    // Every field optional, so only a replacement writes it empty.
    notes: FirestoreModel.Struct({ text: FirestoreModel.Optional(Schema.String) }),
  });

  class Place extends FirestoreModel.Class<Place>("Place")({
    name: Schema.String,
    address: FirestoreModel.Optional(Address),
  }) {}

  /** An address the way `set` would write it. */
  const address = {
    city: "Berlin",
    verifiedAt: FieldValue.serverTimestamp,
    geo: { lat: 1, lng: 2 },
    notes: {},
  } as const;

  it("is an optional key where it is read and created", () => {
    expectTypeOf<(typeof Place)["Type"]["address"]>().toEqualTypeOf<
      | {
          readonly city: string;
          readonly nickname?: string;
          readonly verifiedAt: Timestamp.Timestamp;
          readonly geo: { readonly lat: number; readonly lng: number };
          readonly notes: { readonly text?: string };
        }
      | undefined
    >();
  });

  it("is a replacement or a removal where it is updated", () => {
    expectTypeOf<NonNullable<(typeof Place.update)["Type"]["address"]>>().toEqualTypeOf<
      | Patch.Replace<{
          readonly city: string;
          readonly nickname?: string;
          readonly verifiedAt: Timestamp.Timestamp | FieldValue.ServerTimestamp;
          readonly geo: { readonly lat: number; readonly lng: number };
          readonly notes: { readonly text?: string };
        }>
      | FieldValue.DeleteField
    >();
  });

  it("takes a patch besides where it is updated unchecked", () => {
    type T = NonNullable<(typeof Place.updateUnchecked)["Type"]["address"]>;
    expectTypeOf<Exclude<T, Patch.Replace<any> | FieldValue.DeleteField>>().toEqualTypeOf<{
      readonly city?: string;
      readonly nickname?: string | FieldValue.DeleteField;
      readonly verifiedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
      readonly geo?:
        | { readonly lat?: number; readonly lng?: number }
        | Patch.Replace<{ readonly lat: number; readonly lng: number }>;
      readonly notes?:
        | { readonly text?: string | FieldValue.DeleteField }
        | Patch.Replace<{ readonly text?: string }>;
    }>();
    expectTypeOf<Extract<T, Patch.Replace<any> | FieldValue.DeleteField>>().toEqualTypeOf<
      NonNullable<(typeof Place.update)["Type"]["address"]>
    >();
  });

  it("is written at the same paths in either mode", () => {
    expectTypeOf<keyof (typeof Place.update)["Encoded"]>().toEqualTypeOf<
      | "name"
      | "address"
      | "address.city"
      | "address.nickname"
      | "address.verifiedAt"
      | "address.geo"
      | "address.geo.lat"
      | "address.geo.lng"
      | "address.notes"
      | "address.notes.text"
    >();
    expectTypeOf<(typeof Place.updateUnchecked)["Encoded"]>().toEqualTypeOf<
      (typeof Place.update)["Encoded"]
    >();
  });

  it("names the mode in the types an update is built from", () => {
    type Fields = (typeof Place)[typeof VariantSchema.TypeId];
    expectTypeOf<typeof Place.update>().toEqualTypeOf<FirestoreModel.Update<Fields>>();
    expectTypeOf<typeof Place.update>().toEqualTypeOf<FirestoreModel.Update<Fields, "checked">>();
    expectTypeOf<typeof Place.updateUnchecked>().toEqualTypeOf<
      FirestoreModel.Update<Fields, "unchecked">
    >();
    expectTypeOf<FirestoreModel.UpdateFields<Fields, "unchecked">>().not.toEqualTypeOf<
      FirestoreModel.UpdateFields<Fields, "checked">
    >();
    expectTypeOf<FirestoreModel.UpdatePaths<Fields, "unchecked">>().toEqualTypeOf<
      FirestoreModel.UpdatePaths<Fields, "checked">
    >();
  });

  it.effect("reads a document that goes without it, and one that holds it", () =>
    Effect.gen(function* () {
      const without = yield* Schema.decodeUnknownEffect(Place)({ name: "a" } as unknown);
      expect("address" in without).toBe(false);

      const holding = yield* Schema.decodeUnknownEffect(Place)({
        name: "a",
        address: {
          city: "Berlin",
          verifiedAt: Timestamp.makeUnsafe(1, 2),
          geo: { lat: 1, lng: 2 },
          notes: {},
        },
      } as unknown);
      expect(holding.address?.city).toBe("Berlin");
    }),
  );

  it.effect("creates a document without it", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.create)(Place.create.make({ name: "a" }));
      expect(encoded).toStrictEqual({ name: "a" });
    }),
  );

  it.effect.each(modes(Place))("removes the whole map ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ address: FieldValue.deleteField }),
      );
      expect(Object.keys(encoded)).toEqual(["address"]);
      expect(encoded.address).toBe(FieldValue.deleteField);
    }),
  );

  it.effect.each(modes(Place))(
    "writes a replacement whole, empty maps and sentinels and all ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(update)(
          update.make({ address: Patch.replace(address) }),
        );
        expect(Object.keys(encoded)).toEqual(["address"]);
        expect(encoded.address).toStrictEqual({
          city: "Berlin",
          verifiedAt: FieldValue.serverTimestamp,
          geo: { lat: 1, lng: 2 },
          notes: {},
        });
      }),
  );

  it("refuses a patch, which would create a missing struct holding only the patch", () => {
    expect(() =>
      // @ts-expect-error a missing address would be created holding only `city`
      Place.update.make({ address: { city: "Berlin" } }),
    ).toThrow();
  });

  it.effect("rejects encoding one too", () =>
    Effect.gen(function* () {
      const exit = yield* Schema.encodeUnknownEffect(Place.update)({
        address: { city: "Berlin" },
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it("refuses a replacement that is not a whole struct", () => {
    expect(() =>
      // @ts-expect-error a replacement is written whole, so it needs `verifiedAt`, `geo` and `notes`
      Place.update.make({ address: Patch.replace({ city: "Berlin" }) }),
    ).toThrow();
  });

  it.effect("writes a patch field by field where updated unchecked", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.updateUnchecked)(
        Place.updateUnchecked.make({
          address: {
            city: "Berlin",
            geo: { lat: 1 },
            nickname: FieldValue.deleteField,
            verifiedAt: FieldValue.serverTimestamp,
          },
        }),
      );
      expect(Object.keys(encoded).sort()).toEqual([
        "address.city",
        "address.geo.lat",
        "address.nickname",
        "address.verifiedAt",
      ]);
      expect(encoded["address.nickname"]).toBe(FieldValue.deleteField);
      expect(encoded["address.verifiedAt"]).toBe(FieldValue.serverTimestamp);
    }),
  );

  it("refuses the removal and the replacement where a document is written whole", () => {
    expect(() =>
      // @ts-expect-error `set` removes a map by leaving it out
      Place.create.make({ name: "a", address: FieldValue.deleteField }),
    ).toThrow();
    expect(() =>
      // @ts-expect-error `set` writes every map whole already
      Place.create.make({ name: "a", address: Patch.replace(address) }),
    ).toThrow();
  });
});

describe("a field made optional twice", () => {
  const Address = FirestoreModel.Struct({ city: Schema.String, zip: Schema.String });

  class Place extends FirestoreModel.Class<Place>("Place")({
    address: FirestoreModel.Optional(FirestoreModel.Optional(Address)),
    nickname: FirestoreModel.Optional(FirestoreModel.Optional(Schema.String)),
  }) {}

  class Once extends FirestoreModel.Class<Once>("Once")({
    address: FirestoreModel.Optional(Address),
    nickname: FirestoreModel.Optional(Schema.String),
  }) {}

  it("is the field made optional once", () => {
    expectTypeOf(FirestoreModel.Optional(FirestoreModel.Optional(Address))).toEqualTypeOf<
      FirestoreModel.Optional<typeof Address>
    >();
    expectTypeOf<(typeof Place)["Encoded"]>().toEqualTypeOf<(typeof Once)["Encoded"]>();
    expectTypeOf<(typeof Place.update)["Type"]>().toEqualTypeOf<(typeof Once.update)["Type"]>();
    expectTypeOf<(typeof Place.updateUnchecked)["Encoded"]>().toEqualTypeOf<
      (typeof Once.updateUnchecked)["Encoded"]
    >();
  });

  it.effect("is still reached into by an unchecked update", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.updateUnchecked)(
        Place.updateUnchecked.make({ address: { city: "Berlin" } }),
      );
      expect(encoded).toStrictEqual({ "address.city": "Berlin" });
    }),
  );

  it.effect("removes a plain value once", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)(
        Place.update.make({ nickname: FieldValue.deleteField }),
      );
      expect(encoded.nickname).toBe(FieldValue.deleteField);
    }),
  );
});

describe("a struct a document may go without, inside one every document holds", () => {
  class User extends FirestoreModel.Class<User>("User")({
    profile: FirestoreModel.Struct({
      bio: Schema.String,
      address: FirestoreModel.Optional(
        FirestoreModel.Struct({ city: Schema.String, zip: Schema.String }),
      ),
    }),
  }) {}

  it.effect("is replaced or removed at its path", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(User.update)(
        User.update.make({
          profile: { bio: "hi", address: Patch.replace({ city: "Berlin", zip: "10115" }) },
        }),
      );
      expect(encoded).toStrictEqual({
        "profile.bio": "hi",
        "profile.address": { city: "Berlin", zip: "10115" },
      });
    }),
  );

  it("is not patched", () => {
    expect(() =>
      // @ts-expect-error a missing address would be created holding only `city`
      User.update.make({ profile: { address: { city: "Berlin" } } }),
    ).toThrow();
  });
});

describe("a struct holding a field no update writes", () => {
  class Shop extends FirestoreModel.Class<Shop>("Shop")({
    address: FirestoreModel.Optional(
      FirestoreModel.Struct({
        city: Schema.String,
        country: FirestoreModel.Immutable(Schema.String),
      }),
    ),
  }) {}

  it("is only removed, since replacing it would write that field", () => {
    expect(() =>
      // @ts-expect-error `country` is written once
      Shop.update.make({ address: Patch.replace({ city: "Berlin", country: "DE" }) }),
    ).toThrow();
    expect(() =>
      // @ts-expect-error a missing address would be created holding only `city`
      Shop.update.make({ address: { city: "Berlin" } }),
    ).toThrow();
    Shop.update.make({ address: FieldValue.deleteField });
  });

  it("is patched where updated unchecked", () => {
    expect(Shop.updateUnchecked.make({ address: { city: "Berlin" } })).toStrictEqual({
      address: { city: "Berlin" },
    });
  });

  it("has no path of its own but the removal", () => {
    expect(Object.keys(Shop.update.from.fields).sort()).toEqual(["address", "address.city"]);
  });
});

describe("a struct holding a field no set writes", () => {
  class Doc extends FirestoreModel.Class<Doc>("Doc")({
    entry: FirestoreModel.Struct({
      name: Schema.String,
      // Kept up by updates alone, so a replacement written as `set` would drop it.
      rank: FirestoreModel.FieldOnly(["read", "update"])(Schema.Finite),
    }),
  }) {}

  it("is not replaced, since the replacement would drop that field", () => {
    expect(() =>
      // @ts-expect-error `rank` is never written by `set`
      Doc.update.make({ entry: Patch.replace({ name: "a", rank: 1 }) }),
    ).toThrow();
  });

  it.effect("is still patched", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Doc.update)(
        Doc.update.make({ entry: { rank: 2 } }),
      );
      expect(encoded).toStrictEqual({ "entry.rank": 2 });
    }),
  );
});

describe("a replacement handed to a field that is no struct", () => {
  class Doc extends FirestoreModel.Class<Doc>("Doc")({
    anything: Schema.Unknown,
  }) {}

  it.effect("is written as it was handed, since only a struct is replaced", () =>
    Effect.gen(function* () {
      const replacement = Patch.replace({ x: 1 });
      const encoded = yield* Schema.encodeEffect(Doc.update)(
        Doc.update.make({ anything: replacement }),
      );
      expect(encoded.anything).toBe(replacement);
    }),
  );
});

describe("the update of a struct every document holds", () => {
  const Address = FirestoreModel.Struct({
    city: Schema.String,
    zip: Schema.String,
  });

  class User extends FirestoreModel.Class<User>("User")({
    address: Address,
  }) {}

  it.effect.each(modes(User))("takes a partial patch ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ address: { city: "Berlin" } }),
      );
      expect(encoded).toStrictEqual({ "address.city": "Berlin" });
    }),
  );

  it.effect.each(modes(User))("takes a replacement ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ address: Patch.replace({ city: "Berlin", zip: "10115" }) }),
      );
      expect(encoded).toStrictEqual({ address: { city: "Berlin", zip: "10115" } });
    }),
  );
});

describe("a field with a constructor default", () => {
  const Archived = Schema.Boolean.pipe(Schema.withConstructorDefault(Effect.succeed(false)));

  class Doc extends FirestoreModel.Class<Doc>("Doc")({
    name: Schema.String,
    archived: Archived,
    meta: FirestoreModel.Struct({ title: Schema.String, archived: Archived }),
    extra: FirestoreModel.Optional(
      FirestoreModel.Struct({ note: Schema.String, archived: Archived }),
    ),
  }) {}

  it.effect("fills it in where a document is created", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Doc.create)(
        Doc.create.make({ name: "a", meta: { title: "t" } }),
      );
      expect(encoded).toStrictEqual({
        name: "a",
        archived: false,
        meta: { title: "t", archived: false },
      });
    }),
  );

  it.effect("leaves it out of an update handed nothing for it", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Doc.update)(Doc.update.make({ name: "b" }));
      expect(encoded).toStrictEqual({ name: "b" });
    }),
  );

  it.effect("leaves it out at any depth", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Doc.updateUnchecked)(
        Doc.updateUnchecked.make({ meta: { title: "t" }, extra: { note: "n" } }),
      );
      expect(encoded).toStrictEqual({ "meta.title": "t", "extra.note": "n" });
    }),
  );

  it.effect("fills it in where a struct is replaced, as where it is created", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Doc.update)(
        Doc.update.make({
          meta: Patch.replace({ title: "t" }),
          extra: Patch.replace({ note: "n" }),
        }),
      );
      expect(encoded).toStrictEqual({
        meta: { title: "t", archived: false },
        extra: { note: "n", archived: false },
      });
    }),
  );

  it.effect("writes it where an update was handed it", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Doc.updateUnchecked)(
        Doc.updateUnchecked.make({
          archived: true,
          meta: { archived: true },
          extra: { archived: true },
        }),
      );
      expect(encoded).toStrictEqual({
        archived: true,
        "meta.archived": true,
        "extra.archived": true,
      });
    }),
  );
});

describe("a field holding a document reference", () => {
  class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
  class Category extends FirestoreModel.Class<Category>("Category")({ label: Schema.String }) {}

  const Users = Collection.make("users", User);
  const Categories = Collection.make("categories", Category);

  class Post extends FirestoreModel.Class<Post>("Post")({
    title: Schema.String,
    author: FirestoreSchema.DocumentReference(Users),
    meta: FirestoreModel.Struct({
      category: FirestoreSchema.DocumentReference(Categories),
    }),
  }) {}

  const alice = Users.doc(Users.id.make("alice"));
  const news = Categories.doc(Categories.id.make("news"));

  it.effect("decodes the paths a snapshot holds, typed by collection", () =>
    Effect.gen(function* () {
      const post = yield* Schema.decodeEffect(FirestoreValue.toCodecFirestore(Post))({
        title: "hello",
        author: DocumentPath.makeUnsafe("users/alice"),
        meta: { category: DocumentPath.makeUnsafe("categories/news") },
      });
      expectTypeOf(post.author).toEqualTypeOf<Collection.DocumentReference<typeof Users>>();
      expect(post.author.collection).toBe(Users);
      expect(post.author.id).toBe("alice");
      expect(post.meta.category.collection).toBe(Categories);
      expect(post.meta.category.id).toBe("news");
    }),
  );

  it.effect("writes the references' paths on create", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreValue.toCodecFirestore(Post.create))(
        Post.create.make({ title: "hello", author: alice, meta: { category: news } }),
      );
      expect(encoded).toStrictEqual({
        title: "hello",
        author: DocumentPath.makeUnsafe("users/alice"),
        meta: { category: DocumentPath.makeUnsafe("categories/news") },
      });
    }),
  );

  it.effect("writes the references' paths on update, at their field paths", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(FirestoreValue.toCodecFirestore(Post.update))(
        Post.update.make({ author: alice, meta: { category: news } }),
      );
      expect(encoded).toStrictEqual({
        author: DocumentPath.makeUnsafe("users/alice"),
        "meta.category": DocumentPath.makeUnsafe("categories/news"),
      });
    }),
  );
});

class Landmark extends FirestoreModel.Class<Landmark>("Landmark")({
  name: Schema.String,
  location: FirestoreSchema.GeoPoint,
}) {}

describe("a geopoint field", () => {
  it.effect("decodes from a snapshot", () =>
    Effect.gen(function* () {
      const landmark = yield* Schema.decodeEffect(Landmark)({
        name: "Fernsehturm",
        location: GeoPoint.makeUnsafe(52.52, 13.405),
      });
      expect(GeoPoint.isGeoPoint(landmark.location)).toBe(true);
      expect(landmark.location.latitude).toBe(52.52);
    }),
  );

  it.effect("is written as the SDK's own by create", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Landmark.create)(
        Landmark.create.make({ name: "Fernsehturm", location: GeoPoint.makeUnsafe(52.52, 13.405) }),
      );
      expect(GeoPoint.isGeoPoint(encoded.location)).toBe(true);
    }),
  );

  it.effect("is written as the SDK's own by update, rather than flattened as a map", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Landmark.update)(
        Landmark.update.make({ location: GeoPoint.makeUnsafe(52.52, 13.405) }),
      );
      expect(Object.keys(encoded)).toEqual(["location"]);
      expect(GeoPoint.isGeoPoint(encoded.location)).toBe(true);
    }),
  );
});

/** How a key is written, as a service a key schema takes. */
interface Casing {
  readonly encode: (key: string) => string;
}
const Casing = Context.Service<Casing>("Casing");

/** A key written in upper case, read in lower case. */
const Upper = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((s: string) => s.toLowerCase()),
    encode: SchemaGetter.transform((s: string) => s.toUpperCase()),
  }),
);

describe("Record", () => {
  const Member = FirestoreModel.Struct({
    name: Schema.String,
    badges: FirestoreModel.Array(Schema.String),
  });

  class Poll extends FirestoreModel.Class<Poll>("Poll")({
    title: Schema.String,
    votes: FirestoreModel.Record(Schema.String, FirestoreModel.Number(Schema.Int)),
    tags: FirestoreModel.Record(Schema.String, FirestoreModel.Array(Schema.String)),
    seenAt: FirestoreModel.Record(
      Schema.String,
      FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
    ),
    aliases: FirestoreModel.Record(Schema.String, Schema.String),
    members: FirestoreModel.Record(Schema.String, Member),
    scores: FirestoreModel.Record(
      Schema.String,
      FirestoreModel.Record(Schema.String, FirestoreModel.Number(Schema.Int)),
    ),
    profile: FirestoreModel.Struct({
      links: FirestoreModel.Record(Schema.String, Schema.String),
    }),
  }) {}

  /** A poll the way a snapshot hands it back. */
  const snapshot = {
    title: "lunch",
    votes: { pizza: 2, sushi: 1 },
    tags: { pizza: ["hot"] },
    seenAt: { alice: Timestamp.makeUnsafe(1, 2) },
    aliases: {},
    members: { m1: { name: "alice", badges: [] } },
    scores: { r1: { a: 1 } },
    profile: { links: {} },
  };

  it.effect("decodes a snapshot with the value's read form", () =>
    Effect.gen(function* () {
      const poll = yield* Schema.decodeUnknownEffect(Poll)(snapshot as unknown);
      expectTypeOf(poll.votes).toEqualTypeOf<{ readonly [x: string]: number }>();
      expectTypeOf(poll.members).toEqualTypeOf<{
        readonly [x: string]: { readonly name: string; readonly badges: ReadonlyArray<string> };
      }>();
      expect(poll.votes).toStrictEqual({ pizza: 2, sushi: 1 });
      expect(Timestamp.isTimestamp(poll.seenAt.alice)).toBe(true);
      expect(poll.scores).toStrictEqual({ r1: { a: 1 } });
    }),
  );

  it.effect("creates a document with the value's create form, sentinels and all", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Poll.create)(
        Poll.create.make({
          title: "lunch",
          votes: { pizza: FieldValue.increment(1) },
          tags: {},
          seenAt: { alice: FieldValue.serverTimestamp },
          aliases: {},
          members: {},
          scores: {},
          profile: { links: {} },
        }),
      );
      expect(encoded.votes.pizza).toSatisfy(FieldValue.isIncrement);
      expect(encoded.seenAt.alice).toBe(FieldValue.serverTimestamp);
    }),
  );

  it("refuses the removal of a key where a document is written whole", () => {
    expect(() =>
      Poll.create.make({
        ...snapshot,
        seenAt: {},
        // @ts-expect-error `set` removes a key by leaving it out
        aliases: { old: FieldValue.deleteField },
      }),
    ).toThrow();
  });

  it.effect.each(modes(Poll))("writes each key at its own path ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({
          votes: { pizza: FieldValue.increment(1), sushi: 3 },
          tags: { pizza: FieldValue.arrayUnion("cheesy"), sushi: FieldValue.arrayRemove("raw") },
          seenAt: { alice: FieldValue.serverTimestamp, bob: Timestamp.makeUnsafe(1, 2) },
        }),
      );
      expect(Object.keys(encoded).sort()).toEqual([
        "seenAt.alice",
        "seenAt.bob",
        "tags.pizza",
        "tags.sushi",
        "votes.pizza",
        "votes.sushi",
      ]);
      expect(encoded["votes.pizza"]).toSatisfy(FieldValue.isIncrement);
      expect(encoded["votes.sushi"]).toBe(3);
      expect(encoded["tags.pizza"]).toStrictEqual(FieldValue.arrayUnion("cheesy"));
      expect(encoded["tags.sushi"]).toStrictEqual(FieldValue.arrayRemove("raw"));
      expect(encoded["seenAt.alice"]).toBe(FieldValue.serverTimestamp);
      expect(Timestamp.isTimestamp(encoded["seenAt.bob"])).toBe(true);
    }),
  );

  it.effect.each(modes(Poll))("removes a single key ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({
          aliases: { old: FieldValue.deleteField },
          votes: { gone: FieldValue.deleteField },
        }),
      );
      expect(Object.keys(encoded).sort()).toEqual(["aliases.old", "votes.gone"]);
      expect(encoded["aliases.old"]).toBe(FieldValue.deleteField);
      expect(encoded["votes.gone"]).toBe(FieldValue.deleteField);
    }),
  );

  it.effect.each(modes(Poll))("writes a Record of Records at the full path ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({
          scores: { r1: { a: FieldValue.increment(1) }, r2: FieldValue.deleteField },
        }),
      );
      expect(Object.keys(encoded).sort()).toEqual(["scores.r1.a", "scores.r2"]);
      expect(encoded["scores.r1.a"]).toSatisfy(FieldValue.isIncrement);
      expect(encoded["scores.r2"]).toBe(FieldValue.deleteField);
    }),
  );

  it.effect.each(modes(Poll))(
    "writes a Record inside a struct at the full path ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(update)(
          update.make({ profile: { links: { site: "https://example.com" } } }),
        );
        expect(encoded).toStrictEqual({ "profile.links.site": "https://example.com" });
      }),
  );

  it.effect.each(modes(Poll))("replaces or removes a struct at one key ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({
          members: {
            m1: Patch.replace({ name: "alice", badges: ["early"] }),
            m2: FieldValue.deleteField,
          },
        }),
      );
      expect(Object.keys(encoded).sort()).toEqual(["members.m1", "members.m2"]);
      expect(encoded["members.m1"]).toStrictEqual({ name: "alice", badges: ["early"] });
      expect(encoded["members.m2"]).toBe(FieldValue.deleteField);
    }),
  );

  it("refuses a patch into a struct at one key, which may be missing", () => {
    expect(() =>
      // @ts-expect-error a missing member would be created holding only `badges`
      Poll.update.make({ members: { m1: { badges: FieldValue.arrayUnion("early") } } }),
    ).toThrow();
  });

  it.effect(
    "writes a patch into a struct at one key at the full path where updated unchecked",
    () =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(Poll.updateUnchecked)(
          Poll.updateUnchecked.make({
            members: { m1: { badges: FieldValue.arrayUnion("early") } },
          }),
        );
        expect(encoded).toStrictEqual({ "members.m1.badges": FieldValue.arrayUnion("early") });
      }),
  );

  it.effect.each(modes(Poll))("writes a Record handed a replacement whole ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ votes: Patch.replace({ pizza: 0 }), aliases: Patch.replace({}) }),
      );
      expect(encoded).toStrictEqual({ votes: { pizza: 0 }, aliases: {} });
    }),
  );

  it("refuses the removal of a Record every document holds", () => {
    expect(() =>
      // @ts-expect-error only an optional Record is removed whole
      Poll.update.make({ votes: FieldValue.deleteField }),
    ).toThrow();
  });

  it.effect.each(["a.b", ""])("fails to encode a key no path can name (%j)", (key) =>
    Effect.gen(function* () {
      const exit = yield* Schema.encodeEffect(Poll.update)({ aliases: { [key]: "x" } }).pipe(
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(String(exit)).toContain(`"${key}"`);
      expect(String(exit)).toContain(`"aliases"`);
    }),
  );

  it.effect("fails to encode a key no path can name, at any depth", () =>
    Effect.gen(function* () {
      const exit = yield* Schema.encodeEffect(Poll.update)({ scores: { r1: { "a.b": 1 } } }).pipe(
        Effect.exit,
      );
      expect(String(exit)).toContain(`"a.b" in "scores.r1"`);
    }),
  );

  it.effect("writes a key in its encoded form", () =>
    Effect.gen(function* () {
      class Lookup extends FirestoreModel.Class<Lookup>("Lookup")({
        byCode: FirestoreModel.Record(Upper, Schema.String),
      }) {}
      const encoded = yield* Schema.encodeEffect(Lookup.update)({ byCode: { de: "Germany" } });
      expect(encoded).toStrictEqual({ "byCode.DE": "Germany" });
    }),
  );

  it.effect("writes each key of a Record of Records in its encoded form", () =>
    Effect.gen(function* () {
      class Grid extends FirestoreModel.Class<Grid>("Grid")({
        cells: FirestoreModel.Record(Upper, FirestoreModel.Record(Upper, Schema.Finite)),
      }) {}
      const encoded = yield* Schema.encodeEffect(Grid.update)({ cells: { a: { b: 1 } } });
      expect(encoded).toStrictEqual({ "cells.A.B": 1 });
    }),
  );

  it.effect("refuses a key whose encoded form no path can name", () =>
    Effect.gen(function* () {
      class Lookup extends FirestoreModel.Class<Lookup>("Lookup")({
        byCode: FirestoreModel.Record(
          Schema.String.pipe(
            Schema.decodeTo(Schema.String, {
              decode: SchemaGetter.transform((s: string) => s.replace("_", ".")),
              encode: SchemaGetter.transform((s: string) => s.replace("_", ".")),
            }),
          ),
          Schema.String,
        ),
      }) {}
      const exit = yield* Schema.encodeEffect(Lookup.update)({ byCode: { a_b: "x" } }).pipe(
        Effect.exit,
      );
      expect(String(exit)).toContain(`Invalid Firestore field name "a.b" in "byCode"`);
    }),
  );

  it.effect("encodes a key with the services it takes", () =>
    Effect.gen(function* () {
      class Lookup extends FirestoreModel.Class<Lookup>("Lookup")({
        byCode: FirestoreModel.Record(
          Schema.String.pipe(
            Schema.decodeTo(Schema.String, {
              decode: SchemaGetter.passthrough(),
              encode: SchemaGetter.transformEffect((s: string) =>
                Effect.map(Effect.service(Casing), (casing) => casing.encode(s)),
              ),
            }),
          ),
          // A struct holding a field written once, so the Record is never
          // written whole, and no schema of it but its paths names the key.
          FirestoreModel.Struct({
            id: FirestoreModel.Immutable(Schema.String),
            name: Schema.String,
          }),
        ),
      }) {}
      expectTypeOf<(typeof Lookup.update)["EncodingServices"]>().toEqualTypeOf<Casing>();
      const encoded = yield* Schema.encodeEffect(Lookup.updateUnchecked)({
        byCode: { de: { name: "Germany" } },
      });
      expect(encoded).toStrictEqual({ "byCode.DE.name": "Germany" });
    }).pipe(Effect.provideService(Casing, { encode: (s) => s.toUpperCase() })),
  );

  it("takes a patch, a replacement, and a removal per key", () => {
    type T = (typeof Poll.update)["Type"];
    expectTypeOf<NonNullable<T["votes"]>>().toEqualTypeOf<
      | { readonly [x: string]: number | FieldValue.Increment | FieldValue.DeleteField }
      | Patch.Replace<{ readonly [x: string]: number | FieldValue.Increment }>
    >();
    type Members = Exclude<NonNullable<T["members"]>, Patch.Replace<any>>;
    type Member = { readonly name: string; readonly badges: ReadonlyArray<string> };
    expectTypeOf<Members>().toEqualTypeOf<{
      readonly [x: string]: Patch.Replace<Member> | FieldValue.DeleteField;
    }>();
    type Unchecked = Exclude<
      NonNullable<(typeof Poll.updateUnchecked)["Type"]["members"]>,
      Patch.Replace<any>
    >[string];
    expectTypeOf<Exclude<Unchecked, Patch.Replace<any> | FieldValue.DeleteField>>().toEqualTypeOf<{
      readonly name?: string;
      readonly badges?:
        | ReadonlyArray<string>
        | FieldValue.ArrayUnion<string>
        | FieldValue.ArrayRemove<string>;
    }>();
  });

  it("names a pattern for its paths in its encoded type", () => {
    type E = (typeof Poll.update)["Encoded"];
    expectTypeOf<"votes.pizza">().toExtend<keyof E>();
    expectTypeOf<`votes.${string}`>().toExtend<keyof E>();
    expectTypeOf<`members.${string}`>().toExtend<keyof E>();
    expectTypeOf<`profile.links.${string}`>().toExtend<keyof E>();
    expectTypeOf<"votes">().toExtend<keyof E>();
  });
});

describe("a Record keyed by literals", () => {
  class Survey extends FirestoreModel.Class<Survey>("Survey")({
    counts: FirestoreModel.Record(
      Schema.Literals(["yes", "no"]),
      FirestoreModel.Number(Schema.Int),
    ),
    notes: FirestoreModel.Record(
      Schema.Literals(["yes", "no"]),
      FirestoreModel.Optional(Schema.String),
    ),
  }) {}

  it.effect("holds every key where read", () =>
    Effect.gen(function* () {
      expectTypeOf<(typeof Survey)["Type"]["counts"]>().toEqualTypeOf<{
        readonly yes: number;
        readonly no: number;
      }>();
      const exit = yield* Schema.decodeUnknownEffect(Survey)({
        counts: { yes: 1 },
        notes: {},
      } as unknown).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it("names each path in its encoded type", () => {
    expectTypeOf<keyof (typeof Survey.update)["Encoded"]>().toEqualTypeOf<
      "counts" | "counts.yes" | "counts.no" | "notes" | "notes.yes" | "notes.no"
    >();
  });

  it.effect("writes a key in its encoded form", () =>
    Effect.gen(function* () {
      class Ballot extends FirestoreModel.Class<Ballot>("Ballot")({
        answers: FirestoreModel.Record(
          Schema.Literals(["Y", "N"]).pipe(
            Schema.decodeTo(Schema.Literals(["yes", "no"]), {
              decode: SchemaGetter.transform((s) => (s === "Y" ? "yes" : "no")),
              encode: SchemaGetter.transform((s) => (s === "yes" ? "Y" : "N")),
            }),
          ),
          FirestoreModel.Number(Schema.Int),
        ),
      }) {}
      expectTypeOf<keyof (typeof Ballot.update)["Encoded"]>().toEqualTypeOf<
        "answers" | "answers.Y" | "answers.N"
      >();
      const encoded = yield* Schema.encodeEffect(Ballot.update)({
        answers: { yes: FieldValue.increment(1) },
      });
      expect(Object.keys(encoded)).toEqual(["answers.Y"]);
    }),
  );

  it.effect("refuses a key whose encoded form no path can name", () =>
    Effect.gen(function* () {
      class Ballot extends FirestoreModel.Class<Ballot>("Ballot")({
        answers: FirestoreModel.Record(
          Schema.Literals(["a.b"]).pipe(
            Schema.decodeTo(Schema.Literals(["yes"]), {
              decode: SchemaGetter.transform(() => "yes" as const),
              encode: SchemaGetter.transform(() => "a.b" as const),
            }),
          ),
          FirestoreModel.Number(Schema.Int),
        ),
      }) {}
      const exit = yield* Schema.encodeEffect(Ballot.update)({
        answers: { yes: FieldValue.increment(1) },
      }).pipe(Effect.exit);
      expect(String(exit)).toContain(`Invalid Firestore field name "a.b" in "answers"`);
    }),
  );

  it.effect.each(modes(Survey))("writes each key at its own path ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({
          counts: { yes: FieldValue.increment(1) },
          notes: { no: FieldValue.deleteField },
        }),
      );
      expect(Object.keys(encoded).sort()).toEqual(["counts.yes", "notes.no"]);
      expect(encoded["counts.yes"]).toSatisfy(FieldValue.isIncrement);
      expect(encoded["notes.no"]).toBe(FieldValue.deleteField);
    }),
  );

  it.each(["", "a.b"])("refuses a literal no path can name (%j)", (literal) => {
    expect(() => FirestoreModel.Record(Schema.Literals([literal, "b"]), Schema.String)).toThrow(
      /Invalid Firestore field name/,
    );
  });

  it("refuses the removal of a key every document holds", () => {
    expect(() =>
      // @ts-expect-error `yes` is a key every survey holds
      Survey.update.make({ counts: { yes: FieldValue.deleteField } }),
    ).toThrow();
  });
});

describe("a Record a document may go without", () => {
  class Tally extends FirestoreModel.Class<Tally>("Tally")({
    votes: FirestoreModel.Optional(
      FirestoreModel.Record(Schema.String, FirestoreModel.Number(Schema.Int)),
    ),
    counts: FirestoreModel.Optional(
      FirestoreModel.Record(Schema.Literals(["yes", "no"]), FirestoreModel.Number(Schema.Int)),
    ),
  }) {}

  it.effect("is an optional key where it is read and created", () =>
    Effect.gen(function* () {
      expectTypeOf<(typeof Tally)["Type"]["votes"]>().toEqualTypeOf<
        { readonly [x: string]: number } | undefined
      >();
      const tally = yield* Schema.decodeUnknownEffect(Tally)({} as unknown);
      expect("votes" in tally).toBe(false);
      const encoded = yield* Schema.encodeEffect(Tally.create)(Tally.create.make({}));
      expect(encoded).toStrictEqual({});
    }),
  );

  it.effect.each(modes(Tally))("removes the whole Record ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ votes: FieldValue.deleteField, counts: FieldValue.deleteField }),
      );
      expect(Object.keys(encoded).sort()).toEqual(["counts", "votes"]);
      expect(encoded.votes).toBe(FieldValue.deleteField);
    }),
  );

  it.effect.each(modes(Tally))(
    "is patched key by key where its keys come from the data, since any of them may be missing ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(update)(
          update.make({ votes: { pizza: FieldValue.increment(1) } }),
        );
        expect(Object.keys(encoded)).toEqual(["votes.pizza"]);
      }),
  );

  it("is not patched where its keys are literals, which a missing Record would lack", () => {
    expect(() =>
      // @ts-expect-error a missing Record would be created holding only `yes`
      Tally.update.make({ counts: { yes: 1 } }),
    ).toThrow();
    expect(Tally.updateUnchecked.make({ counts: { yes: 1 } })).toStrictEqual({
      counts: { yes: 1 },
    });
  });

  it("takes the removal at its own path in its encoded type", () => {
    expectTypeOf<FieldValue.DeleteField>().toExtend<(typeof Tally.update)["Encoded"]["votes"]>();
    expectTypeOf<"votes">().toExtend<keyof (typeof Tally.update)["Encoded"]>();
  });
});

describe("a Record of a value no update writes", () => {
  class Archive extends FirestoreModel.Class<Archive>("Archive")({
    name: Schema.String,
    frozen: FirestoreModel.Record(Schema.String, FirestoreModel.Immutable(Schema.String)),
  }) {}

  it("is left out of the update", () => {
    expectTypeOf<keyof (typeof Archive.update)["Type"]>().toEqualTypeOf<"name">();
    expect(Object.keys(Archive.update.from.fields)).toEqual(["name"]);
  });

  it("is left out at any depth", () => {
    class Nested extends FirestoreModel.Class<Nested>("Nested")({
      name: Schema.String,
      frozen: FirestoreModel.Record(
        Schema.String,
        FirestoreModel.Record(Schema.String, FirestoreModel.Immutable(Schema.String)),
      ),
    }) {}
    expectTypeOf<keyof (typeof Nested.update)["Type"]>().toEqualTypeOf<"name">();
    expect(Object.keys(Nested.update.from.fields)).toEqual(["name"]);
  });

  it.effect("is still read and created", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Archive.create)(
        Archive.create.make({ name: "a", frozen: { k: "v" } }),
      );
      expect(encoded).toStrictEqual({ name: "a", frozen: { k: "v" } });
    }),
  );
});

describe("a union field", () => {
  const Pending = FirestoreModel.Struct({
    status: Schema.Literal("pending"),
  });

  const Done = FirestoreModel.Struct({
    status: Schema.Literal("done"),
    completedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
    uri: Schema.String,
  });

  class Job extends FirestoreModel.Class<Job>("Job")({
    name: Schema.String,
    state: FirestoreModel.Union([Pending, Done]),
  }) {}

  it.effect("creates a member with the sentinels its fields take", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Job.create)(
        Job.create.make({
          name: "a",
          state: { status: "done", completedAt: FieldValue.serverTimestamp, uri: "gs://x" },
        }),
      );
      expect(encoded).toStrictEqual({
        name: "a",
        state: { status: "done", completedAt: FieldValue.serverTimestamp, uri: "gs://x" },
      });
    }),
  );

  it("creates any member in the shape `set` writes it", () => {
    expectTypeOf<(typeof Job.create)["Type"]["state"]>().toEqualTypeOf<
      | { readonly status: "pending" }
      | {
          readonly status: "done";
          readonly completedAt: Timestamp.Timestamp | FieldValue.ServerTimestamp;
          readonly uri: string;
        }
    >();
  });

  it.effect("fills in a member's constructor defaults where it is created", () =>
    Effect.gen(function* () {
      const Draft = FirestoreModel.Struct({
        status: Schema.Literal("draft"),
        revision: Schema.Finite.pipe(Schema.withConstructorDefault(Effect.succeed(0))),
      });
      class Doc extends FirestoreModel.Class<Doc>("Doc")({
        state: FirestoreModel.Union([Draft, Pending]),
      }) {}
      const encoded = yield* Schema.encodeEffect(Doc.create)(
        Doc.create.make({ state: { status: "draft" } }),
      );
      expect(encoded).toStrictEqual({ state: { status: "draft", revision: 0 } });
    }),
  );

  it.effect("reads into the member the data matches, narrowed by its literal", () =>
    Effect.gen(function* () {
      const job = yield* Schema.decodeUnknownEffect(Job)({
        name: "a",
        state: { status: "done", completedAt: Timestamp.makeUnsafe(1, 2), uri: "gs://x" },
      } as unknown);
      if (job.state.status !== "done") {
        return expect.unreachable();
      }
      expectTypeOf(job.state.uri).toEqualTypeOf<string>();
      expect(job.state.uri).toBe("gs://x");
      expect(job.state.completedAt).toStrictEqual(Timestamp.makeUnsafe(1, 2));
    }),
  );

  it.effect("fails to read data matching no member, with a schema issue", () =>
    Effect.gen(function* () {
      const error = yield* Schema.decodeUnknownEffect(Job)({
        name: "a",
        // `done` without what a done job holds.
        state: { status: "done" },
      } as unknown).pipe(Effect.flip);
      expect(Schema.isSchemaError(error)).toBe(true);
    }),
  );

  it("is a replacement where it is updated, and patched into one member under `unchecked`", () => {
    type Replacement = Patch.Replace<
      | { readonly status: "pending" }
      | {
          readonly status: "done";
          readonly completedAt: Timestamp.Timestamp | FieldValue.ServerTimestamp;
          readonly uri: string;
        }
    >;
    expectTypeOf<NonNullable<(typeof Job.update)["Type"]["state"]>>().toEqualTypeOf<Replacement>();
    expectTypeOf<NonNullable<(typeof Job.updateUnchecked)["Type"]["state"]>>().toEqualTypeOf<
      | {
          readonly completedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
          readonly uri?: string;
        }
      | Replacement
    >();
  });

  it("is written at its own path and at each key a member holds, in either mode", () => {
    expectTypeOf<keyof (typeof Job.update)["Encoded"]>().toEqualTypeOf<
      "name" | "state" | "state.completedAt" | "state.uri"
    >();
    expectTypeOf<(typeof Job.updateUnchecked)["Encoded"]>().toEqualTypeOf<
      (typeof Job.update)["Encoded"]
    >();
    expect(Object.keys(Job.update.from.fields).sort()).toEqual([
      "name",
      "state",
      "state.completedAt",
      "state.uri",
    ]);
  });

  it.effect.each(modes(Job))("writes a replacement whole, at its path ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const done = yield* Schema.encodeEffect(update)(
        update.make({
          state: Patch.replace({
            status: "done",
            completedAt: FieldValue.serverTimestamp,
            uri: "gs://x",
          }),
        }),
      );
      expect(done).toStrictEqual({
        state: { status: "done", completedAt: FieldValue.serverTimestamp, uri: "gs://x" },
      });
      const pending = yield* Schema.encodeEffect(update)(
        update.make({ state: Patch.replace({ status: "pending" }) }),
      );
      expect(pending).toStrictEqual({ state: { status: "pending" } });
    }),
  );

  it.effect.each(modes(Job))("refuses a replacement matching no member ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const exit = yield* Schema.encodeUnknownEffect(update)({
        state: Patch.replace({ status: "done" }),
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("refuses a patch into one member under `checked`, in the type and the encoding", () =>
    Effect.gen(function* () {
      expect(() =>
        // @ts-expect-error a pending job holds no `uri`
        Job.update.make({ state: { uri: "gs://y" } }),
      ).toThrow();
      const exit = yield* Schema.encodeUnknownEffect(Job.update)({
        state: { uri: "gs://y" },
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect.each(modes(Job))(
    "refuses the removal where every document holds it ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        expect(() =>
          // @ts-expect-error every document holds the state
          update.make({ state: FieldValue.deleteField }),
        ).toThrow();
        const exit = yield* Schema.encodeUnknownEffect(update)({
          state: FieldValue.deleteField,
        }).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
  );
});

describe("a union field a document may go without", () => {
  const Pending = FirestoreModel.Struct({ status: Schema.Literal("pending") });
  const Done = FirestoreModel.Struct({ status: Schema.Literal("done"), uri: Schema.String });

  class Job extends FirestoreModel.Class<Job>("Job")({
    state: FirestoreModel.Optional(FirestoreModel.Union([Pending, Done])),
  }) {}

  it("is an optional key where it is read and created", () => {
    expectTypeOf<(typeof Job)["Type"]["state"]>().toEqualTypeOf<
      { readonly status: "pending" } | { readonly status: "done"; readonly uri: string } | undefined
    >();
    expectTypeOf<(typeof Job.create)["Type"]["state"]>().toEqualTypeOf<
      { readonly status: "pending" } | { readonly status: "done"; readonly uri: string } | undefined
    >();
  });

  it("is a replacement or a removal where it is updated, and patched only under `unchecked`", () => {
    type Takes =
      | Patch.Replace<
          { readonly status: "pending" } | { readonly status: "done"; readonly uri: string }
        >
      | FieldValue.DeleteField;
    expectTypeOf<NonNullable<(typeof Job.update)["Type"]["state"]>>().toEqualTypeOf<Takes>();
    expectTypeOf<NonNullable<(typeof Job.updateUnchecked)["Type"]["state"]>>().toEqualTypeOf<
      { readonly uri?: string } | Takes
    >();
  });

  it.effect.each(modes(Job))("removes it whole ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ state: FieldValue.deleteField }),
      );
      expect(Object.keys(encoded)).toEqual(["state"]);
      expect(encoded.state).toBe(FieldValue.deleteField);
    }),
  );

  it.effect.each(modes(Job))("writes a replacement whole ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ state: Patch.replace({ status: "done", uri: "gs://x" }) }),
      );
      expect(encoded).toStrictEqual({ state: { status: "done", uri: "gs://x" } });
    }),
  );

  it.effect(
    "refuses a patch into it under `checked`, which would create it holding only the patch",
    () =>
      Effect.gen(function* () {
        expect(() =>
          // @ts-expect-error a patch would create it holding only the `uri`
          Job.update.make({ state: { uri: "gs://y" } }),
        ).toThrow();
        const exit = yield* Schema.encodeUnknownEffect(Job.update)({
          state: { uri: "gs://y" },
        }).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
  );

  it.effect("takes a patch into one member under `unchecked`", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Job.updateUnchecked)(
        Job.updateUnchecked.make({ state: { uri: "gs://y" } }),
      );
      expect(encoded).toStrictEqual({ "state.uri": "gs://y" });
    }),
  );
});

describe("a union field with a member holding a field no update writes", () => {
  const Draft = FirestoreModel.Struct({
    status: Schema.Literal("draft"),
    author: FirestoreModel.Immutable(Schema.String),
  });
  const Published = FirestoreModel.Struct({
    status: Schema.Literal("published"),
    url: Schema.String,
  });

  class Post extends FirestoreModel.Class<Post>("Post")({
    state: FirestoreModel.Union([Draft, Published]),
  }) {}

  it.effect("creates that member, the field and all", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Post.create)(
        Post.create.make({ state: { status: "draft", author: "alice" } }),
      );
      expect(encoded).toStrictEqual({ state: { status: "draft", author: "alice" } });
    }),
  );

  it("is replaced with the other members alone", () => {
    expectTypeOf<NonNullable<(typeof Post.update)["Type"]["state"]>>().toEqualTypeOf<
      Patch.Replace<{ readonly status: "published"; readonly url: string }>
    >();
  });

  it.effect.each(modes(Post))(
    "refuses a replacement with that member, in the type and the encoding ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        expect(() =>
          // @ts-expect-error `author` is written once
          update.make({ state: Patch.replace({ status: "draft", author: "bob" }) }),
        ).toThrow();
        const exit = yield* Schema.encodeUnknownEffect(update)({
          state: Patch.replace({ status: "draft", author: "bob" }),
        }).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
  );

  it.effect.each(modes(Post))("still replaces it with another member ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ state: Patch.replace({ status: "published", url: "/p" }) }),
      );
      expect(encoded).toStrictEqual({ state: { status: "published", url: "/p" } });
    }),
  );

  it("keeps the struct holding it from being replaced", () => {
    class Doc extends FirestoreModel.Class<Doc>("Doc")({
      post: FirestoreModel.Struct({
        title: Schema.String,
        state: FirestoreModel.Union([Draft, Published]),
      }),
    }) {}
    expect(() =>
      Doc.update.make({
        // @ts-expect-error a replacement could rewrite a draft's `author`
        post: Patch.replace({ title: "t", state: { status: "published", url: "/p" } }),
      }),
    ).toThrow();
  });
});

describe("a union field where no member may be replaced", () => {
  const Draft = FirestoreModel.Struct({
    status: Schema.Literal("draft"),
    author: FirestoreModel.Immutable(Schema.String),
  });
  const Locked = FirestoreModel.Struct({
    status: Schema.Literal("locked"),
    author: FirestoreModel.Immutable(Schema.String),
  });

  // Nor is either patched: the members share no field an update writes.
  class Post extends FirestoreModel.Class<Post>("Post")({
    title: Schema.String,
    state: FirestoreModel.Union([Draft, Locked]),
    archived: FirestoreModel.Optional(FirestoreModel.Union([Draft, Locked])),
  }) {}

  it("is left out of the update, unless a document may go without it", () => {
    expectTypeOf<keyof (typeof Post.update)["Type"]>().toEqualTypeOf<"title" | "archived">();
    expectTypeOf<
      NonNullable<(typeof Post.update)["Type"]["archived"]>
    >().toEqualTypeOf<FieldValue.DeleteField>();
    expect(Object.keys(Post.update.from.fields).sort()).toEqual(["archived", "title"]);
  });

  describe("but one member holds a key an update writes", () => {
    const Noted = FirestoreModel.Struct({
      status: Schema.Literal("noted"),
      author: FirestoreModel.Immutable(Schema.String),
      note: Schema.String,
    });

    class Doc extends FirestoreModel.Class<Doc>("Doc")({
      state: FirestoreModel.Union([Draft, Noted]),
    }) {}

    it.effect("takes nothing under `checked`, in the type and the encoding", () =>
      Effect.gen(function* () {
        expectTypeOf<NonNullable<(typeof Doc.update)["Type"]["state"]>>().toEqualTypeOf<never>();
        const exit = yield* Schema.encodeUnknownEffect(Doc.update)({
          state: { note: "n" },
        }).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* Schema.encodeEffect(Doc.update)(Doc.update.make({}))).toStrictEqual({});
      }),
    );

    it.effect("takes a patch into that member under `unchecked`, at the same paths", () =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(Doc.updateUnchecked)(
          Doc.updateUnchecked.make({ state: { note: "n" } }),
        );
        expect(encoded).toStrictEqual({ "state.note": "n" });
        expectTypeOf<(typeof Doc.updateUnchecked)["Encoded"]>().toEqualTypeOf<
          (typeof Doc.update)["Encoded"]
        >();
        expect(Object.keys(Doc.update.from.fields)).toEqual(["state.note"]);
      }),
    );
  });
});

describe("a union field patched at its Shared Fields", () => {
  const Pending = FirestoreModel.Struct({
    status: Schema.Literal("pending"),
    title: Schema.String,
  });
  const Done = FirestoreModel.Struct({
    status: Schema.Literal("done"),
    title: Schema.String,
    uri: Schema.String,
  });

  class Job extends FirestoreModel.Class<Job>("Job")({
    state: FirestoreModel.Union([Pending, Done]),
  }) {}

  it("takes a patch of its Shared Fields besides a replacement", () => {
    type Replacement = Patch.Replace<
      | { readonly status: "pending"; readonly title: string }
      | { readonly status: "done"; readonly title: string; readonly uri: string }
    >;
    expectTypeOf<NonNullable<(typeof Job.update)["Type"]["state"]>>().toEqualTypeOf<
      { readonly title?: string } | Replacement
    >();
    // Under `unchecked`, the key one member holds as well.
    expectTypeOf<NonNullable<(typeof Job.updateUnchecked)["Type"]["state"]>>().toEqualTypeOf<
      { readonly title?: string; readonly uri?: string } | Replacement
    >();
  });

  it("is written at the path of each Shared Field, besides its own", () => {
    expectTypeOf<keyof (typeof Job.update)["Encoded"]>().toEqualTypeOf<
      "state" | "state.title" | "state.uri"
    >();
    expectTypeOf<(typeof Job.update)["Encoded"]["state.title"]>().toEqualTypeOf<
      string | undefined
    >();
    expect(Object.keys(Job.update.from.fields).sort()).toEqual([
      "state",
      "state.title",
      "state.uri",
    ]);
  });

  it.effect.each(modes(Job))("writes a Shared Field at its dotted path ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(update.make({ state: { title: "t" } }));
      expect(encoded).toStrictEqual({ "state.title": "t" });
    }),
  );

  it.effect.each(modes(Job))(
    "writes a Shared Field through the canonical codec as every member stores it ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(FirestoreValue.toCodecFirestore(update))(
          update.make({ state: { title: "t" } }),
        );
        expect(encoded).toStrictEqual({ "state.title": "t" });
      }),
  );

  it.effect("refuses the literal the members are told apart by, in the type and the encoding", () =>
    Effect.gen(function* () {
      expect(() =>
        Job.update.make({
          // @ts-expect-error the members hold no `status` in common
          state: { status: "done" },
        }),
      ).toThrow();
      const exit = yield* Schema.encodeUnknownEffect(Job.update)({
        state: { status: "done" },
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("refuses a key some member goes without, in the type and the encoding", () =>
    Effect.gen(function* () {
      expect(() =>
        Job.update.make({
          // @ts-expect-error a pending job holds no `uri`
          state: { uri: "gs://x" },
        }),
      ).toThrow();
      const exit = yield* Schema.encodeUnknownEffect(Job.update)({
        state: { title: "t", uri: "gs://x" },
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  describe("where one member validates it further", () => {
    const Short = FirestoreModel.Struct({
      status: Schema.Literal("short"),
      title: Schema.String.check(Schema.isMaxLength(3)),
    });
    const Long = FirestoreModel.Struct({ status: Schema.Literal("long"), title: Schema.String });

    class Doc extends FirestoreModel.Class<Doc>("Doc")({
      state: FirestoreModel.Union([Long, Short]),
    }) {}

    it.effect.each(modes(Doc))(
      "refuses a value that member rejects, with a schema issue ($mode)",
      ({ update }) =>
        Effect.gen(function* () {
          const error = yield* Schema.encodeUnknownEffect(update)({
            state: { title: "too long" },
          }).pipe(Effect.flip);
          expect(Schema.isSchemaError(error)).toBe(true);
          const fits = yield* Schema.encodeEffect(update)(update.make({ state: { title: "ok" } }));
          expect(fits).toStrictEqual({ "state.title": "ok" });
        }),
    );
  });

  describe("where it is a struct in every member", () => {
    const Shipped = FirestoreModel.Struct({
      status: Schema.Literal("shipped"),
      meta: FirestoreModel.Struct({ owner: Schema.String, carrier: Schema.String }),
    });
    const Returned = FirestoreModel.Struct({
      status: Schema.Literal("returned"),
      meta: FirestoreModel.Struct({ owner: Schema.String, reason: Schema.String }),
    });

    class Order extends FirestoreModel.Class<Order>("Order")({
      state: FirestoreModel.Union([Shipped, Returned]),
    }) {}

    it("takes a patch of its own Shared Fields, written at their paths", () => {
      expectTypeOf<
        Extract<NonNullable<(typeof Order.update)["Type"]["state"]>, { readonly meta?: unknown }>
      >().toEqualTypeOf<{ readonly meta?: { readonly owner?: string } }>();
      expectTypeOf<keyof (typeof Order.update)["Encoded"]>().toEqualTypeOf<
        "state" | "state.meta.owner" | "state.meta.carrier" | "state.meta.reason"
      >();
      expect(Object.keys(Order.update.from.fields).sort()).toEqual([
        "state",
        "state.meta.carrier",
        "state.meta.owner",
        "state.meta.reason",
      ]);
    });

    it.effect("takes a key one member's struct holds under `unchecked`, at its path", () =>
      Effect.gen(function* () {
        expectTypeOf<
          Extract<
            NonNullable<(typeof Order.updateUnchecked)["Type"]["state"]>,
            { readonly meta?: unknown }
          >
        >().toEqualTypeOf<{
          readonly meta?: {
            readonly owner?: string;
            readonly carrier?: string;
            readonly reason?: string;
          };
        }>();
        const encoded = yield* Schema.encodeEffect(Order.updateUnchecked)(
          Order.updateUnchecked.make({ state: { meta: { carrier: "ups" } } }),
        );
        expect(encoded).toStrictEqual({ "state.meta.carrier": "ups" });
      }),
    );

    it.effect.each(modes(Order))("writes it at its dotted path ($mode)", ({ update }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(update)(
          update.make({ state: { meta: { owner: "alice" } } }),
        );
        expect(encoded).toStrictEqual({ "state.meta.owner": "alice" });
      }),
    );

    it.effect("refuses a key some member's struct goes without, in the type and the encoding", () =>
      Effect.gen(function* () {
        expect(() =>
          Order.update.make({
            // @ts-expect-error a returned order holds no `carrier`
            state: { meta: { carrier: "ups" } },
          }),
        ).toThrow();
        const exit = yield* Schema.encodeUnknownEffect(Order.update)({
          state: { meta: { carrier: "ups" } },
        }).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );
  });

  describe("taking a sentinel", () => {
    const Live = FirestoreModel.Struct({
      status: Schema.Literal("live"),
      seenAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
      visits: FirestoreModel.Number(Schema.Int),
      tags: FirestoreModel.Array(Schema.String),
      nickname: FirestoreModel.Optional(Schema.String),
      motto: FirestoreModel.Optional(Schema.String),
    });
    const Frozen = FirestoreModel.Struct({
      status: Schema.Literal("frozen"),
      seenAt: FirestoreSchema.Timestamp,
      visits: FirestoreModel.Number(Schema.Int),
      tags: FirestoreModel.Array(Schema.String),
      nickname: FirestoreModel.Optional(Schema.String),
      motto: Schema.String,
    });

    class Profile extends FirestoreModel.Class<Profile>("Profile")({
      state: FirestoreModel.Union([Live, Frozen]),
    }) {}

    it.effect.each(modes(Profile))("takes one every member takes ($mode)", ({ update }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(update)(
          update.make({
            state: {
              visits: FieldValue.increment(1),
              tags: FieldValue.arrayUnion("new"),
              nickname: FieldValue.deleteField,
            },
          }),
        );
        expect(encoded).toStrictEqual({
          "state.visits": FieldValue.increment(1),
          "state.tags": FieldValue.arrayUnion("new"),
          "state.nickname": FieldValue.deleteField,
        });
      }),
    );

    it.effect.each(modes(Profile))(
      "refuses one some member does not take, in the type and the encoding ($mode)",
      ({ update }) =>
        Effect.gen(function* () {
          expect(() =>
            update.make({
              // @ts-expect-error a frozen profile's `seenAt` is no server timestamp
              state: { seenAt: FieldValue.serverTimestamp },
            }),
          ).toThrow();
          expect(() =>
            update.make({
              // @ts-expect-error a frozen profile always holds a `motto`
              state: { motto: FieldValue.deleteField },
            }),
          ).toThrow();
          const exit = yield* Schema.encodeUnknownEffect(update)({
            state: { seenAt: FieldValue.serverTimestamp },
          }).pipe(Effect.exit);
          expect(Exit.isFailure(exit)).toBe(true);
          const stamped = yield* Schema.encodeEffect(update)(
            update.make({ state: { seenAt: Timestamp.makeUnsafe(1, 0), motto: "carpe" } }),
          );
          expect(stamped).toStrictEqual({
            "state.seenAt": Timestamp.makeUnsafe(1, 0),
            "state.motto": "carpe",
          });
        }),
    );
  });

  describe("where a document may go without it", () => {
    class Doc extends FirestoreModel.Class<Doc>("Doc")({
      state: FirestoreModel.Optional(FirestoreModel.Union([Pending, Done])),
    }) {}

    it.effect("refuses any patch under `checked`, in the type and the encoding", () =>
      Effect.gen(function* () {
        expect(() =>
          Doc.update.make({
            // @ts-expect-error the patch would create it holding only the title
            state: { title: "t" },
          }),
        ).toThrow();
        const exit = yield* Schema.encodeUnknownEffect(Doc.update)({
          state: { title: "t" },
        }).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );

    it.effect("takes it under `unchecked`, as an Optional struct does", () =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(Doc.updateUnchecked)(
          Doc.updateUnchecked.make({ state: { title: "t" } }),
        );
        expect(encoded).toStrictEqual({ "state.title": "t" });
      }),
    );

    it("is written at the same paths in either mode", () => {
      expectTypeOf<(typeof Doc.updateUnchecked)["Encoded"]>().toEqualTypeOf<
        (typeof Doc.update)["Encoded"]
      >();
      expect(Object.keys(Doc.update.from.fields).sort()).toEqual([
        "state",
        "state.title",
        "state.uri",
      ]);
    });
  });

  describe("where the members store it differently", () => {
    const Stamped = FirestoreModel.Struct({ status: Schema.Literal("stamped"), at: Schema.Date });
    const Written = FirestoreModel.Struct({
      status: Schema.Literal("written"),
      at: Schema.DateFromString,
    });

    class Doc extends FirestoreModel.Class<Doc>("Doc")({
      state: FirestoreModel.Union([Stamped, Written]),
    }) {}

    it("is typed as what every member takes", () => {
      expectTypeOf<NonNullable<(typeof Doc.update)["Type"]["state"]>>().toEqualTypeOf<
        | { readonly at?: Date }
        | Patch.Replace<
            | { readonly status: "stamped"; readonly at: Date }
            | { readonly status: "written"; readonly at: Date }
          >
      >();
    });

    it.effect.each(modes(Doc))(
      "refuses a value the members would store differently, with a schema issue ($mode)",
      ({ update }) =>
        Effect.gen(function* () {
          const error = yield* Schema.encodeUnknownEffect(update)({
            state: { at: new Date(0) },
          }).pipe(Effect.flip);
          expect(Schema.isSchemaError(error)).toBe(true);
        }),
    );
  });
});

describe("a union field patched into one member, unchecked", () => {
  const Pending = FirestoreModel.Struct({
    status: Schema.Literal("pending"),
    title: Schema.String,
  });
  const Done = FirestoreModel.Struct({
    status: Schema.Literal("done"),
    title: Schema.String,
    completedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
  });

  class Job extends FirestoreModel.Class<Job>("Job")({
    state: FirestoreModel.Union([Pending, Done]),
  }) {}

  it.effect("writes a key one member holds at its dotted path, sentinel and all", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Job.updateUnchecked)(
        Job.updateUnchecked.make({ state: { completedAt: FieldValue.serverTimestamp } }),
      );
      expect(encoded).toStrictEqual({ "state.completedAt": FieldValue.serverTimestamp });
      const stamped = yield* Schema.encodeEffect(Job.updateUnchecked)(
        Job.updateUnchecked.make({
          state: { title: "t", completedAt: Timestamp.makeUnsafe(1, 0) },
        }),
      );
      expect(stamped).toStrictEqual({
        "state.title": "t",
        "state.completedAt": Timestamp.makeUnsafe(1, 0),
      });
    }),
  );

  it.effect("refuses it under `checked`, in the type and the encoding", () =>
    Effect.gen(function* () {
      expect(() =>
        Job.update.make({
          // @ts-expect-error a pending job holds no `completedAt`
          state: { completedAt: FieldValue.serverTimestamp },
        }),
      ).toThrow();
      const exit = yield* Schema.encodeUnknownEffect(Job.update)({
        state: { completedAt: FieldValue.serverTimestamp },
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it("takes the key one member holds under `unchecked` alone", () => {
    type Replacement = Patch.Replace<
      | { readonly status: "pending"; readonly title: string }
      | {
          readonly status: "done";
          readonly title: string;
          readonly completedAt: Timestamp.Timestamp | FieldValue.ServerTimestamp;
        }
    >;
    expectTypeOf<NonNullable<(typeof Job.update)["Type"]["state"]>>().toEqualTypeOf<
      { readonly title?: string } | Replacement
    >();
    expectTypeOf<NonNullable<(typeof Job.updateUnchecked)["Type"]["state"]>>().toEqualTypeOf<
      | {
          readonly title?: string;
          readonly completedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
        }
      | Replacement
    >();
  });

  it("is written at the same paths in either mode", () => {
    expectTypeOf<keyof (typeof Job.update)["Encoded"]>().toEqualTypeOf<
      "state" | "state.title" | "state.completedAt"
    >();
    expectTypeOf<(typeof Job.updateUnchecked)["Encoded"]>().toEqualTypeOf<
      (typeof Job.update)["Encoded"]
    >();
    expect(Object.keys(Job.update.from.fields).sort()).toEqual([
      "state",
      "state.completedAt",
      "state.title",
    ]);
    expect(Object.keys(Job.updateUnchecked.from.fields).sort()).toEqual([
      "state",
      "state.completedAt",
      "state.title",
    ]);
  });

  it.effect.each(modes(Job))(
    "writes a patch both modes take the same in both ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        const encode = (schema: typeof Job.update | typeof Job.updateUnchecked) =>
          Schema.encodeUnknownEffect(FirestoreValue.toCodecFirestore(schema))({
            state: { title: "t" },
          });
        const encoded = yield* encode(update);
        expect(encoded).toStrictEqual({ "state.title": "t" });
        expect(encoded).toStrictEqual(yield* encode(Job.update));
        expect(encoded).toStrictEqual(yield* encode(Job.updateUnchecked));
      }),
  );

  describe("at a key several members hold, but not all", () => {
    const Draft = FirestoreModel.Struct({ status: Schema.Literal("draft") });
    const Short = FirestoreModel.Struct({
      status: Schema.Literal("short"),
      note: Schema.String.check(Schema.isMaxLength(3)),
      at: Schema.Date,
    });
    const Long = FirestoreModel.Struct({
      status: Schema.Literal("long"),
      note: Schema.String,
      at: Schema.DateFromString,
    });

    class Doc extends FirestoreModel.Class<Doc>("Doc")({
      state: FirestoreModel.Union([Draft, Short, Long]),
    }) {}

    it("is typed as what every member holding it takes, under `unchecked` alone", () => {
      expectTypeOf<
        Exclude<NonNullable<(typeof Doc.updateUnchecked)["Type"]["state"]>, Patch.Replace<any>>
      >().toEqualTypeOf<{ readonly note?: string; readonly at?: Date }>();
      expectTypeOf<
        Exclude<NonNullable<(typeof Doc.update)["Type"]["state"]>, Patch.Replace<any>>
      >().toEqualTypeOf<never>();
    });

    it.effect("takes a value every member holding it takes and stores the same way", () =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(Doc.updateUnchecked)(
          Doc.updateUnchecked.make({ state: { note: "ok" } }),
        );
        expect(encoded).toStrictEqual({ "state.note": "ok" });
      }),
    );

    it.effect("refuses a value one member holding it rejects, with a schema issue", () =>
      Effect.gen(function* () {
        const error = yield* Schema.encodeUnknownEffect(Doc.updateUnchecked)({
          state: { note: "too long" },
        }).pipe(Effect.flip);
        expect(Schema.isSchemaError(error)).toBe(true);
      }),
    );

    it.effect("refuses a value the members holding it store differently, with a schema issue", () =>
      Effect.gen(function* () {
        const error = yield* Schema.encodeUnknownEffect(Doc.updateUnchecked)({
          state: { at: new Date(0) },
        }).pipe(Effect.flip);
        expect(Schema.isSchemaError(error)).toBe(true);
      }),
    );

    it.effect("refuses it under `checked`, in the type and the encoding", () =>
      Effect.gen(function* () {
        expect(() =>
          Doc.update.make({
            // @ts-expect-error a draft holds no `note`
            state: { note: "ok" },
          }),
        ).toThrow();
        const exit = yield* Schema.encodeUnknownEffect(Doc.update)({
          state: { note: "ok" },
        }).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );
  });

  describe("at a key whose members' types have nothing in common", () => {
    const Small = FirestoreModel.Struct({
      status: Schema.Literal("small"),
      title: Schema.String,
      kind: Schema.String,
      size: Schema.String,
      at: Schema.Date,
      box: Schema.Struct({ width: Schema.Finite }),
      tags: Schema.Array(Schema.String),
    });
    const Large = FirestoreModel.Struct({
      status: Schema.Literal("large"),
      title: Schema.String,
      kind: Schema.Literals(["s", "m"]),
      size: Schema.Finite,
      at: FirestoreSchema.Timestamp,
      box: Schema.Struct({ height: Schema.Finite }),
      tags: Schema.Array(Schema.Finite),
    });

    class Doc extends FirestoreModel.Class<Doc>("Doc")({
      state: FirestoreModel.Union([Small, Large]),
    }) {}

    it("is patched and written at just the keys its type has, in either mode", () => {
      type Patchable = { readonly title?: string; readonly kind?: "s" | "m" };
      expectTypeOf<
        Exclude<NonNullable<(typeof Doc.update)["Type"]["state"]>, Patch.Replace<any>>
      >().toEqualTypeOf<Patchable>();
      expectTypeOf<
        Exclude<NonNullable<(typeof Doc.updateUnchecked)["Type"]["state"]>, Patch.Replace<any>>
      >().toEqualTypeOf<Patchable>();
      expectTypeOf<keyof (typeof Doc.update)["Encoded"]>().toEqualTypeOf<
        "state" | "state.title" | "state.kind"
      >();
      expect(Object.keys(Doc.update.from.fields).sort()).toEqual([
        "state",
        "state.kind",
        "state.title",
      ]);
      expect(Object.keys(Doc.updateUnchecked.from.fields).sort()).toEqual([
        "state",
        "state.kind",
        "state.title",
      ]);
    });

    it.effect.each(modes(Doc))("refuses such a key in the encoding ($mode)", ({ update }) =>
      Effect.gen(function* () {
        for (const state of [
          { size: "xl" },
          { size: 1 },
          { at: new Date(0) },
          { box: { width: 1 } },
          { tags: [] },
        ]) {
          const exit = yield* Schema.encodeUnknownEffect(update)({ state }).pipe(Effect.exit);
          expect(Exit.isFailure(exit)).toBe(true);
        }
        const kind = yield* Schema.encodeEffect(update)(update.make({ state: { kind: "s" } }));
        expect(kind).toStrictEqual({ "state.kind": "s" });
      }),
    );
  });
});

describe("a document that is a union", () => {
  const Pending = FirestoreModel.Struct({ status: Schema.Literal("pending") });
  const Done = FirestoreModel.Struct({ status: Schema.Literal("done"), uri: Schema.String });

  class TaskV1 extends FirestoreModel.Class<TaskV1>("TaskV1")({
    version: Schema.Literal(1),
    title: Schema.String,
    updatedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
  }) {}

  class TaskV2 extends FirestoreModel.Class<TaskV2>("TaskV2")({
    version: Schema.Literal(2),
    title: Schema.String,
    updatedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
    priority: Schema.Finite,
    state: FirestoreModel.Union([Pending, Done]),
  }) {}

  const Task = FirestoreModel.Union([TaskV1, TaskV2]);

  it("is what a collection holds, a subcollection's included", () => {
    const Tasks = Collection.make("tasks", Task);
    const Subtasks = Tasks.subcollection("subtasks", Task);
    // Assignment, not `expectTypeOf(...).toEqualTypeOf(...)`: a deep structural
    // comparison of two whole schemas costs millions of type instantiations.
    const schema: typeof Task = Tasks.schema;
    const subschema: typeof Task = Subtasks.schema;
    expect(schema).toBe(Task);
    expect(subschema).toBe(Task);
  });

  it.effect("is created as any member", () =>
    Effect.gen(function* () {
      expectTypeOf<(typeof Task.create)["Type"]>().toEqualTypeOf<
        | {
            readonly version: 1;
            readonly title: string;
            readonly updatedAt: Timestamp.Timestamp | FieldValue.ServerTimestamp;
          }
        | {
            readonly version: 2;
            readonly title: string;
            readonly updatedAt: Timestamp.Timestamp | FieldValue.ServerTimestamp;
            readonly priority: number;
            readonly state:
              | { readonly status: "pending" }
              | {
                  readonly status: "done";
                  readonly uri: string;
                };
          }
      >();
      const encoded = yield* Schema.encodeEffect(Task.create)(
        Task.create.make({
          version: 2,
          title: "t",
          updatedAt: FieldValue.serverTimestamp,
          priority: 1,
          state: { status: "done", uri: "gs://x" },
        }),
      );
      expect(encoded).toStrictEqual({
        version: 2,
        title: "t",
        updatedAt: FieldValue.serverTimestamp,
        priority: 1,
        state: { status: "done", uri: "gs://x" },
      });
    }),
  );

  it.effect.each(modes(Task))("is patched at its Shared Fields ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ title: "u", updatedAt: FieldValue.serverTimestamp }),
      );
      expect(encoded).toStrictEqual({ title: "u", updatedAt: FieldValue.serverTimestamp });
    }),
  );

  it("is typed as its Shared Fields, and a key one member holds under `unchecked` alone", () => {
    expectTypeOf<(typeof Task.update)["Type"]>().toEqualTypeOf<{
      readonly title?: string;
      readonly updatedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
    }>();
    expectTypeOf<(typeof Task.updateUnchecked)["Type"]>().toEqualTypeOf<{
      readonly title?: string;
      readonly updatedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
      readonly priority?: number;
      // A union one member holds, by the rule a union field is written by.
      readonly state?:
        | { readonly uri?: string }
        | Patch.Replace<
            { readonly status: "pending" } | { readonly status: "done"; readonly uri: string }
          >;
    }>();
  });

  it("is written at the same paths in either mode, and never whole", () => {
    expectTypeOf<keyof (typeof Task.update)["Encoded"]>().toEqualTypeOf<
      "title" | "updatedAt" | "priority" | "state" | "state.uri"
    >();
    expectTypeOf<(typeof Task.updateUnchecked)["Encoded"]>().toEqualTypeOf<
      (typeof Task.update)["Encoded"]
    >();
    for (const update of [Task.update, Task.updateUnchecked]) {
      expect(Object.keys(update.from.fields).sort()).toEqual([
        "priority",
        "state",
        "state.uri",
        "title",
        "updatedAt",
      ]);
    }
  });

  it.effect("refuses a key one member holds under `checked`, in the type and the encoding", () =>
    Effect.gen(function* () {
      expect(() =>
        Task.update.make({
          // @ts-expect-error a first-version task holds no `priority`
          priority: 2,
        }),
      ).toThrow();
      const exit = yield* Schema.encodeUnknownEffect(Task.update)({ priority: 2 }).pipe(
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      const encoded = yield* Schema.encodeEffect(Task.updateUnchecked)(
        Task.updateUnchecked.make({ priority: 2 }),
      );
      expect(encoded).toStrictEqual({ priority: 2 });
    }),
  );

  it.effect.each(modes(Task))(
    "refuses the discriminator, a replacement and a removal ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        for (const value of [
          { version: 2 },
          Patch.replace({ version: 1, title: "t", updatedAt: FieldValue.serverTimestamp }),
          FieldValue.deleteField,
        ]) {
          const exit = yield* Schema.encodeUnknownEffect(update)(value).pipe(Effect.exit);
          expect(Exit.isFailure(exit)).toBe(true);
        }
      }),
  );

  it.effect("reads as the member the document matches, and fails on one it matches none of", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(FirestoreValue.toCodecFirestore(Task));
      const updatedAt = Timestamp.makeUnsafe(1_700_000_000, 0);
      const v1 = yield* decode({ version: 1, title: "t", updatedAt });
      expect(v1).toBeInstanceOf(TaskV1);
      const v2 = yield* decode({
        version: 2,
        title: "t",
        updatedAt,
        priority: 1,
        state: { status: "pending" },
      });
      expect(v2).toBeInstanceOf(TaskV2);
      const error = yield* decode({ version: 3, title: "t", updatedAt }).pipe(Effect.flip);
      expect(Schema.isSchemaError(error)).toBe(true);
    }),
  );
});

describe("a union held at a key by every member of a union", () => {
  const Pending = FirestoreModel.Struct({ status: Schema.Literal("pending"), note: Schema.String });
  const Done = FirestoreModel.Struct({
    status: Schema.Literal("done"),
    note: Schema.String,
    uri: Schema.String,
  });
  const State = FirestoreModel.Union([Pending, Done]);

  class TaskV1 extends FirestoreModel.Class<TaskV1>("TaskV1")({
    version: Schema.Literal(1),
    state: State,
  }) {}

  class TaskV2 extends FirestoreModel.Class<TaskV2>("TaskV2")({
    version: Schema.Literal(2),
    priority: Schema.Finite,
    state: State,
  }) {}

  const Task = FirestoreModel.Union([TaskV1, TaskV2]);

  type Replacement = Patch.Replace<
    | { readonly status: "pending"; readonly note: string }
    | { readonly status: "done"; readonly note: string; readonly uri: string }
  >;

  it("is replaced, and patched at its own Shared Fields, by the rule a union field is", () => {
    expectTypeOf<NonNullable<(typeof Task.update)["Type"]["state"]>>().toEqualTypeOf<
      { readonly note?: string } | Replacement
    >();
    expectTypeOf<NonNullable<(typeof Task.updateUnchecked)["Type"]["state"]>>().toEqualTypeOf<
      { readonly note?: string; readonly uri?: string } | Replacement
    >();
  });

  it("is written at its own path and at each key its members hold, in either mode", () => {
    expectTypeOf<keyof (typeof Task.update)["Encoded"]>().toEqualTypeOf<
      "priority" | "state" | "state.note" | "state.uri"
    >();
    expectTypeOf<(typeof Task.updateUnchecked)["Encoded"]>().toEqualTypeOf<
      (typeof Task.update)["Encoded"]
    >();
    for (const update of [Task.update, Task.updateUnchecked]) {
      expect(Object.keys(update.from.fields).sort()).toEqual([
        "priority",
        "state",
        "state.note",
        "state.uri",
      ]);
    }
  });

  it.effect.each(modes(Task))("writes a replacement whole, at its path ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ state: Patch.replace({ status: "done", note: "n", uri: "gs://x" }) }),
      );
      expect(encoded).toStrictEqual({ state: { status: "done", note: "n", uri: "gs://x" } });
    }),
  );

  it.effect.each(modes(Task))("writes a Shared Field at its dotted path ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(update.make({ state: { note: "n" } }));
      expect(encoded).toStrictEqual({ "state.note": "n" });
    }),
  );

  it.effect("takes a key one of its members holds under `unchecked` alone", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Task.updateUnchecked)(
        Task.updateUnchecked.make({ state: { uri: "gs://x" } }),
      );
      expect(encoded).toStrictEqual({ "state.uri": "gs://x" });
      expect(() =>
        Task.update.make({
          // @ts-expect-error a pending state holds no `uri`
          state: { uri: "gs://x" },
        }),
      ).toThrow();
      const exit = yield* Schema.encodeUnknownEffect(Task.update)({
        state: { uri: "gs://x" },
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect.each(modes(Task))(
    "refuses a removal where every member holds it ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        const exit = yield* Schema.encodeUnknownEffect(update)({
          state: FieldValue.deleteField,
        }).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
  );

  describe("where it is a field of a union field", () => {
    const A = FirestoreModel.Struct({ kind: Schema.Literal("a"), state: State });
    const B = FirestoreModel.Struct({ kind: Schema.Literal("b"), state: State });

    class Doc extends FirestoreModel.Class<Doc>("Doc")({
      outer: FirestoreModel.Union([A, B]),
    }) {}

    it.effect.each(modes(Doc))("is replaced and patched at its path ($mode)", ({ update }) =>
      Effect.gen(function* () {
        const patched = yield* Schema.encodeEffect(update)(
          update.make({ outer: { state: { note: "n" } } }),
        );
        expect(patched).toStrictEqual({ "outer.state.note": "n" });
        const replaced = yield* Schema.encodeEffect(update)(
          update.make({ outer: { state: Patch.replace({ status: "pending", note: "n" }) } }),
        );
        expect(replaced).toStrictEqual({ "outer.state": { status: "pending", note: "n" } });
      }),
    );
  });

  describe("where every member may go without it", () => {
    class V1 extends FirestoreModel.Class<V1>("V1")({
      version: Schema.Literal(1),
      state: FirestoreModel.Optional(State),
    }) {}
    class V2 extends FirestoreModel.Class<V2>("V2")({
      version: Schema.Literal(2),
      state: FirestoreModel.Optional(State),
    }) {}
    const Doc = FirestoreModel.Union([V1, V2]);

    it("is removed besides, and patched under `unchecked` alone", () => {
      expectTypeOf<NonNullable<(typeof Doc.update)["Type"]["state"]>>().toEqualTypeOf<
        Replacement | FieldValue.DeleteField
      >();
      expectTypeOf<NonNullable<(typeof Doc.updateUnchecked)["Type"]["state"]>>().toEqualTypeOf<
        { readonly note?: string; readonly uri?: string } | Replacement | FieldValue.DeleteField
      >();
    });

    it.effect.each(modes(Doc))("writes the removal at its path ($mode)", ({ update }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(update)(
          update.make({ state: FieldValue.deleteField }),
        );
        expect(encoded).toStrictEqual({ state: FieldValue.deleteField });
      }),
    );

    it.effect("refuses a patch under `checked`, in the type and the encoding", () =>
      Effect.gen(function* () {
        expect(() =>
          Doc.update.make({
            // @ts-expect-error the patch would create it holding only the note
            state: { note: "n" },
          }),
        ).toThrow();
        const exit = yield* Schema.encodeUnknownEffect(Doc.update)({
          state: { note: "n" },
        }).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        const encoded = yield* Schema.encodeEffect(Doc.updateUnchecked)(
          Doc.updateUnchecked.make({ state: { note: "n" } }),
        );
        expect(encoded).toStrictEqual({ "state.note": "n" });
      }),
    );
  });

  describe("where the members hold different unions", () => {
    const Failed = FirestoreModel.Struct({
      status: Schema.Literal("failed"),
      note: Schema.String.check(Schema.isMaxLength(3)),
    });

    class V1 extends FirestoreModel.Class<V1>("V1")({
      version: Schema.Literal(1),
      state: State,
    }) {}
    class V2 extends FirestoreModel.Class<V2>("V2")({
      version: Schema.Literal(2),
      state: FirestoreModel.Union([Pending, Done, Failed]),
    }) {}
    const Doc = FirestoreModel.Union([V1, V2]);

    it("is replaced with what every member takes", () => {
      expectTypeOf<
        Extract<NonNullable<(typeof Doc.update)["Type"]["state"]>, Patch.Replace<any>>
      >().toEqualTypeOf<Replacement>();
    });

    it.effect.each(modes(Doc))(
      "refuses a replacement some member does not take, with a schema issue ($mode)",
      ({ update }) =>
        Effect.gen(function* () {
          const error = yield* Schema.encodeUnknownEffect(update)({
            state: Patch.replace({ status: "failed", note: "n" }),
          }).pipe(Effect.flip);
          expect(Schema.isSchemaError(error)).toBe(true);
          const encoded = yield* Schema.encodeEffect(update)(
            update.make({ state: Patch.replace({ status: "pending", note: "n" }) }),
          );
          expect(encoded).toStrictEqual({ state: { status: "pending", note: "n" } });
        }),
    );

    it.effect.each(modes(Doc))(
      "patches the Shared Fields of every member of every union ($mode)",
      ({ update }) =>
        Effect.gen(function* () {
          // A failed state takes no note this long.
          const error = yield* Schema.encodeUnknownEffect(update)({
            state: { note: "too long" },
          }).pipe(Effect.flip);
          expect(Schema.isSchemaError(error)).toBe(true);
          const encoded = yield* Schema.encodeEffect(update)(update.make({ state: { note: "n" } }));
          expect(encoded).toStrictEqual({ "state.note": "n" });
        }),
    );
  });
});

describe("a union field whose members hold tuples", () => {
  const Pair = FirestoreModel.Struct({
    kind: Schema.Literal("pair"),
    at: Schema.Tuple([Schema.String, Schema.String]),
  });
  const Single = FirestoreModel.Struct({
    kind: Schema.Literal("single"),
    at: Schema.Tuple([Schema.String]),
  });

  class Doc extends FirestoreModel.Class<Doc>("Doc")({
    state: FirestoreModel.Union([Pair, Single]),
  }) {}

  it("shares no key whose tuples differ in length, in the type and the paths", () => {
    expectTypeOf<keyof (typeof Doc.update)["Encoded"]>().toEqualTypeOf<"state">();
    expect(Object.keys(Doc.update.from.fields)).toEqual(["state"]);
  });

  it("shares a key where one tuple may go without the other's extra element", () => {
    const Loose = FirestoreModel.Struct({
      kind: Schema.Literal("loose"),
      at: Schema.Tuple([Schema.String, Schema.optionalKey(Schema.String)]),
    });

    class Mixed extends FirestoreModel.Class<Mixed>("Mixed")({
      state: FirestoreModel.Union([Loose, Single]),
    }) {}

    expectTypeOf<keyof (typeof Mixed.update)["Encoded"]>().toEqualTypeOf<"state" | "state.at">();
    expectTypeOf<
      Exclude<NonNullable<(typeof Mixed.update)["Type"]["state"]>, Patch.Replace<any>>
    >().toEqualTypeOf<{ readonly at?: readonly [string] }>();
    expect(Object.keys(Mixed.update.from.fields).sort()).toEqual(["state", "state.at"]);
  });
});
