import { assert, describe, expect, it } from "@effect/vitest";
import { Context, Effect, Option, Schema, Stream, type Tracer } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as CollectionGroup from "../../src/firestore/CollectionGroup.ts";
import * as DocumentSnapshot from "../../src/firestore/DocumentSnapshot.ts";
import * as Firestore from "../../src/firestore/Firestore.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import type * as QuerySnapshot from "../../src/firestore/QuerySnapshot.ts";
import * as Timestamp from "../../src/firestore/Timestamp.ts";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Org extends FirestoreModel.Class<Org>("Org")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
class Announcement extends FirestoreModel.Class<Announcement>("Announcement")({
  headline: Schema.String,
}) {}

const Users = Collection.make("users", User);
const Orgs = Collection.make("orgs", Org);
const UserPosts = Users.subcollection("posts", Post);
const OrgPosts = Orgs.subcollection("posts", Announcement);
const Posts = CollectionGroup.make(UserPosts, OrgPosts);
const alice = Users.id.make("alice");

/** The span an effect runs in, which every effect in these tests runs in one. */
const currentSpan = Effect.orDie(Effect.currentSpan);

/** A hook no test scripted: reaching it is a bug in the test. */
const unscripted = (name: string) => () => Effect.die(`The ${name} hook was not scripted`);

/**
 * Hooks that answer only what a test scripts, and die on anything else, so a
 * test says exactly which hooks it expects to be called.
 */
const scripted = (hooks: Partial<Firestore.MakeOptions<unknown, unknown>>) =>
  Firestore.make({
    getDoc: unscripted("getDoc"),
    getDocs: unscripted("getDocs"),
    setDoc: unscripted("setDoc"),
    updateDoc: unscripted("updateDoc"),
    addDoc: unscripted("addDoc"),
    streamDoc: () => Stream.die("The streamDoc hook was not scripted"),
    streamDocs: () => Stream.die("The streamDocs hook was not scripted"),
    runTransaction: unscripted("runTransaction"),
    ...hooks,
  });

describe("getDoc", () => {
  it.effect("reads a document the hook found no data for as missing", () =>
    Effect.gen(function* () {
      const paths: Array<string> = [];
      const firestore = scripted({
        getDoc: (path) => {
          paths.push(path);
          return Effect.succeed({ data: undefined });
        },
      });

      const snapshot = yield* firestore.getDoc(Users.doc(alice));

      assert(DocumentSnapshot.isMissing(snapshot));
      expect(snapshot.ref.path).toBe("users/alice");
      expect(paths).toEqual(["users/alice"]);
    }),
  );

  it.effect("reads a document the hook found data for as there, decoding it", () =>
    Effect.gen(function* () {
      const firestore = scripted({
        getDoc: () => Effect.succeed({ data: { name: "Alice" } }),
      });

      const snapshot = yield* firestore.getDoc(Users.doc(alice));

      assert(DocumentSnapshot.isExisting(snapshot));
      expect(snapshot.ref.path).toBe("users/alice");
      const user = yield* snapshot.data;
      expect(user).toBeInstanceOf(User);
      expect(user.name).toBe("Alice");
    }),
  );

  it.effect("fails to read a document whose data is not made of Firestore Values", () =>
    Effect.gen(function* () {
      class Vector {
        readonly values = [1, 2];
      }
      const firestore = scripted({
        getDoc: () => Effect.succeed({ data: { name: new Vector() as never } }),
      });

      const error = yield* Effect.flip(firestore.getDoc(Users.doc(alice)));

      assert(error._tag === "FirestoreError");
      expect(error.message).toBe(
        'Failed to read the document "users/alice": Firestore holds a Vector at "name", which is not a Firestore Value',
      );
    }),
  );

  it.effect("hands on the error the hook failed with as it is", () =>
    Effect.gen(function* () {
      const failure = new Firestore.FirestoreError({
        message: "Denied",
        code: "permission-denied",
      });
      const firestore = scripted({ getDoc: () => Effect.fail(failure) });

      const error = yield* Effect.flip(firestore.getDoc(Users.doc(alice)));

      expect(error).toBe(failure);
    }),
  );

  it.effect("puts the extra the hook read on the snapshot, and hands on the caller's options", () =>
    Effect.gen(function* () {
      const received: Array<unknown> = [];
      const firestore = scripted({
        getDoc: (_, options) => {
          received.push(options);
          return Effect.succeed({ data: undefined, extra: { metadata: { fromCache: true } } });
        },
      });
      const getDoc = firestore.getDoc as unknown as (
        ref: Collection.DocumentReference<typeof Users>,
        options: unknown,
      ) => Effect.Effect<DocumentSnapshot.DocumentSnapshot<typeof Users> & { metadata: unknown }>;

      const snapshot = yield* getDoc(Users.doc(alice), { source: "cache" });

      expect(snapshot.metadata).toEqual({ fromCache: true });
      expect(snapshot.toJSON()).toEqual({
        _id: "DocumentSnapshot",
        _tag: "Missing",
        ref: "users/alice",
        metadata: { fromCache: true },
      });
      expect(received).toEqual([{ source: "cache" }]);
    }),
  );
});

