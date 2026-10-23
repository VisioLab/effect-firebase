import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import * as FirestoreValue from "@visiolab/effect-firebase/firestore/FirestoreValue";
import * as Patch from "@visiolab/effect-firebase/firestore/Patch";
import type * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import { Context, Effect, Schema, SchemaGetter } from "effect";
import type { VariantSchema } from "effect/schema";
import { describe, expect, test } from "tstyche";

class User extends FirestoreModel.Class<User>("User")({
  displayName: Schema.String,
  signupSource: FirestoreModel.Immutable(Schema.String),
  plan: FirestoreModel.FieldOnly(["read"])(Schema.Literals(["free", "paid"])),
  createdAt: FirestoreModel.Field({
    read: FirestoreSchema.Timestamp,
    create: FirestoreSchema.ServerTimestampOr(FirestoreSchema.Timestamp),
  }),
  updatedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
}) {}

describe("Class", () => {
  test("reads a document with no services at all", () => {
    expect<(typeof User)["DecodingServices"]>().type.toBe<never>();
  });
});

describe("create", () => {
  test("is written with no services", () => {
    expect<(typeof User.create)["EncodingServices"]>().type.toBe<never>();
  });

  test("refuses a field it only ever reads", () => {
    User.create.make({
      displayName: "alice",
      signupSource: "web",
      createdAt: FieldValue.serverTimestamp,
      updatedAt: FieldValue.serverTimestamp,
      // @ts-expect-error Object literal may only specify known properties, and 'plan' does not exist in type
      plan: "paid",
    });
  });
});

describe("update", () => {
  test("makes every field it carries optional", () => {
    expect<(typeof User.update)["Type"]>().type.toBe<{
      readonly displayName?: string;
      readonly updatedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
    }>();
  });

  test("refuses a field that is written once", () => {
    // @ts-expect-error Object literal may only specify known properties, and 'signupSource' does not exist in type
    User.update.make({ signupSource: "ios" });
  });
});

describe("a field written either way", () => {
  class Event extends FirestoreModel.Class<Event>("Event")({
    name: Schema.String,
    occurredAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
  }) {}

  test("is written with no services, rather than widening to unknown", () => {
    expect<(typeof Event.create)["EncodingServices"]>().type.toBe<never>();
  });

  test("is only built from a schema Firestore stores as a timestamp", () => {
    // @ts-expect-error Argument of type 'String' is not assignable to parameter of type 'TimeSchema'
    FirestoreModel.Timestamp(Schema.String);
  });
});

describe("Number", () => {
  class Page extends FirestoreModel.Class<Page>("Page")({
    slug: Schema.String,
    visits: FirestoreModel.Number(Schema.Int),
  }) {}

  test("takes a number alone in the read", () => {
    expect<(typeof Page)["Type"]["visits"]>().type.toBe<number>();
  });

  test("takes a number or a move in the update", () => {
    expect<(typeof Page.update)["Type"]>().type.toBe<{
      readonly slug?: string;
      readonly visits?: number | FieldValue.Increment;
    }>();
  });

  test("is only built from a schema stored as a number", () => {
    // @ts-expect-error Argument of type 'Boolean' is not assignable to parameter of type 'Codec<unknown, number, unknown, unknown>'
    FirestoreModel.Number(Schema.Boolean);
  });

  test("holds its type to the same schemas as the constructor", () => {
    expect<
      // @ts-expect-error Type 'Boolean' does not satisfy the constraint 'Codec<unknown, number, unknown, unknown>'
      FirestoreModel.Number<Schema.Boolean>
    >().type.toBeAssignableTo<unknown>();
  });
});

describe("Array", () => {
  class Article extends FirestoreModel.Class<Article>("Article")({
    name: Schema.String,
    tags: FirestoreModel.Array(Schema.String),
    editors: FirestoreModel.Optional(FirestoreModel.Array(Schema.String)),
    meta: FirestoreModel.Struct({
      keywords: FirestoreModel.Array(Schema.String),
    }),
  }) {}

  test("takes the array alone in the read", () => {
    expect<(typeof Article)["Type"]["tags"]>().type.toBe<ReadonlyArray<string>>();
  });

  test("takes the array alone in the create", () => {
    expect<(typeof Article.create)["Type"]["tags"]>().type.toBe<ReadonlyArray<string>>();
  });

  test("takes the array or a sentinel in the update", () => {
    expect<(typeof Article.update)["Type"]["tags"]>().type.toBe<
      | ReadonlyArray<string>
      | FieldValue.ArrayUnion<string>
      | FieldValue.ArrayRemove<string>
      | undefined
    >();
  });
});

