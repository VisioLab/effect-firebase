import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import type * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import type * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import type * as Firestore from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import type * as GeoPoint from "@visiolab/effect-firebase/firestore/GeoPoint";
import type * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import { type Effect, Schema } from "effect";
import { describe, expect, test } from "tstyche";

describe("Timestamp", () => {
  test("is the portable Timestamp once decoded", () => {
    expect<(typeof FirestoreSchema.Timestamp)["Type"]>().type.toBe<Timestamp.Timestamp>();
  });

  test("is stored as the portable Timestamp", () => {
    expect<(typeof FirestoreSchema.Timestamp)["Encoded"]>().type.toBe<Timestamp.Timestamp>();
  });

  test("asks for no services to encode", () => {
    expect<(typeof FirestoreSchema.Timestamp)["EncodingServices"]>().type.toBe<never>();
  });

  test("asks for no services to decode", () => {
    expect<(typeof FirestoreSchema.Timestamp)["DecodingServices"]>().type.toBe<never>();
  });

  test("is made from the portable Timestamp", () => {
    expect<Parameters<typeof FirestoreSchema.Timestamp.make>[0]>().type.toBe<Timestamp.Timestamp>();
  });

  test("keeps its own name through a rebuild", () => {
    expect(FirestoreSchema.Timestamp.annotate({})).type.toBe<FirestoreSchema.Timestamp>();
  });
});

describe("GeoPoint", () => {
  test("is stored as the portable GeoPoint", () => {
    expect<(typeof FirestoreSchema.GeoPoint)["Encoded"]>().type.toBe<GeoPoint.GeoPoint>();
  });

  test("asks for no services to encode", () => {
    expect<(typeof FirestoreSchema.GeoPoint)["EncodingServices"]>().type.toBe<never>();
  });

  test("asks for no services to decode", () => {
    expect<(typeof FirestoreSchema.GeoPoint)["DecodingServices"]>().type.toBe<never>();
  });

  test("keeps its own name through a rebuild", () => {
    expect(FirestoreSchema.GeoPoint.annotate({})).type.toBe<FirestoreSchema.GeoPoint>();
  });
});

class Member extends FirestoreModel.Class<Member>("Member")({ name: Schema.String }) {}
class Article extends FirestoreModel.Class<Article>("Article")({ title: Schema.String }) {}

const Users = Collection.make("users", Member);
const Posts = Users.subcollection("posts", Article);

const PostReference = FirestoreSchema.DocumentReference(Posts);

describe("DocumentReference", () => {
  test("is typed by the collection it points into", () => {
    expect<(typeof PostReference)["Type"]>().type.toBe<
      Collection.DocumentReference<typeof Posts>
    >();
  });

  test("asks for no services to decode", () => {
    expect<(typeof PostReference)["DecodingServices"]>().type.toBe<never>();
  });

  test("asks for no services to encode", () => {
    expect<(typeof PostReference)["EncodingServices"]>().type.toBe<never>();
  });

  test("keeps its own name through a rebuild", () => {
    expect(PostReference.annotate({})).type.toBe<FirestoreSchema.DocumentReference<typeof Posts>>();
  });
});

declare const firestore: Firestore.Firestore;

interface FriendsKey extends Collection.Key<typeof Friends> {}

class Friend extends FirestoreModel.Class<Friend>("Friend")({
  name: Schema.String,
  bestFriend: Schema.NullOr(
    Schema.suspend((): FirestoreSchema.DocumentReference<FriendsKey> =>
      FirestoreSchema.DocumentReference(Friends),
    ),
  ),
}) {}
const Friends = Collection.make("friends", Friend);

declare const friend: Friend;

interface NotesKey extends Collection.Key<typeof Notes> {}

class Author extends FirestoreModel.Class<Author>("Author")({
  name: Schema.String,
  pinned: Schema.NullOr(
    Schema.suspend((): FirestoreSchema.DocumentReference<NotesKey> =>
      FirestoreSchema.DocumentReference(Notes),
    ),
  ),
}) {}
class Note extends FirestoreModel.Class<Note>("Note")({ title: Schema.String }) {}
const Authors = Collection.make("authors", Author);
const Notes = Authors.subcollection("notes", Note);

declare const author: Author;

interface WritersKey extends Collection.Key<typeof Writers> {}
interface EssaysKey extends Collection.Key<typeof Essays> {}