describe("getDocs", () => {
  it.effect("reads one collection, addressing each document in it", () =>
    Effect.gen(function* () {
      const selectors: Array<Firestore.CollectionSelector> = [];
      const firestore = scripted({
        getDocs: (selector) => {
          selectors.push(selector);
          return Effect.succeed({
            docs: [
              { path: "users/alice/posts/hello", data: { title: "Hello" } },
              // A path the collection's model does not define: reading one
              // collection addresses by id, so it can never fail to match.
              { path: "elsewhere/bye", data: { title: "Bye" } },
            ],
          });
        },
      });

      const snapshot = yield* firestore.getDocs(UserPosts.collection(alice));

      expect(selectors).toEqual([{ _tag: "Collection", path: "users/alice/posts" }]);
      expect(snapshot.docs.map((doc) => doc.ref.path)).toEqual([
        "users/alice/posts/hello",
        "users/alice/posts/bye",
      ]);
      const post = yield* snapshot.docs[0]!.data;
      expect(post).toBeInstanceOf(Post);
      expect(post.title).toBe("Hello");
    }),
  );

  it.effect("matches each document of a Collection Group to the collection it lives in", () =>
    Effect.gen(function* () {
      const selectors: Array<Firestore.CollectionSelector> = [];
      const firestore = scripted({
        getDocs: (selector) => {
          selectors.push(selector);
          return Effect.succeed<Firestore.QueryRead>({
            docs: [
              { path: "users/alice/posts/hello", data: { title: "Hello" } },
              { path: "orgs/acme/posts/news", data: { headline: "News" } },
            ],
          });
        },
      });

      const snapshot = yield* firestore.getDocs(Posts);

      expect(selectors).toEqual([{ _tag: "CollectionGroup", id: "posts" }]);
      const [user, org] = snapshot.docs;
      assert(user !== undefined && UserPosts.contains(user));
      assert(org !== undefined && OrgPosts.contains(org));
      expect(user.ref.parent.path).toBe("users/alice/posts");
      expect((yield* user.data).title).toBe("Hello");
      expect((yield* org.data).headline).toBe("News");
    }),
  );

  it.effect("fails a Collection Group read that finds a document no member defines", () =>
    Effect.gen(function* () {
      const firestore = scripted({
        getDocs: () =>
          Effect.succeed({ docs: [{ path: "teams/red/posts/hello", data: { title: "Hello" } }] }),
      });

      const error = yield* Effect.flip(firestore.getDocs(Posts));

      assert(error._tag === "UndefinedCollectionError");
      expect(error.path).toBe("teams/red/posts/hello");
      expect(error.collectionId).toBe("posts");
    }),
  );

  it.effect("fails to read a document of many whose data is not made of Firestore Values", () =>
    Effect.gen(function* () {
      const firestore = scripted({
        getDocs: () =>
          Effect.succeed({
            docs: [{ path: "users/alice/posts/hello", data: { title: new Map() as never } }],
          }),
      });

      const error = yield* Effect.flip(firestore.getDocs(UserPosts.collection(alice)));

      assert(error._tag === "FirestoreError");
      expect(error.message).toContain('"users/alice/posts/hello"');
      expect(error.message).toContain('a Map at "title"');
    }),
  );

  it.effect(
    "puts the extras the hook read on the snapshots, and hands on the caller's options",
    () =>
      Effect.gen(function* () {
        const received: Array<unknown> = [];
        const firestore = scripted({
          getDocs: (_, options) => {
            received.push(options);
            return Effect.succeed({
              docs: [
                {
                  path: "users/alice/posts/hello",
                  data: { title: "Hello" },
                  extra: { metadata: { hasPendingWrites: true } },
                },
              ],
              extra: { metadata: { fromCache: true } },
            });
          },
        });
        const getDocs = firestore.getDocs as unknown as (
          ref: Collection.CollectionReference<typeof UserPosts>,
          options: unknown,
        ) => Effect.Effect<{ readonly metadata: unknown; readonly docs: ReadonlyArray<unknown> }>;

        const snapshot = yield* getDocs(UserPosts.collection(alice), { source: "server" });

        expect(snapshot.metadata).toEqual({ fromCache: true });
        expect(snapshot.docs[0]).toMatchObject({ metadata: { hasPendingWrites: true } });
        expect(received).toEqual([{ source: "server" }]);
      }),
  );

  it.effect("hands on the error the hook failed with as it is", () =>
    Effect.gen(function* () {
      const failure = new Firestore.FirestoreError({ message: "Unavailable" });
      const firestore = scripted({ getDocs: () => Effect.fail(failure) });

      expect(yield* Effect.flip(firestore.getDocs(Posts))).toBe(failure);
    }),
  );
});