describe("Optional", () => {
  class Profile extends FirestoreModel.Class<Profile>("Profile")({
    name: Schema.String,
    nickname: FirestoreModel.Optional(Schema.String),
    lastSeenAt: FirestoreModel.Optional(FirestoreModel.Timestamp(FirestoreSchema.Timestamp)),
    invitedBy: FirestoreModel.Optional(FirestoreModel.Immutable(Schema.String)),
  }) {}

  test("is an optional key where read", () => {
    expect<(typeof Profile)["Type"]["nickname"]>().type.toBe<string | undefined>();
  });

  test("is an optional key where created", () => {
    expect<(typeof Profile.create)["Type"]>().type.toBe<{
      readonly name: string;
      readonly nickname?: string;
      readonly lastSeenAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
      readonly invitedBy?: string;
    }>();
  });

  test("is removable where updated", () => {
    expect<(typeof Profile.update)["Type"]>().type.toBe<{
      readonly name?: string;
      readonly nickname?: string | FieldValue.DeleteField;
      readonly lastSeenAt?:
        | Timestamp.Timestamp
        | FieldValue.ServerTimestamp
        | FieldValue.DeleteField;
    }>();
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

  type T = (typeof Place.update)["Type"];
  type A = NonNullable<T["address"]>;

  test("takes every field at the top", () => {
    expect<keyof T>().type.toBe<"name" | "visits" | "address" | "tags">();
  });

  test("takes a nested partial of a struct, leaving out a field written once", () => {
    expect<keyof A>().type.toBe<"city" | "nickname" | "verifiedAt" | "geo">();
  });

  test("takes a partial or a replacement of a struct at any depth", () => {
    expect<NonNullable<A["geo"]>>().type.toBe<
      | { readonly lat?: number; readonly lng?: number }
      | Patch.Replace<{ readonly lat: number; readonly lng: number }>
    >();
  });

  test("takes a plain struct whole", () => {
    expect<NonNullable<T["tags"]>>().type.toBe<{ readonly primary: string }>();
  });

  test("refuses a field written once, at any depth", () => {
    // @ts-expect-error Object literal may only specify known properties, and 'country' does not exist in type
    Place.update.make({ address: { country: "FR" } });
  });

  test("writes at paths it names in its encoded type", () => {
    expect<keyof (typeof Place.update)["Encoded"]>().type.toBe<
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
  });

  test("writes a field of a struct at its path, typed as the field", () => {
    expect<(typeof Place.update)["Encoded"]["address.city"]>().type.toBe<string | undefined>();
  });

  test("writes a field of a nested struct at its path, typed as the field", () => {
    expect<(typeof Place.update)["Encoded"]["address.geo.lat"]>().type.toBe<number | undefined>();
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

  type Unchecked = NonNullable<(typeof Place.updateUnchecked)["Type"]["address"]>;
  type Fields = (typeof Place)[typeof VariantSchema.TypeId];

  test("is an optional key where it is read and created", () => {
    expect<(typeof Place)["Type"]["address"]>().type.toBe<
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

  test("is a replacement or a removal where it is updated", () => {
    expect<NonNullable<(typeof Place.update)["Type"]["address"]>>().type.toBe<
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

  test("takes a patch besides where it is updated unchecked", () => {
    expect<Exclude<Unchecked, Patch.Replace<any> | FieldValue.DeleteField>>().type.toBe<{
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
  });

  test("takes the same replacement and removal where it is updated unchecked", () => {
    expect<Extract<Unchecked, Patch.Replace<any> | FieldValue.DeleteField>>().type.toBe<
      NonNullable<(typeof Place.update)["Type"]["address"]>
    >();
  });

  test("is written at its own path and at each of its fields' paths", () => {
    expect<keyof (typeof Place.update)["Encoded"]>().type.toBe<
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
  });

  test("is written at the same paths in either mode", () => {
    expect<(typeof Place.updateUnchecked)["Encoded"]>().type.toBe<
      (typeof Place.update)["Encoded"]
    >();
  });

  test("names an update built from the fields alone checked", () => {
    expect<typeof Place.update>().type.toBe<FirestoreModel.Update<Fields>>();
  });

  test("names the checked mode in the type of the update", () => {
    expect<typeof Place.update>().type.toBe<FirestoreModel.Update<Fields, "checked">>();
  });

  test("names the unchecked mode in the type of the unchecked update", () => {
    expect<typeof Place.updateUnchecked>().type.toBe<FirestoreModel.Update<Fields, "unchecked">>();
  });

  test("takes different fields in either mode", () => {
    expect<FirestoreModel.UpdateFields<Fields, "unchecked">>().type.not.toBe<
      FirestoreModel.UpdateFields<Fields, "checked">
    >();
  });

  test("names the same paths in either mode", () => {
    expect<FirestoreModel.UpdatePaths<Fields, "unchecked">>().type.toBe<
      FirestoreModel.UpdatePaths<Fields, "checked">
    >();
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

  test("is the field made optional once", () => {
    expect(FirestoreModel.Optional(FirestoreModel.Optional(Address))).type.toBe<
      FirestoreModel.Optional<typeof Address>
    >();
  });

  test("is stored as the field made optional once", () => {
    expect<(typeof Place)["Encoded"]>().type.toBe<(typeof Once)["Encoded"]>();
  });

  test("is updated as the field made optional once", () => {
    expect<(typeof Place.update)["Type"]>().type.toBe<(typeof Once.update)["Type"]>();
  });

  test("is written unchecked at the paths of the field made optional once", () => {
    expect<(typeof Place.updateUnchecked)["Encoded"]>().type.toBe<
      (typeof Once.updateUnchecked)["Encoded"]
    >();
  });
});

describe("a field holding a document reference", () => {
  class Author extends FirestoreModel.Class<Author>("Author")({ name: Schema.String }) {}
  class Category extends FirestoreModel.Class<Category>("Category")({ label: Schema.String }) {}

  const Users = Collection.make("users", Author);
  const Categories = Collection.make("categories", Category);

  class Post extends FirestoreModel.Class<Post>("Post")({
    title: Schema.String,
    author: FirestoreSchema.DocumentReference(Users),
    meta: FirestoreModel.Struct({
      category: FirestoreSchema.DocumentReference(Categories),
    }),
  }) {}

  const post = Schema.decodeUnknownSync(FirestoreValue.toCodecFirestore(Post))({});

  test("decodes the paths a snapshot holds, typed by collection", () => {
    expect(post.author).type.toBe<Collection.DocumentReference<typeof Users>>();
  });
});

/** How a key is written, as a service a key schema takes. */
interface Casing {
  readonly encode: (key: string) => string;
}
const Casing = Context.Service<Casing>("Casing");

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

  const poll = Schema.decodeUnknownSync(Poll)({});

  type T = (typeof Poll.update)["Type"];
  type Member = { readonly name: string; readonly badges: ReadonlyArray<string> };
  type Unchecked = Exclude<
    NonNullable<(typeof Poll.updateUnchecked)["Type"]["members"]>,
    Patch.Replace<any>
  >[string];
  type E = (typeof Poll.update)["Encoded"];

  test("decodes a snapshot with the value's read form", () => {
    expect(poll.votes).type.toBe<{ readonly [x: string]: number }>();
  });

  test("decodes a struct at each key with its read form", () => {
    expect(poll.members).type.toBe<{
      readonly [x: string]: { readonly name: string; readonly badges: ReadonlyArray<string> };
    }>();
  });

  test("encodes a key with the services it takes", () => {
    expect<(typeof Lookup.update)["EncodingServices"]>().type.toBe<Casing>();
  });

  test("takes a patch, a replacement, and a removal per key", () => {
    expect<NonNullable<T["votes"]>>().type.toBe<
      | { readonly [x: string]: number | FieldValue.Increment | FieldValue.DeleteField }
      | Patch.Replace<{ readonly [x: string]: number | FieldValue.Increment }>
    >();
  });

  test("takes a replacement or a removal of a struct at one key, which may be missing", () => {
    expect<Exclude<NonNullable<T["members"]>, Patch.Replace<any>>>().type.toBe<{
      readonly [x: string]: Patch.Replace<Member> | FieldValue.DeleteField;
    }>();
  });

  test("takes a patch into a struct at one key where updated unchecked", () => {
    expect<Exclude<Unchecked, Patch.Replace<any> | FieldValue.DeleteField>>().type.toBe<{
      readonly name?: string;
      readonly badges?:
        | ReadonlyArray<string>
        | FieldValue.ArrayUnion<string>
        | FieldValue.ArrayRemove<string>;
    }>();
  });

  test("names a path at a given key in its encoded type", () => {
    expect<"votes.pizza">().type.toBeAssignableTo<keyof E>();
  });

  test("names a pattern for the paths of its keys in its encoded type", () => {
    expect<`votes.${string}`>().type.toBeAssignableTo<keyof E>();
  });

  test("names a pattern for the paths of a struct at each key in its encoded type", () => {
    expect<`members.${string}`>().type.toBeAssignableTo<keyof E>();
  });

  test("names a pattern for the paths of a Record inside a struct in its encoded type", () => {
    expect<`profile.links.${string}`>().type.toBeAssignableTo<keyof E>();
  });

  test("names its own path in its encoded type", () => {
    expect<"votes">().type.toBeAssignableTo<keyof E>();
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

  test("holds every key where read", () => {
    expect<(typeof Survey)["Type"]["counts"]>().type.toBe<{
      readonly yes: number;
      readonly no: number;
    }>();
  });

  test("names each path in its encoded type", () => {
    expect<keyof (typeof Survey.update)["Encoded"]>().type.toBe<
      "counts" | "counts.yes" | "counts.no" | "notes" | "notes.yes" | "notes.no"
    >();
  });

  test("names a key's path in its encoded form", () => {
    expect<keyof (typeof Ballot.update)["Encoded"]>().type.toBe<
      "answers" | "answers.Y" | "answers.N"
    >();
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

  test("is an optional key where it is read", () => {
    expect<(typeof Tally)["Type"]["votes"]>().type.toBe<
      { readonly [x: string]: number } | undefined
    >();
  });

  test("takes the removal at its own path in its encoded type", () => {
    expect<FieldValue.DeleteField>().type.toBeAssignableTo<
      (typeof Tally.update)["Encoded"]["votes"]
    >();
  });

  test("names its own path in its encoded type", () => {
    expect<"votes">().type.toBeAssignableTo<keyof (typeof Tally.update)["Encoded"]>();
  });
});

describe("a Record of a value no update writes", () => {
  class Archive extends FirestoreModel.Class<Archive>("Archive")({
    name: Schema.String,
    frozen: FirestoreModel.Record(Schema.String, FirestoreModel.Immutable(Schema.String)),
  }) {}

  class Nested extends FirestoreModel.Class<Nested>("Nested")({
    name: Schema.String,
    frozen: FirestoreModel.Record(
      Schema.String,
      FirestoreModel.Record(Schema.String, FirestoreModel.Immutable(Schema.String)),
    ),
  }) {}

  test("is left out of the update", () => {
    expect<keyof (typeof Archive.update)["Type"]>().type.toBe<"name">();
  });

  test("is left out at any depth", () => {
    expect<keyof (typeof Nested.update)["Type"]>().type.toBe<"name">();
  });
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

  type Replacement = Patch.Replace<
    | { readonly status: "pending" }
    | {
        readonly status: "done";
        readonly completedAt: Timestamp.Timestamp | FieldValue.ServerTimestamp;
        readonly uri: string;
      }
  >;

  const job = Schema.decodeUnknownSync(Job)({});

  test("creates any member in the shape `set` writes it", () => {
    expect<(typeof Job.create)["Type"]["state"]>().type.toBe<
      | { readonly status: "pending" }
      | {
          readonly status: "done";
          readonly completedAt: Timestamp.Timestamp | FieldValue.ServerTimestamp;
          readonly uri: string;
        }
    >();
  });

  test("reads into the member the data matches, narrowed by its literal", () => {
    if (job.state.status === "done") {
      expect(job.state.uri).type.toBe<string>();
    }
  });

  test("is a replacement where it is updated", () => {
    expect<NonNullable<(typeof Job.update)["Type"]["state"]>>().type.toBe<Replacement>();
  });

  test("is patched into one member under `unchecked`", () => {
    expect<NonNullable<(typeof Job.updateUnchecked)["Type"]["state"]>>().type.toBe<
      | {
          readonly completedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
          readonly uri?: string;
        }
      | Replacement
    >();
  });

  test("is written at its own path and at each key a member holds", () => {
    expect<keyof (typeof Job.update)["Encoded"]>().type.toBe<
      "name" | "state" | "state.completedAt" | "state.uri"
    >();
  });

  test("is written at the same paths in either mode", () => {
    expect<(typeof Job.updateUnchecked)["Encoded"]>().type.toBe<(typeof Job.update)["Encoded"]>();
  });
});

describe("a union field a document may go without", () => {
  const Pending = FirestoreModel.Struct({ status: Schema.Literal("pending") });
  const Done = FirestoreModel.Struct({ status: Schema.Literal("done"), uri: Schema.String });

  class Job extends FirestoreModel.Class<Job>("Job")({
    state: FirestoreModel.Optional(FirestoreModel.Union([Pending, Done])),
  }) {}

  type Takes =
    | Patch.Replace<
        { readonly status: "pending" } | { readonly status: "done"; readonly uri: string }
      >
    | FieldValue.DeleteField;

  test("is an optional key where it is read", () => {
    expect<(typeof Job)["Type"]["state"]>().type.toBe<
      { readonly status: "pending" } | { readonly status: "done"; readonly uri: string } | undefined
    >();
  });

  test("is an optional key where it is created", () => {
    expect<(typeof Job.create)["Type"]["state"]>().type.toBe<
      { readonly status: "pending" } | { readonly status: "done"; readonly uri: string } | undefined
    >();
  });

  test("is a replacement or a removal where it is updated", () => {
    expect<NonNullable<(typeof Job.update)["Type"]["state"]>>().type.toBe<Takes>();
  });

  test("is patched only under `unchecked`", () => {
    expect<NonNullable<(typeof Job.updateUnchecked)["Type"]["state"]>>().type.toBe<
      { readonly uri?: string } | Takes
    >();
  });
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

  test("is replaced with the other members alone", () => {
    expect<NonNullable<(typeof Post.update)["Type"]["state"]>>().type.toBe<
      Patch.Replace<{ readonly status: "published"; readonly url: string }>
    >();
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

  test("is left out of the update, unless a document may go without it", () => {
    expect<keyof (typeof Post.update)["Type"]>().type.toBe<"title" | "archived">();
  });

  test("is only removed where a document may go without it", () => {
    expect<
      NonNullable<(typeof Post.update)["Type"]["archived"]>
    >().type.toBe<FieldValue.DeleteField>();
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

    test("takes nothing under `checked`", () => {
      expect<NonNullable<(typeof Doc.update)["Type"]["state"]>>().type.toBe<never>();
    });

    test("is written at the same paths under `unchecked`", () => {
      expect<(typeof Doc.updateUnchecked)["Encoded"]>().type.toBe<(typeof Doc.update)["Encoded"]>();
    });
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

  type Replacement = Patch.Replace<
    | { readonly status: "pending"; readonly title: string }
    | { readonly status: "done"; readonly title: string; readonly uri: string }
  >;

  test("takes a patch of its Shared Fields besides a replacement", () => {
    expect<NonNullable<(typeof Job.update)["Type"]["state"]>>().type.toBe<
      { readonly title?: string } | Replacement
    >();
  });

  test("takes a key one member holds as well under `unchecked`", () => {
    expect<NonNullable<(typeof Job.updateUnchecked)["Type"]["state"]>>().type.toBe<
      { readonly title?: string; readonly uri?: string } | Replacement
    >();
  });

  test("is written at the path of each Shared Field, besides its own", () => {
    expect<keyof (typeof Job.update)["Encoded"]>().type.toBe<
      "state" | "state.title" | "state.uri"
    >();
  });

  test("writes a Shared Field at its path, typed as the field", () => {
    expect<(typeof Job.update)["Encoded"]["state.title"]>().type.toBe<string | undefined>();
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

    test("takes a patch of its own Shared Fields", () => {
      expect<
        Extract<NonNullable<(typeof Order.update)["Type"]["state"]>, { readonly meta?: unknown }>
      >().type.toBe<{ readonly meta?: { readonly owner?: string } }>();
    });

    test("is written at the paths of its fields", () => {
      expect<keyof (typeof Order.update)["Encoded"]>().type.toBe<
        "state" | "state.meta.owner" | "state.meta.carrier" | "state.meta.reason"
      >();
    });

    test("takes a key one member's struct holds under `unchecked`", () => {
      expect<
        Extract<
          NonNullable<(typeof Order.updateUnchecked)["Type"]["state"]>,
          { readonly meta?: unknown }
        >
      >().type.toBe<{
        readonly meta?: {
          readonly owner?: string;
          readonly carrier?: string;
          readonly reason?: string;
        };
      }>();
    });
  });

  describe("where a document may go without it", () => {
    class Doc extends FirestoreModel.Class<Doc>("Doc")({
      state: FirestoreModel.Optional(FirestoreModel.Union([Pending, Done])),
    }) {}

    test("is written at the same paths in either mode", () => {
      expect<(typeof Doc.updateUnchecked)["Encoded"]>().type.toBe<(typeof Doc.update)["Encoded"]>();
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

    test("is typed as what every member takes", () => {
      expect<NonNullable<(typeof Doc.update)["Type"]["state"]>>().type.toBe<
        | { readonly at?: Date }
        | Patch.Replace<
            | { readonly status: "stamped"; readonly at: Date }
            | { readonly status: "written"; readonly at: Date }
          >
      >();
    });
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

  type Replacement = Patch.Replace<
    | { readonly status: "pending"; readonly title: string }
    | {
        readonly status: "done";
        readonly title: string;
        readonly completedAt: Timestamp.Timestamp | FieldValue.ServerTimestamp;
      }
  >;

  test("takes the Shared Fields alone under `checked`", () => {
    expect<NonNullable<(typeof Job.update)["Type"]["state"]>>().type.toBe<
      { readonly title?: string } | Replacement
    >();
  });

  test("takes the key one member holds under `unchecked` alone", () => {
    expect<NonNullable<(typeof Job.updateUnchecked)["Type"]["state"]>>().type.toBe<
      | {
          readonly title?: string;
          readonly completedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
        }
      | Replacement
    >();
  });

  test("is written at its own path and at each key a member holds", () => {
    expect<keyof (typeof Job.update)["Encoded"]>().type.toBe<
      "state" | "state.title" | "state.completedAt"
    >();
  });

  test("is written at the same paths in either mode", () => {
    expect<(typeof Job.updateUnchecked)["Encoded"]>().type.toBe<(typeof Job.update)["Encoded"]>();
  });

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

    test("is typed as what every member holding it takes, under `unchecked`", () => {
      expect<
        Exclude<NonNullable<(typeof Doc.updateUnchecked)["Type"]["state"]>, Patch.Replace<any>>
      >().type.toBe<{ readonly note?: string; readonly at?: Date }>();
    });

    test("is not patched under `checked`", () => {
      expect<
        Exclude<NonNullable<(typeof Doc.update)["Type"]["state"]>, Patch.Replace<any>>
      >().type.toBe<never>();
    });
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

    type Patchable = { readonly title?: string; readonly kind?: "s" | "m" };

    test("is patched at just the keys its type has under `checked`", () => {
      expect<
        Exclude<NonNullable<(typeof Doc.update)["Type"]["state"]>, Patch.Replace<any>>
      >().type.toBe<Patchable>();
    });

    test("is patched at just the keys its type has under `unchecked`", () => {
      expect<
        Exclude<NonNullable<(typeof Doc.updateUnchecked)["Type"]["state"]>, Patch.Replace<any>>
      >().type.toBe<Patchable>();
    });

    test("is written at just the keys its type has", () => {
      expect<keyof (typeof Doc.update)["Encoded"]>().type.toBe<
        "state" | "state.title" | "state.kind"
      >();
    });
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

  test("is created as any member", () => {
    expect<(typeof Task.create)["Type"]>().type.toBe<
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
  });

  test("is typed as its Shared Fields", () => {
    expect<(typeof Task.update)["Type"]>().type.toBe<{
      readonly title?: string;
      readonly updatedAt?: Timestamp.Timestamp | FieldValue.ServerTimestamp;
    }>();
  });

  test("takes a key one member holds under `unchecked` alone", () => {
    expect<(typeof Task.updateUnchecked)["Type"]>().type.toBe<{
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

  test("is written at the paths of its members' fields, and never whole", () => {
    expect<keyof (typeof Task.update)["Encoded"]>().type.toBe<
      "title" | "updatedAt" | "priority" | "state" | "state.uri"
    >();
  });

  test("is written at the same paths in either mode", () => {
    expect<(typeof Task.updateUnchecked)["Encoded"]>().type.toBe<(typeof Task.update)["Encoded"]>();
  });
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

  test("is replaced, and patched at its own Shared Fields, by the rule a union field is", () => {
    expect<NonNullable<(typeof Task.update)["Type"]["state"]>>().type.toBe<
      { readonly note?: string } | Replacement
    >();
  });

  test("takes a key one of its members holds under `unchecked`", () => {
    expect<NonNullable<(typeof Task.updateUnchecked)["Type"]["state"]>>().type.toBe<
      { readonly note?: string; readonly uri?: string } | Replacement
    >();
  });

  test("is written at its own path and at each key its members hold", () => {
    expect<keyof (typeof Task.update)["Encoded"]>().type.toBe<
      "priority" | "state" | "state.note" | "state.uri"
    >();
  });

  test("is written at the same paths in either mode", () => {
    expect<(typeof Task.updateUnchecked)["Encoded"]>().type.toBe<(typeof Task.update)["Encoded"]>();
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

    test("is removed besides", () => {
      expect<NonNullable<(typeof Doc.update)["Type"]["state"]>>().type.toBe<
        Replacement | FieldValue.DeleteField
      >();
    });

    test("is patched under `unchecked` alone", () => {
      expect<NonNullable<(typeof Doc.updateUnchecked)["Type"]["state"]>>().type.toBe<
        { readonly note?: string; readonly uri?: string } | Replacement | FieldValue.DeleteField
      >();
    });
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

    test("is replaced with what every member takes", () => {
      expect<
        Extract<NonNullable<(typeof Doc.update)["Type"]["state"]>, Patch.Replace<any>>
      >().type.toBe<Replacement>();
    });
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
  const Loose = FirestoreModel.Struct({
    kind: Schema.Literal("loose"),
    at: Schema.Tuple([Schema.String, Schema.optionalKey(Schema.String)]),
  });

  class Doc extends FirestoreModel.Class<Doc>("Doc")({
    state: FirestoreModel.Union([Pair, Single]),
  }) {}

  class Mixed extends FirestoreModel.Class<Mixed>("Mixed")({
    state: FirestoreModel.Union([Loose, Single]),
  }) {}

  test("shares no key whose tuples differ in length", () => {
    expect<keyof (typeof Doc.update)["Encoded"]>().type.toBe<"state">();
  });

  test("shares a key where one tuple may go without the other's extra element", () => {
    expect<keyof (typeof Mixed.update)["Encoded"]>().type.toBe<"state" | "state.at">();
  });

  test("is patched at that key with the shorter tuple", () => {
    expect<
      Exclude<NonNullable<(typeof Mixed.update)["Type"]["state"]>, Patch.Replace<any>>
    >().type.toBe<{ readonly at?: readonly [string] }>();
  });
});
