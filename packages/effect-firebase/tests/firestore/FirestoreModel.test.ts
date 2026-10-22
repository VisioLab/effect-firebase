import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Context, DateTime, Effect, Exit, Layer, Option, Schema, SchemaGetter } from "effect";
import type { VariantSchema } from "effect/schema";
import * as Collection from "../../src/firestore/Collection.ts";
import * as FieldValue from "../../src/firestore/FieldValue.ts";
import { FirestoreEncoder } from "../../src/firestore/FirestoreEncoder.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";
import * as FirestoreValue from "../../src/firestore/FirestoreValue.ts";
import * as GeoPoint from "../../src/firestore/GeoPoint.ts";
import * as Patch from "../../src/firestore/Patch.ts";
import * as Timestamp from "../../src/firestore/Timestamp.ts";

/** A reference as an SDK mapping reads it back: by its path alone. */
const untyped = (path: string) => Option.getOrThrow(Collection.fromPathUntyped(path));

/** Stands in for an SDK's own sentinel. */
class SdkServerTimestamp {}

/** Stands in for an SDK's own sentinel, which carries what it is to add. */
class SdkIncrement {
  constructor(readonly by: number) {}
}

/** Stands in for an SDK's own sentinel. */
class SdkDeleteField {}

/** Stands in for an SDK's own sentinel, which carries the elements to add. */
class SdkArrayUnion {
  constructor(readonly elements: ReadonlyArray<unknown>) {}
}

/** Stands in for an SDK's own sentinel, which carries the elements to remove. */
class SdkArrayRemove {
  constructor(readonly elements: ReadonlyArray<unknown>) {}
}

