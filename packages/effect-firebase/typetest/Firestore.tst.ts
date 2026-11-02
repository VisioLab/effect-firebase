import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as CollectionGroup from "@visiolab/effect-firebase/firestore/CollectionGroup";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import * as Firestore from "@visiolab/effect-firebase/firestore/Firestore";
import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
import * as Patch from "@visiolab/effect-firebase/firestore/Patch";
import type * as QuerySnapshot from "@visiolab/effect-firebase/firestore/QuerySnapshot";
import { Context, Effect, Schema, SchemaGetter, type Stream } from "effect";
import { describe, expect, test } from "tstyche";

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

declare const firestore: Firestore.Firestore;

const plainSet = firestore.setDoc(Plain.doc(Plain.id.make("a")), { title: "x" });
const stampedSet = firestore.setDoc(Stamped.doc(Stamped.id.make("a")), {
  title: "x",
  createdAt: FieldValue.serverTimestamp,
});
const stampedAdd = firestore.addDoc(Stamped.collection(), {
  title: "x",
  createdAt: FieldValue.serverTimestamp,
});
const stampedUpdate = firestore.updateDoc(Stamped.doc(Stamped.id.make("a")), { title: "y" });
const secretSet = firestore.setDoc(Secret.doc(Secret.id.make("a")), { token: "t" });
const secretUpdate = firestore.updateDoc(Secret.doc(Secret.id.make("a")), { token: "t" });

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  views: Schema.Finite,
}) {}

const Posts = Collection.make("posts", Post);
const hello = Posts.doc(Posts.id.make("hello"));

const Pending = FirestoreModel.Struct({ status: Schema.Literal("pending") });
const Done = FirestoreModel.Struct({ status: Schema.Literal("done"), uri: Schema.String });

class TaskV1 extends FirestoreModel.Class<TaskV1>("TaskV1")({
  version: Schema.Literal(1),
  title: Schema.String,
  state: FirestoreModel.Union([Pending, Done]),
}) {}

class TaskV2 extends FirestoreModel.Class<TaskV2>("TaskV2")({
  version: Schema.Literal(2),
  title: Schema.String,
  state: FirestoreModel.Union([Pending, Done]),
  priority: Schema.Finite,
}) {}

const Tasks = Collection.make("tasks", FirestoreModel.Union([TaskV1, TaskV2]));
const task = Tasks.doc(Tasks.id.make("task"));

const read = <C extends Collection.Any>(snapshot: DocumentSnapshot.DocumentSnapshot<C>) =>
  DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.die("missing");

interface Step {
  readonly by: number;
}
const Step = Context.Service<Step>("Step");

const portableRun = firestore.runTransaction(
  Effect.gen(function* () {
    const { by } = yield* Step;
    const tx = yield* Firestore.Transaction;
    yield* tx.setDoc(hello, { title: "Hello", views: by });
    return by;
  }),
);

const unionRun = firestore.runTransaction(
  Effect.gen(function* () {
    const tx = yield* Firestore.Transaction;
    return yield* read(yield* tx.getDoc(task));
  }),
);
declare const readBack: Effect.Success<typeof unionRun>;

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}

const UserPosts = Collection.make("users", User).subcollection("posts", Post);
const AllUserPosts = CollectionGroup.make(UserPosts);
const groupRead = firestore.getDocs(AllUserPosts);

class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}
class OrgPost extends FirestoreModel.Class<OrgPost>("OrgPost")({ headline: Schema.String }) {}

const OrgPosts = Collection.make("orgs", Org).subcollection("posts", OrgPost);
const AllPosts = CollectionGroup.make(UserPosts, OrgPosts);
const bothRead = firestore.getDocs(AllPosts);
declare const bothDocs: Effect.Success<typeof bothRead>["docs"];