class Writer extends FirestoreModel.Class<Writer>("Writer")({
  name: Schema.String,
  featured: Schema.NullOr(
    Schema.suspend((): FirestoreSchema.DocumentReference<EssaysKey> =>
      FirestoreSchema.DocumentReference(Essays),
    ),
  ),
}) {}
class Essay extends FirestoreModel.Class<Essay>("Essay")({
  title: Schema.String,
  writer: Schema.suspend((): FirestoreSchema.DocumentReference<WritersKey> =>
    FirestoreSchema.DocumentReference(Writers),
  ),
}) {}
const Writers = Collection.make("writers", Writer);
const Essays = Collection.make("essays", Essay);

declare const writer: Writer;
declare const essay: Essay;

interface ProfilesKey extends Collection.Key<typeof Profiles> {}
interface ArchivedProfilesKey extends Collection.Key<typeof ArchivedProfiles> {}

class Profile extends FirestoreModel.Class<Profile>("Profile")({
  name: Schema.String,
  successor: Schema.NullOr(
    Schema.suspend((): FirestoreSchema.DocumentReference<ProfilesKey> =>
      FirestoreSchema.DocumentReference(Profiles),
    ),
  ),
  predecessor: Schema.NullOr(
    Schema.suspend((): FirestoreSchema.DocumentReference<ArchivedProfilesKey> =>
      FirestoreSchema.DocumentReference(ArchivedProfiles),
    ),
  ),
}) {}
const Profiles = Collection.make("profiles", Profile);
const ArchivedProfiles = Collection.make("archivedProfiles", Profile);

declare const profile: Profile;

describe("DocumentReference through a Collection Key", () => {
  describe("into the model's own collection", () => {
    test("reads back as a reference typed by the collection", () => {
      expect(friend.bestFriend).type.toBe<Collection.DocumentReference<typeof Friends> | null>();
    });

    test("reads the document through the collection's model", () => {
      if (friend.bestFriend !== null) {
        expect(firestore.getDoc(friend.bestFriend)).type.toBe<
          Effect.Effect<DocumentSnapshot.DocumentSnapshot<typeof Friends>, Firestore.FirestoreError>
        >();
      }
    });

    test("updates the document through the collection's model", () => {
      if (friend.bestFriend !== null) {
        expect(firestore.updateDoc(friend.bestFriend, { name: "Bob" })).type.toBe<
          Effect.Effect<void, Firestore.FirestoreError | Schema.SchemaError>
        >();
        // @ts-expect-error Type 'number' is not assignable to type 'string'
        void firestore.updateDoc(friend.bestFriend, { name: 1 });
      }
    });
  });

  describe("into a subcollection of the model's own collection", () => {
    test("reads back as a reference typed by the subcollection", () => {
      expect(author.pinned).type.toBe<Collection.DocumentReference<typeof Notes> | null>();
    });

    test("reads the document through the subcollection's model", () => {
      if (author.pinned !== null) {
        expect(firestore.getDoc(author.pinned)).type.toBe<
          Effect.Effect<DocumentSnapshot.DocumentSnapshot<typeof Notes>, Firestore.FirestoreError>
        >();
      }
    });

    test("updates the document through the subcollection's model", () => {
      if (author.pinned !== null) {
        expect(firestore.updateDoc(author.pinned, { title: "Hi" })).type.toBe<
          Effect.Effect<void, Firestore.FirestoreError | Schema.SchemaError>
        >();
        // @ts-expect-error 'name' does not exist in type
        void firestore.updateDoc(author.pinned, { name: "Bob" });
      }
    });
  });

  describe("between two models that reference each other", () => {
    test("reads back as references typed by each other's collection", () => {
      expect(writer.featured).type.toBe<Collection.DocumentReference<typeof Essays> | null>();
      expect(essay.writer).type.toBe<Collection.DocumentReference<typeof Writers>>();
    });

    test("reads each document through its collection's model", () => {
      expect(firestore.getDoc(essay.writer)).type.toBe<
        Effect.Effect<DocumentSnapshot.DocumentSnapshot<typeof Writers>, Firestore.FirestoreError>
      >();
      if (writer.featured !== null) {
        expect(firestore.getDoc(writer.featured)).type.toBe<
          Effect.Effect<DocumentSnapshot.DocumentSnapshot<typeof Essays>, Firestore.FirestoreError>
        >();
      }
    });

    test("updates each document through its collection's model", () => {
      expect(firestore.updateDoc(essay.writer, { name: "Ann" })).type.toBe<
        Effect.Effect<void, Firestore.FirestoreError | Schema.SchemaError>
      >();
      // @ts-expect-error 'title' does not exist in type
      void firestore.updateDoc(essay.writer, { title: "Hi" });
      if (writer.featured !== null) {
        expect(firestore.updateDoc(writer.featured, { title: "Hi" })).type.toBe<
          Effect.Effect<void, Firestore.FirestoreError | Schema.SchemaError>
        >();
        // @ts-expect-error 'name' does not exist in type
        void firestore.updateDoc(writer.featured, { name: "Ann" });
      }
    });
  });

  describe("into one of two collections backed by the same model", () => {
    test("reads back as a reference typed by the collection its key names", () => {
      expect(profile.successor).type.toBe<Collection.DocumentReference<typeof Profiles> | null>();
      expect(profile.predecessor).type.toBe<Collection.DocumentReference<
        typeof ArchivedProfiles
      > | null>();
    });

    test("is not a reference into the other collection", () => {
      expect(profile.predecessor).type.not.toBeAssignableTo<Collection.DocumentReference<
        typeof Profiles
      > | null>();
      expect(profile.successor).type.not.toBeAssignableTo<Collection.DocumentReference<
        typeof ArchivedProfiles
      > | null>();
    });

    test("reads and updates the document through the shared model", () => {
      if (profile.predecessor !== null) {
        expect(firestore.getDoc(profile.predecessor)).type.toBe<
          Effect.Effect<
            DocumentSnapshot.DocumentSnapshot<typeof ArchivedProfiles>,
            Firestore.FirestoreError
          >
        >();
        expect(firestore.updateDoc(profile.predecessor, { name: "Ann" })).type.toBe<
          Effect.Effect<void, Firestore.FirestoreError | Schema.SchemaError>
        >();
        // @ts-expect-error Type 'number' is not assignable to type 'string'
        void firestore.updateDoc(profile.predecessor, { name: 1 });
      }
    });
  });

  test("refuses a key that names another collection than the one referenced", () => {
    const wrong = (): FirestoreSchema.DocumentReference<FriendsKey> =>
      // @ts-expect-error is not assignable to type 'DocumentReference<FriendsKey>'
      FirestoreSchema.DocumentReference(Notes);
    void wrong;
  });

  test("refuses a key that names another collection backed by the same model", () => {
    const wrong = (): FirestoreSchema.DocumentReference<ProfilesKey> =>
      // @ts-expect-error is not assignable to type 'DocumentReference<ProfilesKey>'
      FirestoreSchema.DocumentReference(ArchivedProfiles);
    void wrong;
  });

  test("is typed exactly as a reference into the collection when given one", () => {
    expect<FirestoreSchema.DocumentReference<typeof Friends>["Type"]>().type.toBe<
      Collection.DocumentReference<typeof Friends>
    >();
  });
});

