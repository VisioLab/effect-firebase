import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Schema } from "effect";
import * as Collection from "../../src/firestore/Collection.ts";
import * as DocumentSnapshot from "../../src/firestore/DocumentSnapshot.ts";
import * as FirestoreModel from "../../src/firestore/FirestoreModel.ts";
import * as FirestoreSchema from "../../src/firestore/FirestoreSchema.ts";
import * as Timestamp from "../../src/firestore/Timestamp.ts";
import * as DocumentTrigger from "../../src/functions/DocumentTrigger.ts";

class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
}) {}

const Users = Collection.make("users", User);
const Posts = Users.subcollection("posts", Post);

const OnPostCreated = DocumentTrigger.created("onPostCreated", Posts);

const ref = Posts.doc(Users.id.make("alice"), Posts.id.make("hello"));

const createdAt = Timestamp.makeUnsafe(1_700_000_000, 0);

const event = (raw: unknown) =>
  DocumentTrigger.createdEvent({
    id: "event-1",
    time: "2026-11-07T12:00:00.000Z",
    snapshot: DocumentSnapshot.existing(ref, raw),
  });

class Failed extends Schema.TaggedError<Failed>()("Failed", {}) {}

const serve = (
  live: Layer.Layer<DocumentTrigger.HandlerFor<typeof OnPostCreated>>,
  input: DocumentTrigger.Event<typeof OnPostCreated>,
) =>
  DocumentTrigger.serve(OnPostCreated).pipe(
    Effect.flatMap((run) => run(input)),
    Effect.provide(live),
  );

describe("DocumentTrigger.created", () => {
  it("declares a trigger on a collection under its name", () => {
    expect(OnPostCreated.kind).toBe("DocumentTrigger");
    expect(OnPostCreated.name).toBe("onPostCreated");
    expect(OnPostCreated.event).toBe("created");
    expect(OnPostCreated.collection).toBe(Posts);
  });
});

describe("DocumentTrigger.createdEvent", () => {
  it("carries the snapshot, its ref, and the CloudEvent's id and time", () => {
    const snapshot = DocumentSnapshot.existing(ref, { title: "Hello", createdAt });
    const built = DocumentTrigger.createdEvent({
      id: "event-1",
      time: "2026-11-07T12:00:00.000Z",
      snapshot,
    });
    expect(built.snapshot).toBe(snapshot);
    expect(built.ref).toBe(ref);
    expect(built.id).toBe("event-1");
    expect(built.time).toBe("2026-11-07T12:00:00.000Z");
  });
});