describe("writes", () => {
  class Shop extends FirestoreModel.Class<Shop>("Shop")({
    openedAt: Schema.Date,
    address: FirestoreModel.Optional(FirestoreModel.Struct({ city: Schema.String })),
  }) {}
  const Shops = Collection.make("shops", Shop);
  const corner = Shops.id.make("corner");
  const openedAt = new Date(1_700_000_000_000);

  /** Hooks recording every write they were handed, keyed by hook. */
  const recording = () => {
    const writes: Array<readonly [string, string, Firestore.DocumentData]> = [];
    const record =
      (hook: string) =>
      (path: string, data: Firestore.DocumentData): Effect.Effect<void> =>
        Effect.sync(() => void writes.push([hook, path, data]));
    const firestore = scripted({
      setDoc: record("setDoc"),
      updateDoc: record("updateDoc"),
      addDoc: (path, data) => Effect.as(record("addDoc")(path, data), "new-id"),
    });
    return { firestore, writes };
  };

  it.effect("setDoc writes the model's create shape, encoded to Firestore Values", () =>
    Effect.gen(function* () {
      const { firestore, writes } = recording();

      yield* firestore.setDoc(Shops.doc(corner), new Shop({ openedAt }));

      expect(writes).toEqual([
        ["setDoc", "shops/corner", { openedAt: Timestamp.makeUnsafe(1_700_000_000, 0) }],
      ]);
    }),
  );

  it.effect(
    "addDoc writes the create shape, and addresses the new document in the collection",
    () =>
      Effect.gen(function* () {
        const { firestore, writes } = recording();
        const Branches = Shops.subcollection("branches", Shop);

        const ref = yield* firestore.addDoc(Branches.collection(corner), new Shop({ openedAt }));

        expect(writes).toEqual([
          ["addDoc", "shops/corner/branches", { openedAt: Timestamp.makeUnsafe(1_700_000_000, 0) }],
        ]);
        expect(ref.path).toBe("shops/corner/branches/new-id");
        expect(ref.id).toBe("new-id");
        expect(Branches.contains(ref)).toBe(true);
        expect(ref.parent.path).toBe("shops/corner/branches");
      }),
  );

  it.effect("updateDoc writes the update shape, keyed by field path", () =>
    Effect.gen(function* () {
      const { firestore, writes } = recording();

      yield* firestore.updateDoc(Shops.doc(corner), { openedAt });

      expect(writes).toEqual([
        ["updateDoc", "shops/corner", { openedAt: Timestamp.makeUnsafe(1_700_000_000, 0) }],
      ]);
    }),
  );

  it.effect("updateDoc writes through the unchecked update shape where asked to", () =>
    Effect.gen(function* () {
      const { firestore, writes } = recording();
      const patch = { address: { city: "Berlin" } };

      const checked = yield* Effect.flip(firestore.updateDoc(Shops.doc(corner), patch as never));
      assert(Schema.isSchemaError(checked));
      expect(writes).toEqual([]);

      yield* firestore.updateDoc(Shops.doc(corner), patch, { mode: "unchecked" });
      expect(writes).toEqual([["updateDoc", "shops/corner", { "address.city": "Berlin" }]]);
    }),
  );

  it.effect("hands on the error a write hook failed with as it is", () =>
    Effect.gen(function* () {
      const failure = new Firestore.FirestoreError({ message: "Denied" });
      const firestore = scripted({
        setDoc: () => Effect.fail(failure),
        updateDoc: () => Effect.fail(failure),
        addDoc: () => Effect.fail(failure),
      });

      expect(yield* Effect.flip(firestore.setDoc(Shops.doc(corner), new Shop({ openedAt })))).toBe(
        failure,
      );
      expect(yield* Effect.flip(firestore.updateDoc(Shops.doc(corner), { openedAt }))).toBe(
        failure,
      );
      expect(yield* Effect.flip(firestore.addDoc(Shops.collection(), new Shop({ openedAt })))).toBe(
        failure,
      );
    }),
  );
});