describe("getDocs", () => {
  test("reads a collection, failing with a Firestore error alone", () => {
    expect(firestore.getDocs(Posts.collection())).type.toBe<
      Effect.Effect<QuerySnapshot.QuerySnapshot<typeof Posts>, Firestore.FirestoreError>
    >();
  });

  test("reads a Collection Group into the documents of its collection", () => {
    expect(firestore.getDocs(AllUserPosts)).type.toBe<
      Effect.Effect<
        QuerySnapshot.QuerySnapshot<typeof UserPosts>,
        Firestore.FirestoreError | Firestore.UndefinedCollectionError
      >
    >();
  });

  test("addresses each document of a Collection Group by its collection", () => {
    expect<Effect.Success<typeof groupRead>["docs"][number]>().type.toBe<
      DocumentSnapshot.Existing<typeof UserPosts>
    >();
  });

  test("reads a group of several collections, failing as any group read does", () => {
    expect<Effect.Error<typeof bothRead>>().type.toBe<
      Firestore.FirestoreError | Firestore.UndefinedCollectionError
    >();
  });

  test("addresses each document of a group of several by the one collection it is in", () => {
    expect<Effect.Success<typeof bothRead>["docs"][number]>().type.toBe<
      DocumentSnapshot.Existing<typeof UserPosts> | DocumentSnapshot.Existing<typeof OrgPosts>
    >();
  });

  test("filters the documents of one collection out of a group of several", () => {
    expect(bothDocs.filter(OrgPosts.contains)).type.toBe<
      Array<DocumentSnapshot.Existing<typeof OrgPosts>>
    >();
  });

  test("narrows a document of a group of several to its collection's id, ancestors and data", () => {
    const [doc] = bothDocs;
    if (OrgPosts.contains(doc)) {
      expect(doc).type.toBe<DocumentSnapshot.Existing<typeof OrgPosts>>();
      expect(doc.id).type.toBe<Collection.Id<typeof OrgPosts>>();
      expect(doc.ref.ancestors).type.toBe<Readonly<Collection.Ancestors<typeof OrgPosts>>>();
      expect(doc.data).type.toBe<Effect.Effect<OrgPost, Schema.SchemaError>>();
    } else {
      expect(doc).type.toBe<DocumentSnapshot.Existing<typeof UserPosts>>();
    }
  });
});

const groupStream = firestore.streamDocs(AllUserPosts);

describe("streamDocs", () => {
  test("streams a collection, failing with a Firestore error alone", () => {
    expect(firestore.streamDocs(Posts.collection())).type.toBe<
      Stream.Stream<QuerySnapshot.QuerySnapshot<typeof Posts>, Firestore.FirestoreError>
    >();
  });

  test("streams a Collection Group as the documents of its collection", () => {
    expect(groupStream).type.toBe<
      Stream.Stream<
        QuerySnapshot.QuerySnapshot<typeof UserPosts>,
        Firestore.FirestoreError | Firestore.UndefinedCollectionError
      >
    >();
  });

  test("addresses each document of a streamed Collection Group by its collection", () => {
    expect<Stream.Success<typeof groupStream>["docs"][number]>().type.toBe<
      DocumentSnapshot.Existing<typeof UserPosts>
    >();
  });
});

describe("DocumentSchema", () => {
  test("encodes a sentinel in the `create` shape without asking for a service", () => {
    expect<
      Collection.DocumentSchema<typeof Stamped>["create"]["EncodingServices"]
    >().type.toBe<never>();
  });
});

describe("setDoc", () => {
  test("fails with a Firestore error or a schema error, asking the caller for nothing", () => {
    expect(firestore.setDoc(hello, { title: "Hello", views: 1 })).type.toBe<
      Effect.Effect<void, Firestore.FirestoreError | Schema.SchemaError>
    >();
  });

  test("asks for nothing when a document encodes on its own", () => {
    expect<Effect.Services<typeof plainSet>>().type.toBe<never>();
  });

  test("asks for nothing where a document writes a sentinel", () => {
    expect<Effect.Services<typeof stampedSet>>().type.toBe<never>();
  });

  test("leaves anything else the document encodes through to the caller", () => {
    expect<Effect.Services<typeof secretSet>>().type.toBe<Secrets>();
  });
});