const Members = Collection.make("members", Member);

class Venue extends FirestoreModel.Class<Venue>("Venue")({
  openedAt: FirestoreSchema.Timestamp,
  where: FirestoreSchema.GeoPoint,
  owner: FirestoreSchema.DocumentReference(Members),
}) {}

describe("a model of the portable values", () => {
  test("encodes with no services", () => {
    expect<(typeof Venue)["EncodingServices"]>().type.toBe<never>();
  });

  test("encodes its create schema with no services", () => {
    expect<(typeof Venue.create)["EncodingServices"]>().type.toBe<never>();
  });

  test("encodes its update schema with no services", () => {
    expect<(typeof Venue.update)["EncodingServices"]>().type.toBe<never>();
  });
});

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  publishedAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
  views: FirestoreModel.Number(Schema.Finite),
  seenAt: FirestoreModel.Array(Schema.DateTimeUtc),
  subtitle: FirestoreModel.Optional(Schema.String),
  touchedAt: FirestoreModel.FieldOnly(["create", "update"])(FirestoreSchema.ServerTimestamp),
}) {}

describe("a model of the sentinels", () => {
  test("is created with no services", () => {
    expect<(typeof Post.create)["EncodingServices"]>().type.toBe<never>();
  });

  test("is updated with no services", () => {
    expect<(typeof Post.update)["EncodingServices"]>().type.toBe<never>();
  });

  test("is updated unchecked with no services", () => {
    expect<(typeof Post.updateUnchecked)["EncodingServices"]>().type.toBe<never>();
  });
});

describe("ServerTimestamp", () => {
  test("is stored as the portable sentinel", () => {
    expect<
      (typeof FirestoreSchema.ServerTimestamp)["Encoded"]
    >().type.toBe<FieldValue.ServerTimestamp>();
  });

  test("asks for no services to encode", () => {
    expect<(typeof FirestoreSchema.ServerTimestamp)["EncodingServices"]>().type.toBe<never>();
  });

  test("keeps its own name through a rebuild", () => {
    expect(
      FirestoreSchema.ServerTimestamp.annotate({}),
    ).type.toBe<FirestoreSchema.ServerTimestamp>();
  });
});