describe("streamDoc", () => {
  it.effect("decodes each read the hook emits into a snapshot, with its extra", () =>
    Effect.gen(function* () {
      const received: Array<unknown> = [];
      const firestore = scripted({
        streamDoc: (path, options) => {
          received.push([path, options]);
          return Stream.make(
            { data: undefined },
            { data: { name: "Alice" }, extra: { metadata: { fromCache: false } } },
          );
        },
      });
      const streamDoc = firestore.streamDoc as unknown as (
        ref: Collection.DocumentReference<typeof Users>,
        options: unknown,
      ) => Stream.Stream<DocumentSnapshot.DocumentSnapshot<typeof Users>>;

      const snapshots = yield* Stream.runCollect(
        streamDoc(Users.doc(alice), { includeMetadataChanges: true }),
      );

      const [missing, existing] = snapshots;
      assert(missing !== undefined && DocumentSnapshot.isMissing(missing));
      assert(existing !== undefined && DocumentSnapshot.isExisting(existing));
      expect((yield* existing.data).name).toBe("Alice");
      expect(existing).toMatchObject({ metadata: { fromCache: false } });
      expect(received).toEqual([["users/alice", { includeMetadataChanges: true }]]);
    }),
  );

  it.effect("fails at a read whose data is not made of Firestore Values", () =>
    Effect.gen(function* () {
      const firestore = scripted({
        streamDoc: () =>
          Stream.make({ data: { name: "Alice" } }, { data: { name: new Set() as never } }),
      });

      const error = yield* Effect.flip(Stream.runCollect(firestore.streamDoc(Users.doc(alice))));

      expect(error.message).toContain('a Set at "name"');
    }),
  );

  it.effect("hands on the error the hook's stream failed with as it is", () =>
    Effect.gen(function* () {
      const failure = new Firestore.FirestoreError({ message: "Dropped" });
      const firestore = scripted({ streamDoc: () => Stream.fail(failure) });

      expect(yield* Effect.flip(Stream.runCollect(firestore.streamDoc(Users.doc(alice))))).toBe(
        failure,
      );
    }),
  );
});