describe("DocumentTrigger.serve", () => {
  it.effect("runs the event through the handler, which decodes the data through the model", () =>
    Effect.gen(function* () {
      const received: Array<unknown> = [];
      const live = DocumentTrigger.toLayer(OnPostCreated, (input) =>
        Effect.gen(function* () {
          const post = yield* input.snapshot.data;
          received.push({ ancestors: input.ref.ancestors, id: input.ref.id, post });
        }),
      );
      yield* serve(live, event({ title: "Hello", createdAt }));
      expect(received).toEqual([
        { ancestors: ["alice"], id: "hello", post: new Post({ title: "Hello", createdAt }) },
      ]);
    }),
  );

  it.effect("decodes nothing unless the handler reads .data", () =>
    Effect.gen(function* () {
      const live = DocumentTrigger.toLayer(OnPostCreated, () => Effect.void);
      const exit = yield* Effect.exit(serve(live, event({ title: 42 })));
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("fails .data with a SchemaError on bad data, and the handler can still read .raw", () =>
    Effect.gen(function* () {
      const raws: Array<unknown> = [];
      const live = DocumentTrigger.toLayer(OnPostCreated, (input) =>
        input.snapshot.data.pipe(
          Effect.tapError(() => Effect.sync(() => raws.push(input.snapshot.raw))),
          Effect.asVoid,
        ),
      );
      const error = yield* Effect.flip(serve(live, event({ title: 42 })));
      assert(Schema.isSchemaError(error));
      expect(raws).toEqual([{ title: 42 }]);
    }),
  );

  it.effect("fails with the handler's typed failure", () =>
    Effect.gen(function* () {
      const live = DocumentTrigger.toLayer(OnPostCreated, () => Effect.fail(new Failed()));
      const error = yield* Effect.flip(serve(live, event({ title: "Hello", createdAt })));
      expect(error).toBeInstanceOf(Failed);
    }),
  );

  it.effect("builds a handler given as an Effect once, for every event", () =>
    Effect.gen(function* () {
      let builds = 0;
      let events = 0;
      const live = DocumentTrigger.toLayer(
        OnPostCreated,
        Effect.sync(() => {
          builds++;
          return () =>
            Effect.sync(() => {
              events++;
            });
        }),
      );
      yield* DocumentTrigger.serve(OnPostCreated).pipe(
        Effect.flatMap((run) =>
          Effect.andThen(
            run(event({ title: "Hello", createdAt })),
            run(event({ title: "Again", createdAt })),
          ),
        ),
        Effect.provide(live),
      );
      expect({ builds, events }).toEqual({ builds: 1, events: 2 });
    }),
  );
});

const OnPostDeleted = DocumentTrigger.deleted("onPostDeleted", Posts);

describe("DocumentTrigger.deleted", () => {
  it.effect("runs the handler with the document as it was before it was deleted", () =>
    Effect.gen(function* () {
      const received: Array<unknown> = [];
      const live = DocumentTrigger.toLayer(OnPostDeleted, (input) =>
        Effect.gen(function* () {
          const post = yield* input.snapshot.data;
          received.push({ id: input.id, time: input.time, ref: input.ref.path, post });
        }),
      );
      const snapshot = DocumentSnapshot.existing(ref, { title: "Gone", createdAt });
      yield* DocumentTrigger.serve(OnPostDeleted).pipe(
        Effect.flatMap((run) =>
          run(
            DocumentTrigger.deletedEvent({
              id: "event-2",
              time: "2026-11-07T12:00:00.000Z",
              snapshot,
            }),
          ),
        ),
        Effect.provide(live),
      );
      expect(OnPostDeleted.event).toBe("deleted");
      expect(received).toEqual([
        {
          id: "event-2",
          time: "2026-11-07T12:00:00.000Z",
          ref: "users/alice/posts/hello",
          post: new Post({ title: "Gone", createdAt }),
        },
      ]);
    }),
  );
});

const OnPostUpdated = DocumentTrigger.updated("onPostUpdated", Posts);

describe("DocumentTrigger.updated", () => {
  it.effect("runs the handler with the old data before and the new data after", () =>
    Effect.gen(function* () {
      const received: Array<unknown> = [];
      const live = DocumentTrigger.toLayer(OnPostUpdated, (input) =>
        Effect.gen(function* () {
          const before = yield* input.before.data;
          const after = yield* input.after.data;
          received.push({ id: input.id, ref: input.ref.path, before, after });
        }),
      );
      yield* DocumentTrigger.serve(OnPostUpdated).pipe(
        Effect.flatMap((run) =>
          run(
            DocumentTrigger.updatedEvent({
              id: "event-3",
              time: "2026-11-07T12:00:00.000Z",
              before: DocumentSnapshot.existing(ref, { title: "Draft", createdAt }),
              after: DocumentSnapshot.existing(ref, { title: "Final", createdAt }),
            }),
          ),
        ),
        Effect.provide(live),
      );
      expect(OnPostUpdated.event).toBe("updated");
      expect(received).toEqual([
        {
          id: "event-3",
          ref: "users/alice/posts/hello",
          before: new Post({ title: "Draft", createdAt }),
          after: new Post({ title: "Final", createdAt }),
        },
      ]);
    }),
  );
});

const OnPostWritten = DocumentTrigger.written("onPostWritten", Posts);

describe("DocumentTrigger.written", () => {
  /** What the handler sees of one side: its decoded data, or that it is missing. */
  const side = (snapshot: DocumentSnapshot.DocumentSnapshot<typeof Posts>) =>
    DocumentSnapshot.isExisting(snapshot) ? snapshot.data : Effect.succeed("missing" as const);

  const runWritten = (
    before: DocumentSnapshot.DocumentSnapshot<typeof Posts>,
    after: DocumentSnapshot.DocumentSnapshot<typeof Posts>,
  ) =>
    Effect.gen(function* () {
      const received: Array<unknown> = [];
      const live = DocumentTrigger.toLayer(OnPostWritten, (input) =>
        Effect.gen(function* () {
          received.push({
            ref: input.ref.path,
            before: yield* side(input.before),
            after: yield* side(input.after),
          });
        }),
      );
      yield* DocumentTrigger.serve(OnPostWritten).pipe(
        Effect.flatMap((run) =>
          run(
            DocumentTrigger.writtenEvent({
              id: "event-4",
              time: "2026-11-07T12:00:00.000Z",
              before,
              after,
            }),
          ),
        ),
        Effect.provide(live),
      );
      return received;
    });

  it.effect("runs on a create, with before missing", () =>
    Effect.gen(function* () {
      expect(OnPostWritten.event).toBe("written");
      const received = yield* runWritten(
        DocumentSnapshot.missing(ref),
        DocumentSnapshot.existing(ref, { title: "New", createdAt }),
      );
      expect(received).toEqual([
        {
          ref: "users/alice/posts/hello",
          before: "missing",
          after: new Post({ title: "New", createdAt }),
        },
      ]);
    }),
  );

  it.effect("runs on an update, with both sides existing", () =>
    Effect.gen(function* () {
      const received = yield* runWritten(
        DocumentSnapshot.existing(ref, { title: "Draft", createdAt }),
        DocumentSnapshot.existing(ref, { title: "Final", createdAt }),
      );
      expect(received).toEqual([
        {
          ref: "users/alice/posts/hello",
          before: new Post({ title: "Draft", createdAt }),
          after: new Post({ title: "Final", createdAt }),
        },
      ]);
    }),
  );

  it.effect("runs on a delete, with after missing and the ref still set", () =>
    Effect.gen(function* () {
      const received = yield* runWritten(
        DocumentSnapshot.existing(ref, { title: "Gone", createdAt }),
        DocumentSnapshot.missing(ref),
      );
      expect(received).toEqual([
        {
          ref: "users/alice/posts/hello",
          before: new Post({ title: "Gone", createdAt }),
          after: "missing",
        },
      ]);
    }),
  );
});