describe("ServerTimestampOr", () => {
  test("is built from a DateTime stored as a timestamp", () => {
    expect(FirestoreSchema.ServerTimestampOr).type.toBeCallableWith(Schema.DateTimeUtc);
  });

  test("is built from a Date stored as a timestamp", () => {
    expect(FirestoreSchema.ServerTimestampOr).type.toBeCallableWith(Schema.Date);
  });

  test("is built from the portable Timestamp", () => {
    expect(FirestoreSchema.ServerTimestampOr).type.toBeCallableWith(FirestoreSchema.Timestamp);
  });

  test("is not built from a string, which is stored as a string, not a timestamp", () => {
    // @ts-expect-error Argument of type 'String' is not assignable to parameter of type 'TimeSchema'
    FirestoreSchema.ServerTimestampOr(Schema.String);
  });

  test("is not built from a DateTime written as a string, which is stored as a string", () => {
    // @ts-expect-error Argument of type 'DateTimeUtcFromString' is not assignable to parameter of type 'TimeSchema'
    FirestoreSchema.ServerTimestampOr(Schema.DateTimeUtcFromString);
  });
});

describe("Increment", () => {
  test("asks for no services to encode", () => {
    expect<(typeof FirestoreSchema.Increment)["EncodingServices"]>().type.toBe<never>();
  });

  test("keeps its own name through a rebuild", () => {
    expect(FirestoreSchema.Increment.annotate({})).type.toBe<FirestoreSchema.Increment>();
  });
});

describe("IncrementOr", () => {
  test("keeps the schema it was handed, rather than widening to a number", () => {
    expect<FirestoreSchema.IncrementOr<Schema.Int>["Type"]>().type.toBe<
      number | FieldValue.Increment
    >();
  });

  test("is not built from a string, since the server has no number to add to", () => {
    // @ts-expect-error Argument of type 'String' is not assignable to parameter of type 'Codec<unknown, number, unknown, unknown>'
    FirestoreSchema.IncrementOr(Schema.String);
  });

  test("is not built from a number stored as a string", () => {
    // @ts-expect-error Argument of type 'FiniteFromString' is not assignable to parameter of type 'Codec<unknown, number, unknown, unknown>'
    FirestoreSchema.IncrementOr(Schema.FiniteFromString);
  });

  test("holds the type to the same schemas as the constructor", () => {
    expect<
      // @ts-expect-error Type 'String' does not satisfy the constraint 'Codec<unknown, number, unknown, unknown>'
      FirestoreSchema.IncrementOr<Schema.String>
    >().type.toBeAssignableTo<unknown>();
  });
});

describe("DeleteField", () => {
  test("asks for no services to encode", () => {
    expect<(typeof FirestoreSchema.DeleteField)["EncodingServices"]>().type.toBe<never>();
  });

  test("keeps its own name through a rebuild", () => {
    expect(FirestoreSchema.DeleteField.annotate({})).type.toBe<FirestoreSchema.DeleteField>();
  });
});

describe("DeleteFieldOr", () => {
  test("keeps the schema it was handed", () => {
    expect<FirestoreSchema.DeleteFieldOr<Schema.String>["Type"]>().type.toBe<
      string | FieldValue.DeleteField
    >();
  });
});

const Tags = FirestoreSchema.ArrayUnion(Schema.String);

describe("ArrayUnion", () => {
  test("asks for no services to encode, only whatever its elements ask for", () => {
    expect<(typeof Tags)["EncodingServices"]>().type.toBe<never>();
  });

  test("holds the elements of the schema it was built from", () => {
    expect<(typeof Tags)["Type"]>().type.toBe<FieldValue.ArrayUnion<string>>();
  });

  test("keeps its own name through a rebuild", () => {
    expect(Tags.annotate({})).type.toBe<FirestoreSchema.ArrayUnion<Schema.String>>();
  });
});

describe("ArrayRemove", () => {
  test("keeps its own name through a rebuild", () => {
    expect(FirestoreSchema.ArrayRemove(Schema.String).annotate({})).type.toBe<
      FirestoreSchema.ArrayRemove<Schema.String>
    >();
  });
});

describe("ArrayOr", () => {
  test("keeps the schema it was handed", () => {
    expect<FirestoreSchema.ArrayOr<Schema.String>["Type"]>().type.toBe<
      ReadonlyArray<string> | FieldValue.ArrayUnion<string> | FieldValue.ArrayRemove<string>
    >();
  });
});