describe("streamDocs", () => {
  it.effect("decodes each read of one collection into a snapshot, with its extras", () =>
    Effect.gen(function* () {
      const received: Array<unknown> = [];
      const firestore = scripted({
        streamDocs: (selector, options) => {
          received.push([selector, options]);
          return Stream.make(
            { docs: [] },
            {
              docs: [{ path: "users/alice/posts/hello", data: { title: "Hello" } }],
              extra: { metadata: { fromCache: true } },
            },
          );
        },
      });
      const streamDocs = firestore.streamDocs as unknown as (
        ref: Collection.CollectionReference<typeof UserPosts>,
        options: unknown,
      ) => Stream.Stream<QuerySnapshot.QuerySnapshot<typeof UserPosts>>;

      const snapshots = yield* Stream.runCollect(
        streamDocs(UserPosts.collection(alice), { source: "cache" }),
      );

      expect(snapshots.map((snapshot) => snapshot.docs.map((doc) => doc.ref.path))).toEqual([
        [],
        ["users/alice/posts/hello"],
      ]);
      expect(snapshots[1]).toMatchObject({ metadata: { fromCache: true } });
      expect((yield* snapshots[1]!.docs[0]!.data).title).toBe("Hello");
      expect(received).toEqual([
        [{ _tag: "Collection", path: "users/alice/posts" }, { source: "cache" }],
      ]);
    }),
  );

  it.effect("matches each document of a Collection Group, failing at one no member defines", () =>
    Effect.gen(function* () {
      const selectors: Array<Firestore.CollectionSelector> = [];
      const emitted: Array<ReadonlyArray<string>> = [];
      const firestore = scripted({
        streamDocs: (selector) => {
          selectors.push(selector);
          return Stream.make(
            { docs: [{ path: "orgs/acme/posts/news", data: { headline: "News" } }] },
            { docs: [{ path: "teams/red/posts/hello", data: { title: "Hello" } }] },
          );
        },
      });

      const error = yield* Effect.flip(
        Stream.runForEach(firestore.streamDocs(Posts), (snapshot) =>
          Effect.sync(() => {
            assert(snapshot.docs.every((doc) => OrgPosts.contains(doc)));
            emitted.push(snapshot.docs.map((doc) => doc.ref.path));
          }),
        ),
      );

      expect(selectors).toEqual([{ _tag: "CollectionGroup", id: "posts" }]);
      expect(emitted).toEqual([["orgs/acme/posts/news"]]);
      assert(error._tag === "UndefinedCollectionError");
      expect(error.path).toBe("teams/red/posts/hello");
    }),
  );
});