describe("addDoc", () => {
  test("asks for nothing where a document writes a sentinel", () => {
    expect<Effect.Services<typeof stampedAdd>>().type.toBe<never>();
  });
});

describe("updateDoc", () => {
  test("fails with a Firestore error or a schema error, asking the caller for nothing", () => {
    expect(firestore.updateDoc(hello, { views: 1 })).type.toBe<
      Effect.Effect<void, Firestore.FirestoreError | Schema.SchemaError>
    >();
  });

  test("refuses a checked patch of a key only one member of a union holds", () => {
    // @ts-expect-error 'priority' does not exist in type
    void firestore.updateDoc(task, { priority: 2 });
  });

  test("takes a replacement holding one member of a union", () => {
    expect(
      firestore.updateDoc(task, { state: Patch.replace({ status: "done", uri: "gs://x" }) }),
    ).type.toBe<Effect.Effect<void, Firestore.FirestoreError | Schema.SchemaError>>();
  });

  test("takes a replacement holding one member of a union in unchecked mode", () => {
    expect(
      firestore.updateDoc(
        task,
        { state: Patch.replace({ status: "done", uri: "gs://x" }) },
        { mode: "unchecked" },
      ),
    ).type.toBe<Effect.Effect<void, Firestore.FirestoreError | Schema.SchemaError>>();
  });

  test("refuses a replacement that matches no member of a union", () => {
    // @ts-expect-error Type '"lost"' is not assignable to type '"done"'
    void firestore.updateDoc(task, { state: Patch.replace({ status: "lost", uri: "gs://x" }) });
  });

  test("asks for nothing where a document writes a sentinel", () => {
    expect<Effect.Services<typeof stampedUpdate>>().type.toBe<never>();
  });

  test("leaves anything else the document encodes through to the caller", () => {
    expect<Effect.Services<typeof secretUpdate>>().type.toBe<Secrets>();
  });
});

describe("runTransaction", () => {
  test("hands the body the services of the caller, and asks for no Transaction", () => {
    expect(portableRun).type.toBe<
      Effect.Effect<number, Firestore.FirestoreError | Schema.SchemaError, Step>
    >();
  });

  test("reads a document of a union collection as the member it holds", () => {
    if (readBack.version === 2) {
      expect(readBack).type.toBe<TaskV2>();
    }
  });
});

class Profile extends FirestoreModel.Class<Profile>("Profile")({
  name: Schema.String,
  address: FirestoreModel.Optional(FirestoreModel.Struct({ city: Schema.String })),
}) {}

const Profiles = Collection.make("profiles", Profile);

const patch = { address: { city: "Berlin" } };

describe("Update", () => {
  test("is checked by default, and takes the model's `update` patch", () => {
    expect<Firestore.Update<typeof Profiles>>().type.toBe<(typeof Profile.update)["Type"]>();
  });

  test("takes the model's `updateUnchecked` patch in unchecked mode", () => {
    expect<Firestore.Update<typeof Profiles, "unchecked">>().type.toBe<
      (typeof Profile.updateUnchecked)["Type"]
    >();
  });

  test("refuses a patch into an optional struct when checked", () => {
    expect(patch).type.not.toBeAssignableTo<Firestore.Update<typeof Profiles>>();
  });

  test("accepts a patch into an optional struct when unchecked", () => {
    expect(patch).type.toBeAssignableTo<Firestore.Update<typeof Profiles, "unchecked">>();
  });
});

declare const hooks: Firestore.MakeOptions;

interface ReadOptions {
  readonly source?: "server" | "cache";
}
interface ListenOptions {
  readonly includeMetadataChanges?: boolean;
}
interface RichTransaction extends Firestore.Transaction {
  readonly getDocs: Firestore.Firestore["getDocs"];
}
const RichTransaction = Context.Service<RichTransaction>("RichTransaction");

declare const richHooks: Firestore.MakeOptions<ReadOptions, ListenOptions>;