const encoder = Layer.succeed(FirestoreEncoder)(
  FirestoreEncoder.of({
    timestamp: (value) => value,
    geoPoint: (value) => value,
    documentReference: (ref) => ref,
    serverTimestamp: () => new SdkServerTimestamp(),
    increment: (by) => new SdkIncrement(by),
    deleteField: () => new SdkDeleteField(),
    arrayUnion: (elements) => new SdkArrayUnion(elements),
    arrayRemove: (elements) => new SdkArrayRemove(elements),
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
      expect(Timestamp.isTimestamp(encoded.createdAt)).toBe(true);
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

  it("keeps the encoder it asks for, rather than widening to unknown", () => {
    expectTypeOf<(typeof Event.create)["EncodingServices"]>().toEqualTypeOf<FirestoreEncoder>();
  });

  it.effect("writes the instant this client picked", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Event.create)(
        Event.create.make({ name: "a", occurredAt: Timestamp.makeUnsafe(1, 2) }),
      );
      expect(Timestamp.isTimestamp(encoded.occurredAt)).toBe(true);
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
      expect((left as { seenAt: unknown }).seenAt).toBeInstanceOf(SdkServerTimestamp);
      expect((left as { leftAt: unknown }).leftAt).toBeInstanceOf(SdkServerTimestamp);
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
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
      expect(grown.tags).toBeInstanceOf(SdkArrayUnion);
      expect((grown.tags as SdkArrayUnion).elements).toEqual(["opinion"]);

      const shrunk = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ tags: FieldValue.arrayRemove("news") }),
      );
      expect(shrunk.tags).toBeInstanceOf(SdkArrayRemove);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes a sentinel at its path inside a struct", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ meta: { keywords: FieldValue.arrayUnion("effect") } }),
      );
      expect(Object.keys(encoded)).toEqual(["meta.keywords"]);
      expect(encoded["meta.keywords"]).toBeInstanceOf(SdkArrayUnion);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("composes with Optional, which takes the removal besides", () =>
    Effect.gen(function* () {
      const grown = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ editors: FieldValue.arrayUnion("alice") }),
      );
      expect(grown.editors).toBeInstanceOf(SdkArrayUnion);

      const removed = yield* Schema.encodeEffect(Article.update)(
        Article.update.make({ editors: FieldValue.deleteField }),
      );
      expect(removed.editors).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
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
      expect((grown.seenAt as SdkArrayUnion).elements[0]).toStrictEqual(Timestamp.makeUnsafe(1, 2));
    }).pipe(Effect.provide(encoder)),
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
      expect(Timestamp.isTimestamp(encoded["address.verifiedAt"])).toBe(true);
      expect(encoded.tags).toStrictEqual({ primary: "cafe" });
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes nothing for a struct handed nothing", () =>
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
      }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
  );

  it.effect.each(modes(Place))("removes the whole map ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ address: FieldValue.deleteField }),
      );
      expect(Object.keys(encoded)).toEqual(["address"]);
      expect(encoded.address).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
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
          verifiedAt: new SdkServerTimestamp(),
          geo: { lat: 1, lng: 2 },
          notes: {},
        });
      }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
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
      expect(encoded["address.nickname"]).toBeInstanceOf(SdkDeleteField);
      expect(encoded["address.verifiedAt"]).toBeInstanceOf(SdkServerTimestamp);
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("removes a plain value once", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Place.update)(
        Place.update.make({ nickname: FieldValue.deleteField }),
      );
      expect(encoded.nickname).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
  );

  it.effect.each(modes(User))("takes a replacement ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ address: Patch.replace({ city: "Berlin", zip: "10115" }) }),
      );
      expect(encoded).toStrictEqual({ address: { city: "Berlin", zip: "10115" } });
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("leaves it out of an update handed nothing for it", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Doc.update)(Doc.update.make({ name: "b" }));
      expect(encoded).toStrictEqual({ name: "b" });
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("leaves it out at any depth", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Doc.updateUnchecked)(
        Doc.updateUnchecked.make({ meta: { title: "t" }, extra: { note: "n" } }),
      );
      expect(encoded).toStrictEqual({ "meta.title": "t", "extra.note": "n" });
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
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

  it.effect("decodes the references a snapshot holds, typed by collection", () =>
    Effect.gen(function* () {
      const post = yield* Schema.decodeEffect(Post)({
        title: "hello",
        author: untyped("users/alice"),
        meta: { category: untyped("categories/news") },
      });
      expectTypeOf(post.author).toEqualTypeOf<Collection.DocumentReference<typeof Users>>();
      expect(post.author.collection).toBe(Users);
      expect(post.author.id).toBe("alice");
      expect(post.meta.category.collection).toBe(Categories);
      expect(post.meta.category.id).toBe("news");
    }),
  );

  it.effect("writes the SDK's own references on create", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Post.create)(
        Post.create.make({ title: "hello", author: alice, meta: { category: news } }),
      );
      expect(Collection.isDocumentReference(encoded.author)).toBe(true);
      expect(encoded.author.path).toBe("users/alice");
      expect(Collection.isDocumentReference(encoded.meta.category)).toBe(true);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes the SDK's own references on update, at their path", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Post.update)(
        Post.update.make({ author: alice, meta: { category: news } }),
      );
      expect(Object.keys(encoded).sort()).toEqual(["author", "meta.category"]);
      expect(Collection.isDocumentReference(encoded.author)).toBe(true);
      expect(Collection.isDocumentReference(encoded["meta.category"])).toBe(true);
      expect(encoded["meta.category"]?.path).toBe("categories/news");
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("is written as the SDK's own by update, rather than flattened as a map", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(Landmark.update)(
        Landmark.update.make({ location: GeoPoint.makeUnsafe(52.52, 13.405) }),
      );
      expect(Object.keys(encoded)).toEqual(["location"]);
      expect(GeoPoint.isGeoPoint(encoded.location)).toBe(true);
    }).pipe(Effect.provide(encoder)),
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
      expect(encoded.votes.pizza).toBeInstanceOf(SdkIncrement);
      expect(encoded.seenAt.alice).toBeInstanceOf(SdkServerTimestamp);
    }).pipe(Effect.provide(encoder)),
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
      expect(encoded["votes.pizza"]).toBeInstanceOf(SdkIncrement);
      expect(encoded["votes.sushi"]).toBe(3);
      expect(encoded["tags.pizza"]).toStrictEqual(new SdkArrayUnion(["cheesy"]));
      expect(encoded["tags.sushi"]).toStrictEqual(new SdkArrayRemove(["raw"]));
      expect(encoded["seenAt.alice"]).toBeInstanceOf(SdkServerTimestamp);
      expect(Timestamp.isTimestamp(encoded["seenAt.bob"])).toBe(true);
    }).pipe(Effect.provide(encoder)),
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
      expect(encoded["aliases.old"]).toBeInstanceOf(SdkDeleteField);
      expect(encoded["votes.gone"]).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect.each(modes(Poll))("writes a Record of Records at the full path ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({
          scores: { r1: { a: FieldValue.increment(1) }, r2: FieldValue.deleteField },
        }),
      );
      expect(Object.keys(encoded).sort()).toEqual(["scores.r1.a", "scores.r2"]);
      expect(encoded["scores.r1.a"]).toBeInstanceOf(SdkIncrement);
      expect(encoded["scores.r2"]).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect.each(modes(Poll))(
    "writes a Record inside a struct at the full path ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(update)(
          update.make({ profile: { links: { site: "https://example.com" } } }),
        );
        expect(encoded).toStrictEqual({ "profile.links.site": "https://example.com" });
      }).pipe(Effect.provide(encoder)),
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
      expect(encoded["members.m2"]).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
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
        expect(encoded).toStrictEqual({ "members.m1.badges": new SdkArrayUnion(["early"]) });
      }).pipe(Effect.provide(encoder)),
  );

  it.effect.each(modes(Poll))("writes a Record handed a replacement whole ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ votes: Patch.replace({ pizza: 0 }), aliases: Patch.replace({}) }),
      );
      expect(encoded).toStrictEqual({ votes: { pizza: 0 }, aliases: {} });
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("fails to encode a key no path can name, at any depth", () =>
    Effect.gen(function* () {
      const exit = yield* Schema.encodeEffect(Poll.update)({ scores: { r1: { "a.b": 1 } } }).pipe(
        Effect.exit,
      );
      expect(String(exit)).toContain(`"a.b" in "scores.r1"`);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes a key in its encoded form", () =>
    Effect.gen(function* () {
      class Lookup extends FirestoreModel.Class<Lookup>("Lookup")({
        byCode: FirestoreModel.Record(Upper, Schema.String),
      }) {}
      const encoded = yield* Schema.encodeEffect(Lookup.update)({ byCode: { de: "Germany" } });
      expect(encoded).toStrictEqual({ "byCode.DE": "Germany" });
    }).pipe(Effect.provide(encoder)),
  );

  it.effect("writes each key of a Record of Records in its encoded form", () =>
    Effect.gen(function* () {
      class Grid extends FirestoreModel.Class<Grid>("Grid")({
        cells: FirestoreModel.Record(Upper, FirestoreModel.Record(Upper, Schema.Finite)),
      }) {}
      const encoded = yield* Schema.encodeEffect(Grid.update)({ cells: { a: { b: 1 } } });
      expect(encoded).toStrictEqual({ "cells.A.B": 1 });
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
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
      expectTypeOf<(typeof Lookup.update)["EncodingServices"]>().toEqualTypeOf<
        FirestoreEncoder | Casing
      >();
      const encoded = yield* Schema.encodeEffect(Lookup.updateUnchecked)({
        byCode: { de: { name: "Germany" } },
      });
      expect(encoded).toStrictEqual({ "byCode.DE.name": "Germany" });
    }).pipe(
      Effect.provide(encoder),
      Effect.provideService(Casing, { encode: (s) => s.toUpperCase() }),
    ),
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
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
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
      expect(encoded["counts.yes"]).toBeInstanceOf(SdkIncrement);
      expect(encoded["notes.no"]).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
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
    }).pipe(Effect.provide(encoder)),
  );

  it.effect.each(modes(Tally))("removes the whole Record ($mode)", ({ update }) =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeEffect(update)(
        update.make({ votes: FieldValue.deleteField, counts: FieldValue.deleteField }),
      );
      expect(Object.keys(encoded).sort()).toEqual(["counts", "votes"]);
      expect(encoded.votes).toBeInstanceOf(SdkDeleteField);
    }).pipe(Effect.provide(encoder)),
  );

  it.effect.each(modes(Tally))(
    "is patched key by key where its keys come from the data, since any of them may be missing ($mode)",
    ({ update }) =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeEffect(update)(
          update.make({ votes: { pizza: FieldValue.increment(1) } }),
        );
        expect(Object.keys(encoded)).toEqual(["votes.pizza"]);
      }).pipe(Effect.provide(encoder)),
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
    expectTypeOf<(typeof Tally.update)["Encoded"]["votes"]>().toEqualTypeOf<unknown>();
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
    }).pipe(Effect.provide(encoder)),
  );
});