describe("runTransaction", () => {
  /** A richer transaction a backend offers under a tag of its own. */
  const RichTransaction = Context.Service<Firestore.TransactionWithGetDocs>("test/RichTransaction");

  /**
   * A transaction hook that runs each body once, on a runtime of its own as an
   * SDK's callback would, over operations that record what they were asked.
   */
  const transactional = (
    operations: Partial<Firestore.TransactionOperations> = {},
    more: Partial<Firestore.MakeOptions<unknown, unknown>> = {},
  ) => {
    const calls: Array<unknown> = [];
    const hookOptions: Array<Firestore.TransactionHookOptions> = [];
    const firestore = scripted({
      runTransaction: (body, options) => {
        hookOptions.push(options);
        return Effect.flatten(
          Effect.promise(() =>
            Effect.runPromiseExit(
              body({
                getDoc: (path) => {
                  calls.push(["getDoc", path]);
                  return Effect.succeed({ data: { name: "Alice" } });
                },
                setDoc: (path, data) => Effect.sync(() => void calls.push(["setDoc", path, data])),
                updateDoc: (path, data) =>
                  Effect.sync(() => void calls.push(["updateDoc", path, data])),
                ...operations,
              }),
            ),
          ),
        );
      },
      ...more,
    });
    return { firestore, calls, hookOptions };
  };

  it.effect("provides a Transaction that reads and writes through the attempt's operations", () =>
    Effect.gen(function* () {
      const { firestore, calls } = transactional();

      const name = yield* firestore.runTransaction(
        Effect.gen(function* () {
          const tx = yield* Firestore.Transaction;
          const snapshot = yield* tx.getDoc(Users.doc(alice));
          assert(DocumentSnapshot.isExisting(snapshot));
          const user = yield* snapshot.data;
          yield* tx.setDoc(Users.doc(Users.id.make("bob")), new User({ name: "Bob" }));
          yield* tx.updateDoc(Users.doc(alice), { name: "Alicia" });
          return user.name;
        }),
      );

      expect(name).toBe("Alice");
      expect(calls).toEqual([
        ["getDoc", "users/alice"],
        ["setDoc", "users/bob", { name: "Bob" }],
        ["updateDoc", "users/alice", { name: "Alicia" }],
      ]);
    }),
  );

  it.effect("provides the transactionContext's tags, holding the same transaction", () =>
    Effect.gen(function* () {
      const { firestore } = transactional(
        {},
        {
          transactionContext: (transaction) => Context.make(RichTransaction, transaction),
        },
      );

      const [portable, rich] = yield* firestore.runTransaction(
        Effect.all([Effect.service(Firestore.Transaction), Effect.service(RichTransaction)]),
      );

      expect(rich).toBe(portable);
    }),
  );

  it.effect("reads many documents through the operations' read of many, where there is one", () =>
    Effect.gen(function* () {
      const selectors: Array<Firestore.CollectionSelector> = [];
      const { firestore } = transactional(
        {
          getDocs: (selector) => {
            selectors.push(selector);
            return Effect.succeed({
              docs: [{ path: "users/alice/posts/hello", data: { title: "Hello" } }],
            });
          },
        },
        { transactionContext: (transaction) => Context.make(RichTransaction, transaction) },
      );

      const paths = yield* firestore.runTransaction(
        Effect.gen(function* () {
          const tx = yield* RichTransaction;
          assert(tx.getDocs !== undefined);
          const snapshot = yield* tx.getDocs(Posts);
          assert(snapshot.docs.every((doc) => UserPosts.contains(doc)));
          return snapshot.docs.map((doc) => doc.ref.path);
        }),
      );

      expect(paths).toEqual(["users/alice/posts/hello"]);
      expect(selectors).toEqual([{ _tag: "CollectionGroup", id: "posts" }]);
    }),
  );

  it.effect("has no read of many where the operations have none", () =>
    Effect.gen(function* () {
      const { firestore } = transactional(
        {},
        { transactionContext: (transaction) => Context.make(RichTransaction, transaction) },
      );

      const tx = yield* firestore.runTransaction(Effect.service(RichTransaction));

      expect(tx.getDocs).toBeUndefined();
    }),
  );

  it.effect("hands on maxAttempts only where the caller set it", () =>
    Effect.gen(function* () {
      const { firestore, hookOptions } = transactional();

      yield* firestore.runTransaction(Effect.void);
      yield* firestore.runTransaction(Effect.void, {});
      yield* firestore.runTransaction(Effect.void, { maxAttempts: undefined });
      yield* firestore.runTransaction(Effect.void, { maxAttempts: 3 });

      expect(hookOptions).toStrictEqual([{}, {}, {}, { maxAttempts: 3 }]);
    }),
  );

  it.effect("fails with what the body or the hook failed with, as it is", () =>
    Effect.gen(function* () {
      const failure = new Firestore.FirestoreError({ message: "Contention" });
      const { firestore } = transactional({ getDoc: () => Effect.fail(failure) });

      const own = yield* Effect.flip(firestore.runTransaction(Effect.fail("own" as const)));
      expect(own).toBe("own");

      const read = yield* Effect.flip(
        firestore.runTransaction(
          Effect.flatMap(Firestore.Transaction, (tx) => tx.getDoc(Users.doc(alice))),
        ),
      );
      expect(read).toBe(failure);

      const hook = scripted({ runTransaction: () => Effect.fail(failure) });
      expect(yield* Effect.flip(hook.runTransaction(Effect.void))).toBe(failure);
    }),
  );

  it.effect("keeps what the caller's effect needs from context in the body", () =>
    Effect.gen(function* () {
      const Greeting = Context.Service<string>("test/Greeting");
      const { firestore } = transactional();

      const greeting = yield* firestore
        .runTransaction(Effect.service(Greeting))
        .pipe(Effect.provideService(Greeting, "hello"));

      expect(greeting).toBe("hello");
    }),
  );

  it.effect("runs in a span the body's own spans hang off, as do the transaction's reads", () =>
    Effect.gen(function* () {
      const spans: Array<string> = [];
      const { firestore } = transactional({
        getDoc: () =>
          Effect.map(currentSpan, (span) => {
            spans.push(`${span.name} < ${parentName(span)}`);
            return { data: undefined };
          }),
        setDoc: () => Effect.map(currentSpan, (span) => void spans.push(span.name)),
        updateDoc: () => Effect.map(currentSpan, (span) => void spans.push(span.name)),
      });

      yield* firestore.runTransaction(
        Effect.gen(function* () {
          const tx = yield* Firestore.Transaction;
          spans.push((yield* currentSpan).name);
          yield* tx.getDoc(Users.doc(alice));
          yield* tx.setDoc(Users.doc(alice), new User({ name: "Alice" }));
          yield* tx.updateDoc(Users.doc(alice), { name: "Alicia" });
        }),
      );

      expect(spans).toEqual([
        "Firestore.runTransaction",
        "Firestore.Transaction.getDoc < Firestore.runTransaction",
        "Firestore.Transaction.setDoc",
        "Firestore.Transaction.updateDoc",
      ]);
    }),
  );
});