/** An SDK's own transaction object, as `transactionFromCallback` is handed it. */
interface SdkTransaction {
  readonly id: string;
}
declare const run: Firestore.TransactionFromCallbackOptions<SdkTransaction>["run"];
declare const onError: (cause: unknown) => Firestore.FirestoreError;
/** The operations of a backend that can read many documents in a transaction. */
declare const readsMany: Required<Firestore.TransactionOperations>;
/** The operations of a backend that reads one document at a time in a transaction. */
declare const readsOne: Omit<Firestore.TransactionOperations, "getDocs">;

describe("make", () => {
  test("builds the portable Firestore", () => {
    expect(Firestore.make(hooks)).type.toBe<Firestore.Firestore>();
  });

  test("leaves the services a document encodes through to the caller of each write", () => {
    const made = Firestore.make(hooks);
    const set = made.setDoc(Secret.doc(Secret.id.make("a")), { token: "t" });
    const add = made.addDoc(Secret.collection(), { token: "t" });
    const update = made.updateDoc(Secret.doc(Secret.id.make("a")), { token: "t" });
    expect<Effect.Services<typeof set>>().type.toBe<Secrets>();
    expect<Effect.Services<typeof add>>().type.toBe<Secrets>();
    expect<Effect.Services<typeof update>>().type.toBe<Secrets>();
  });

  test("hands the read and listen hooks the options a richer service takes", () => {
    expect(
      Firestore.make({
        ...richHooks,
        getDoc: (path, options) => {
          expect(options).type.toBe<ReadOptions | undefined>();
          return Effect.succeed({ data: undefined });
        },
        streamDoc: (path, options) => {
          expect(options).type.toBe<ListenOptions | undefined>();
          return richHooks.streamDoc(path, options);
        },
      }),
    ).type.toBe<Firestore.Firestore>();
  });

  test("hands the read and listen hooks only undefined where no options are named", () => {
    void Firestore.make({
      ...hooks,
      getDocs: (selector, options) => {
        expect(options).type.toBe<undefined>();
        return hooks.getDocs(selector, options);
      },
    });
  });

  test("hands context a transaction that reads many where the operations do", () => {
    void Firestore.make({
      ...hooks,
      runTransaction: Firestore.transactionFromCallback({
        run,
        operations: () => readsMany,
        onError,
        context: (transaction) => {
          expect(transaction.getDocs).type.toBe<Firestore.Firestore["getDocs"]>();
          return Context.make(RichTransaction, transaction);
        },
      }),
    });
  });

  test("hands context a transaction that cannot read many where the operations cannot", () => {
    void Firestore.make({
      ...hooks,
      runTransaction: Firestore.transactionFromCallback({
        run,
        operations: () => readsOne,
        onError,
        context: (transaction) => {
          expect(transaction).type.not.toHaveProperty("getDocs");
          return Context.empty();
        },
      }),
    });
  });

  test("refuses to offer a transaction that cannot read many as one that can", () => {
    void Firestore.make({
      ...hooks,
      runTransaction: Firestore.transactionFromCallback({
        run,
        operations: () => readsOne,
        onError,
        // @ts-expect-error Property 'getDocs' is missing
        context: (transaction) => Context.make(RichTransaction, transaction),
      }),
    });
  });

  test("hands context a transaction that reads many from a hook built beforehand", () => {
    const runTransaction = Firestore.transactionFromCallback({
      run,
      operations: () => readsMany,
      onError,
      context: (transaction) => Context.make(RichTransaction, transaction),
    });
    expect(runTransaction).type.toBe<
      Firestore.RunTransaction<Required<Firestore.TransactionOperations>, RichTransaction>
    >();
    void Firestore.make({ ...hooks, runTransaction });
  });

  test("takes a transaction hook written as a value, with no context", () => {
    void Firestore.make({
      ...hooks,
      runTransaction: { run: (body) => body(readsOne) },
    });
  });

  test("refuses a hook failing with anything but a FirestoreError", () => {
    void Firestore.make({
      ...hooks,
      // @ts-expect-error Type 'string' is not assignable to type 'FirestoreError'
      setDoc: () => Effect.fail("nope"), // oxlint-disable-line effecttsgo/missing-effect-error
    });
  });
});