/** The name of the span `span` hangs off, where it is one of ours. */
const parentName = (span: Tracer.Span): string | undefined => {
  const parent = Option.getOrUndefined(span.parent);
  return parent?._tag === "Span" ? parent.name : undefined;
};

describe("spans", () => {
  /** Records the span each hook runs in. */
  const spanOf = (spans: Array<string>) =>
    Effect.map(currentSpan, (span) => void spans.push(span.name));

  it.effect("runs every operation in a span named after it", () =>
    Effect.gen(function* () {
      const spans: Array<string> = [];
      const firestore = scripted({
        getDoc: () => Effect.as(spanOf(spans), { data: undefined }),
        getDocs: () => Effect.as(spanOf(spans), { docs: [] }),
        setDoc: () => spanOf(spans),
        updateDoc: () => spanOf(spans),
        addDoc: () => Effect.as(spanOf(spans), "new-id"),
        streamDoc: () => Stream.fromEffect(Effect.as(spanOf(spans), { data: undefined })),
        streamDocs: () => Stream.fromEffect(Effect.as(spanOf(spans), { docs: [] })),
      });

      yield* firestore.getDoc(Users.doc(alice));
      yield* firestore.getDocs(Posts);
      yield* firestore.setDoc(Users.doc(alice), new User({ name: "Alice" }));
      yield* firestore.updateDoc(Users.doc(alice), { name: "Alicia" });
      yield* firestore.addDoc(Users.collection(), new User({ name: "Bob" }));
      yield* Stream.runDrain(firestore.streamDoc(Users.doc(alice)));
      yield* Stream.runDrain(firestore.streamDocs(UserPosts.collection(alice)));

      expect(spans).toEqual([
        "Firestore.getDoc",
        "Firestore.getDocs",
        "Firestore.setDoc",
        "Firestore.updateDoc",
        "Firestore.addDoc",
        "Firestore.streamDoc",
        "Firestore.streamDocs",
      ]);
    }),
  );
});
