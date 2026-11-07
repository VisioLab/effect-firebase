/**
 * Document Triggers: server functions that run when a document of a
 * collection changes.
 *
 * A {@link DocumentTrigger} is declared from a name and a `Collection`
 * definition, with one constructor per change, such as {@link created}. The
 * server implements it with {@link toLayer} and deploys it with
 * `Functions.make` from `@visiolab/effect-firebase-functions`, or as a member
 * of a Function Group, next to Callables, with `Functions.group`. This module
 * imports no Firebase SDK, so a handler and its tests don't depend on
 * `firebase-functions`.
 *
 * Firebase delivers each event at least once, so a handler can run more than
 * once for one change. Make it idempotent, keyed on the event's `id`.
 *
 * @example Declaring a trigger and implementing it
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Users = Collection.make("users", User);
 * const Posts = Users.subcollection("posts", Post);
 *
 * const OnPostCreated = DocumentTrigger.created("onPostCreated", Posts);
 *
 * const OnPostCreatedLive = DocumentTrigger.toLayer(OnPostCreated, (event) =>
 *   Effect.gen(function* () {
 *     const [userId] = event.ref.ancestors;
 *     const post = yield* event.snapshot.data;
 *     yield* Effect.log(`${userId} wrote ${post.title}`);
 *   }),
 * );
 * ```
 *
 * @stability unstable
 * @since 0.3.0
 */
import type { Effect, Layer, Pipeable } from "effect";
import type * as Collection from "../firestore/Collection.ts";
import type * as DocumentSnapshot from "../firestore/DocumentSnapshot.ts";
import type * as FirebaseFunction from "./FirebaseFunction.ts";
import type * as FunctionGroup from "./FunctionGroup.ts";
import * as internal from "./internal/documentTrigger.ts";
import type * as internalGroup from "./internal/functionGroup.ts";
import { isFunctionGroup } from "./internal/functionGroup.ts";

const TypeId = internal.TypeId;

/**
 * The group and the trigger that the arguments of an overload taking
 * `(trigger, ...)` or `(group, name, ...)` name.
 */
const target = (
  args: ReadonlyArray<unknown>,
): readonly [internalGroup.Fields | undefined, internal.Fields] =>
  isFunctionGroup(args[0])
    ? [args[0], args[0].functions[args[1] as string] as internal.Fields]
    : [undefined, args[0] as internal.Fields];

/**
 * The change to a document a {@link DocumentTrigger} runs on: `"created"`,
 * `"updated"`, `"deleted"` or `"written"`.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type EventKind = internal.EventKind;

/**
 * A Document Trigger: a server function's name, the collection it watches,
 * and the change it runs on.
 *
 * **Details**
 *
 * A Document Trigger is the kind of {@link FirebaseFunction.FirebaseFunction}
 * that a change to a document runs, and its `kind` is `"DocumentTrigger"`.
 *
 * It watches every document of its collection. On a subcollection, that is
 * the documents under every parent document. It listens to the `(default)`
 * database, the one `Firestore` reads and writes.
 *
 * The name is its identity. A trigger in no group is deployed under its
 * name, so it is a literal type that the server's exports are keyed on.
 *
 * @see {@link Callable.Callable} for a Function the client calls by name
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface DocumentTrigger<
  out Name extends string,
  out C extends Collection.Any,
  out Kind extends EventKind = EventKind,
>
  extends FirebaseFunction.FirebaseFunction<"DocumentTrigger", Name>, Pipeable.Pipeable {
  readonly [TypeId]: typeof TypeId;
  /** The trigger's name, which a trigger in no group is deployed under. */
  readonly name: Name;
  /** The change it runs on, such as `"created"`. */
  readonly event: Kind;
  /** The collection whose documents it watches. */
  readonly collection: C;
}

/**
 * Any {@link DocumentTrigger}, whatever its name, collection and change.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Any extends FirebaseFunction.FirebaseFunction<"DocumentTrigger", string> {
  readonly [TypeId]: typeof TypeId;
  readonly event: EventKind;
  readonly collection: Collection.Any;
}

/**
 * What every event of a trigger on `C` carries: the CloudEvent's `id` and
 * `time`, and the document's typed reference.
 *
 * **Details**
 *
 * The ids that a path pattern would capture as wildcards are on `ref`:
 * `ref.ancestors` holds the ids of the parent documents, from the root down,
 * and `ref.id` the document's own id.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface BaseEvent<C extends Collection.Any> {
  /**
   * The CloudEvent's id. Firebase delivers an event at least once, and a
   * redelivered event keeps its id, so key idempotent work on it.
   */
  readonly id: string;
  /** When the change happened, as the CloudEvent's RFC 3339 `time`. */
  readonly time: string;
  /** The reference of the document that changed. */
  readonly ref: Collection.DocumentReference<C>;
}

/**
 * The event of a {@link created} trigger: the document that was created.
 *
 * **Details**
 *
 * `snapshot.data` decodes the document through the collection's model when
 * it runs, and fails with a `Schema.SchemaError` when the data doesn't match.
 * `snapshot.raw` holds the stored data as Firestore Values, as a read does.
 *
 * @see {@link createdEvent} for building one
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Created<C extends Collection.Any> extends BaseEvent<C> {
  /** The document as it was created. */
  readonly snapshot: DocumentSnapshot.Existing<C>;
}

/**
 * The event of a {@link deleted} trigger: the document as it was just before
 * it was deleted.
 *
 * **Details**
 *
 * `snapshot` holds the document's last data. `snapshot.data` decodes it
 * through the collection's model when it runs, as for {@link Created}.
 *
 * @see {@link deletedEvent} for building one
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Deleted<C extends Collection.Any> extends BaseEvent<C> {
  /** The document as it was just before it was deleted. */
  readonly snapshot: DocumentSnapshot.Existing<C>;
}

/**
 * The event of an {@link updated} trigger: the document before and after the
 * update.
 *
 * **Details**
 *
 * Both sides exist. Each side's `data` decodes through the collection's model
 * when it runs, so a handler can compare the two.
 *
 * @see {@link updatedEvent} for building one
 * @see {@link Written} for the event of a change that may create or delete
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Updated<C extends Collection.Any> extends BaseEvent<C> {
  /** The document as it was before the update. */
  readonly before: DocumentSnapshot.Existing<C>;
  /** The document as it is after the update. */
  readonly after: DocumentSnapshot.Existing<C>;
}

/**
 * The event of a {@link written} trigger: the document before and after a
 * create, an update or a delete.
 *
 * **Details**
 *
 * Each side is a `DocumentSnapshot`: on a create, `before` is `Missing`; on a
 * delete, `after` is `Missing`; on an update, both are `Existing`. Narrow a
 * side with `DocumentSnapshot.isExisting` or `DocumentSnapshot.isMissing`
 * before reading its data. `ref` is set in every case.
 *
 * @see {@link writtenEvent} for building one
 * @see {@link Updated} for the event of an update alone, where both sides exist
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Written<C extends Collection.Any> extends BaseEvent<C> {
  /** The document before the write: `Missing` when the write created it. */
  readonly before: DocumentSnapshot.DocumentSnapshot<C>;
  /** The document after the write: `Missing` when the write deleted it. */
  readonly after: DocumentSnapshot.DocumentSnapshot<C>;
}

/**
 * The event of each change a trigger on `C` can run on, keyed by the change.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export interface Events<C extends Collection.Any> {
  readonly created: Created<C>;
  readonly deleted: Deleted<C>;
  readonly updated: Updated<C>;
  readonly written: Written<C>;
}

/**
 * The event a {@link DocumentTrigger} hands its handler, by its change: a
 * {@link Created} for a {@link created} trigger, an {@link Updated} for an
 * {@link updated} one, a {@link Deleted} for a {@link deleted} one and a
 * {@link Written} for a {@link written} one.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Event<T extends Any> = Events<T["collection"]>[T["event"]];

/**
 * The service a {@link toLayer} Layer provides: the handler of the trigger
 * `Name`, as served in `Group`. It is the {@link FirebaseFunction.Handler}
 * every kind of Function is served by.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type Handler<Group, Name extends string> = FirebaseFunction.Handler<Group, Name>;

/**
 * The {@link Handler} of a trigger in no group.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type HandlerFor<T extends Any> = FirebaseFunction.HandlerFor<T>;

/**
 * What implements a trigger: a function from its {@link Event} to an Effect
 * that runs on it.
 *
 * **Details**
 *
 * Its error channel is open: any failure fails the event.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type HandlerFunction<T extends Any, R> = (
  event: Event<T>,
) => Effect.Effect<void, unknown, R>;

/**
 * Declares a trigger that runs when a document of `collection` is created.
 *
 * **When to use**
 *
 * Use to react to new documents of a collection on the server. Use a
 * `Callable` instead when the client asks for the work by name.
 *
 * **Details**
 *
 * Its handler gets a {@link Created} event. It takes one collection,
 * whatever its depth: the path pattern it is deployed with is derived from
 * the collection's path, with a wildcard for each parent document's id and
 * for the document's id. A collection group can't be watched; declare a
 * trigger for each of its collections.
 *
 * Firebase delivers each event at least once. Make the handler idempotent,
 * keyed on the event's `id`.
 *
 * @example Declaring a trigger on a subcollection
 * ```ts
 * import { Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class User extends FirestoreModel.Class<User>("User")({ name: Schema.String }) {}
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Posts = Collection.make("users", User).subcollection("posts", Post);
 *
 * // Runs for each post created under any user.
 * const OnPostCreated = DocumentTrigger.created("onPostCreated", Posts);
 * ```
 *
 * @see {@link updated} for running when an existing document changes
 * @see {@link deleted} for running when a document is deleted
 * @see {@link written} for running on a create, an update and a delete alike
 * @see {@link toLayer} for implementing the trigger
 * @see {@link Callable.make} for declaring a Function the client calls
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const created = <const Name extends string, C extends Collection.Any>(
  name: Name,
  collection: C,
): DocumentTrigger<Name, C, "created"> =>
  internal.make({ kind: internal.kind, name, event: "created", collection }) as never;

/**
 * Builds the event of a {@link created} trigger from the created document's
 * snapshot.
 *
 * **When to use**
 *
 * Use in a test, to run a handler through {@link serve} with an event of
 * your own. The functions package builds its events with it too.
 *
 * **Details**
 *
 * The event's `ref` is the snapshot's. Build the snapshot with
 * `DocumentSnapshot.existing` and the stored data as Firestore Values.
 *
 * @example Building an event for a test
 * ```ts
 * import { Schema } from "effect";
 * import { Collection, DocumentSnapshot, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Posts = Collection.make("posts", Post);
 *
 * const event = DocumentTrigger.createdEvent({
 *   id: "event-1",
 *   time: "2026-01-01T00:00:00.000Z",
 *   snapshot: DocumentSnapshot.existing(Posts.doc(Posts.id.make("hello")), { title: "Hello" }),
 * });
 * ```
 *
 * @see {@link created} for declaring the trigger
 * @see {@link serve} for running the event through the handler
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const createdEvent: <C extends Collection.Any>(input: {
  readonly id: string;
  readonly time: string;
  readonly snapshot: DocumentSnapshot.Existing<C>;
}) => Created<C> = internal.createdEvent;

/**
 * Declares a trigger that runs when a document of `collection` is deleted.
 *
 * **When to use**
 *
 * Use to clean up after a document of a collection is deleted, such as
 * removing what refers to it.
 *
 * **Details**
 *
 * Its handler gets a {@link Deleted} event, with the document as it was just
 * before it was deleted. It is deployed at the same path pattern as a
 * {@link created} trigger on the same collection.
 *
 * Firebase delivers each event at least once. Make the handler idempotent,
 * keyed on the event's `id`.
 *
 * @example Reading the deleted document
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const OnPostDeleted = DocumentTrigger.deleted("onPostDeleted", Collection.make("posts", Post));
 *
 * const OnPostDeletedLive = DocumentTrigger.toLayer(OnPostDeleted, (event) =>
 *   Effect.flatMap(event.snapshot.data, (post) => Effect.log(`Deleted ${post.title}`)),
 * );
 * ```
 *
 * @see {@link created} for running when a document is created
 * @see {@link updated} for running when an existing document changes
 * @see {@link written} for running on a create, an update and a delete alike
 * @see {@link toLayer} for implementing the trigger
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const deleted = <const Name extends string, C extends Collection.Any>(
  name: Name,
  collection: C,
): DocumentTrigger<Name, C, "deleted"> =>
  internal.make({ kind: internal.kind, name, event: "deleted", collection }) as never;

/**
 * Builds the event of a {@link deleted} trigger from the snapshot of the
 * document as it was just before it was deleted.
 *
 * **When to use**
 *
 * Use in a test, to run a handler through {@link serve} with an event of
 * your own. The functions package builds its events with it too.
 *
 * **Details**
 *
 * The event's `ref` is the snapshot's. Build the snapshot with
 * `DocumentSnapshot.existing` and the document's last data as Firestore
 * Values.
 *
 * @example Building an event for a test
 * ```ts
 * import { Schema } from "effect";
 * import { Collection, DocumentSnapshot, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Posts = Collection.make("posts", Post);
 *
 * const event = DocumentTrigger.deletedEvent({
 *   id: "event-1",
 *   time: "2026-01-01T00:00:00.000Z",
 *   snapshot: DocumentSnapshot.existing(Posts.doc(Posts.id.make("hello")), { title: "Hello" }),
 * });
 * ```
 *
 * @see {@link deleted} for declaring the trigger
 * @see {@link serve} for running the event through the handler
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const deletedEvent: <C extends Collection.Any>(input: {
  readonly id: string;
  readonly time: string;
  readonly snapshot: DocumentSnapshot.Existing<C>;
}) => Deleted<C> = internal.deletedEvent;

/**
 * Declares a trigger that runs when a document of `collection` that already
 * exists is changed.
 *
 * **When to use**
 *
 * Use to react to changes to existing documents, with the data before and
 * after the change at hand.
 *
 * **Details**
 *
 * Its handler gets an {@link Updated} event, with the document before and
 * after the update. Creating or deleting a document doesn't run it.
 *
 * Firebase delivers each event at least once. Make the handler idempotent,
 * keyed on the event's `id`.
 *
 * @example Reacting to a changed title
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const OnPostUpdated = DocumentTrigger.updated("onPostUpdated", Collection.make("posts", Post));
 *
 * const OnPostUpdatedLive = DocumentTrigger.toLayer(OnPostUpdated, (event) =>
 *   Effect.gen(function* () {
 *     const before = yield* event.before.data;
 *     const after = yield* event.after.data;
 *     if (before.title !== after.title) {
 *       yield* Effect.log(`Renamed ${before.title} to ${after.title}`);
 *     }
 *   }),
 * );
 * ```
 *
 * @see {@link created} for running when a document is created
 * @see {@link deleted} for running when a document is deleted
 * @see {@link written} for running on a create and a delete too
 * @see {@link toLayer} for implementing the trigger
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const updated = <const Name extends string, C extends Collection.Any>(
  name: Name,
  collection: C,
): DocumentTrigger<Name, C, "updated"> =>
  internal.make({ kind: internal.kind, name, event: "updated", collection }) as never;

/**
 * Builds the event of an {@link updated} trigger from the snapshots of the
 * document before and after the update.
 *
 * **When to use**
 *
 * Use in a test, to run a handler through {@link serve} with an event of
 * your own. The functions package builds its events with it too.
 *
 * **Details**
 *
 * Both snapshots are of the same document. The event's `ref` is the one of
 * `after`. Build each with `DocumentSnapshot.existing`.
 *
 * @example Building an event for a test
 * ```ts
 * import { Schema } from "effect";
 * import { Collection, DocumentSnapshot, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Posts = Collection.make("posts", Post);
 * const ref = Posts.doc(Posts.id.make("hello"));
 *
 * const event = DocumentTrigger.updatedEvent({
 *   id: "event-1",
 *   time: "2026-01-01T00:00:00.000Z",
 *   before: DocumentSnapshot.existing(ref, { title: "Draft" }),
 *   after: DocumentSnapshot.existing(ref, { title: "Final" }),
 * });
 * ```
 *
 * @see {@link updated} for declaring the trigger
 * @see {@link serve} for running the event through the handler
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const updatedEvent: <C extends Collection.Any>(input: {
  readonly id: string;
  readonly time: string;
  readonly before: DocumentSnapshot.Existing<C>;
  readonly after: DocumentSnapshot.Existing<C>;
}) => Updated<C> = internal.changeEvent;

/**
 * Declares a trigger that runs when a document of `collection` is created,
 * updated or deleted.
 *
 * **When to use**
 *
 * Use to handle every change to a collection's documents in one handler, such
 * as keeping a copy or a count in sync. Prefer {@link created},
 * {@link updated} or {@link deleted} when the handler acts on one change only.
 *
 * **Details**
 *
 * Its handler gets a {@link Written} event, whose `before` and `after` are
 * `DocumentSnapshot`s: `before` is `Missing` on a create, and `after` is
 * `Missing` on a delete. Narrow each with `DocumentSnapshot.isExisting` or
 * `DocumentSnapshot.isMissing`.
 *
 * Firebase delivers each event at least once. Make the handler idempotent,
 * keyed on the event's `id`.
 *
 * @example Telling a create, an update and a delete apart
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, DocumentSnapshot, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const OnPostWritten = DocumentTrigger.written("onPostWritten", Collection.make("posts", Post));
 *
 * const OnPostWrittenLive = DocumentTrigger.toLayer(OnPostWritten, (event) => {
 *   if (DocumentSnapshot.isMissing(event.after)) {
 *     return Effect.log(`Deleted ${event.ref.id}`);
 *   }
 *   const verb = DocumentSnapshot.isExisting(event.before) ? "Updated" : "Created";
 *   return Effect.flatMap(event.after.data, (post) => Effect.log(`${verb} ${post.title}`));
 * });
 * ```
 *
 * @see {@link created} for running on a create only, with the document always there
 * @see {@link updated} for running on an update only, with both sides always there
 * @see {@link deleted} for running on a delete only, with the last data always there
 * @see {@link toLayer} for implementing the trigger
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const written = <const Name extends string, C extends Collection.Any>(
  name: Name,
  collection: C,
): DocumentTrigger<Name, C, "written"> =>
  internal.make({ kind: internal.kind, name, event: "written", collection }) as never;

/**
 * Builds the event of a {@link written} trigger from the snapshots of the
 * document before and after the write.
 *
 * **When to use**
 *
 * Use in a test, to run a handler through {@link serve} with an event of
 * your own. The functions package builds its events with it too.
 *
 * **Details**
 *
 * Both snapshots are of the same document. The event's `ref` is the one of
 * `after`, which a `Missing` snapshot carries too. Build a side that exists
 * with `DocumentSnapshot.existing` and one that doesn't with
 * `DocumentSnapshot.missing`.
 *
 * @example Building the event of a create for a test
 * ```ts
 * import { Schema } from "effect";
 * import { Collection, DocumentSnapshot, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Posts = Collection.make("posts", Post);
 * const ref = Posts.doc(Posts.id.make("hello"));
 *
 * const event = DocumentTrigger.writtenEvent({
 *   id: "event-1",
 *   time: "2026-01-01T00:00:00.000Z",
 *   before: DocumentSnapshot.missing(ref),
 *   after: DocumentSnapshot.existing(ref, { title: "Hello" }),
 * });
 * ```
 *
 * @see {@link written} for declaring the trigger
 * @see {@link serve} for running the event through the handler
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const writtenEvent: <C extends Collection.Any>(input: {
  readonly id: string;
  readonly time: string;
  readonly before: DocumentSnapshot.DocumentSnapshot<C>;
  readonly after: DocumentSnapshot.DocumentSnapshot<C>;
}) => Written<C> = internal.changeEvent;

/**
 * Implements a Document Trigger as a Layer.
 *
 * **When to use**
 *
 * Use to write the server side of a trigger. The Layer is what
 * `Functions.make` and `Functions.group` from
 * `@visiolab/effect-firebase-functions` serve, and what {@link serve} runs
 * in a test.
 *
 * **Details**
 *
 * Takes the handler itself, or an Effect that builds it. The Effect runs
 * once, when the Layer is built, so do per-instance setup there.
 *
 * For a trigger in a Function Group, pass the group and the member's name.
 * Each group implements its members separately, so the Layer of the trigger
 * on its own doesn't serve it in a group, and the Layer of one group's
 * member doesn't serve it in another.
 *
 * The Layer requires what the handler needs on each event and what building
 * it needs. Both are provided where the Layer is built, and shared by every
 * event. Reading `snapshot.data` needs what the collection's model needs to
 * decode.
 *
 * Firebase delivers each event at least once. Make the handler idempotent,
 * keyed on the event's `id`.
 *
 * @example Building the handler once per instance
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const OnPostCreated = DocumentTrigger.created("onPostCreated", Collection.make("posts", Post));
 *
 * const OnPostCreatedLive = DocumentTrigger.toLayer(
 *   OnPostCreated,
 *   Effect.gen(function* () {
 *     const prefix = yield* Effect.succeed("New post");
 *     return (event) => Effect.log(`${prefix}: ${event.ref.id}`);
 *   }),
 * );
 * ```
 *
 * @example Implementing a trigger in a Function Group
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { Callable, DocumentTrigger, FunctionGroup } from "@visiolab/effect-firebase/functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Publish = Callable.make("publish", { payload: { id: Schema.String } });
 * const OnCreated = DocumentTrigger.created("onCreated", Collection.make("posts", Post));
 *
 * class Posts extends FunctionGroup.make("posts").add(Publish, OnCreated) {}
 *
 * // Serves `posts-onCreated`.
 * const OnCreatedLive = DocumentTrigger.toLayer(Posts, "onCreated", (event) =>
 *   Effect.log(`New post: ${event.ref.id}`),
 * );
 * ```
 *
 * @see {@link created}, {@link updated}, {@link deleted} and {@link written} for declaring the trigger
 * @see {@link serve} for running an event through the handler
 * @see {@link Callable.toLayer} for implementing a Callable
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const toLayer: {
  <T extends Any, R = never, EB = never, RB = never>(
    trigger: T,
    handler: HandlerFunction<T, R> | Effect.Effect<HandlerFunction<T, R>, EB, RB>,
  ): Layer.Layer<HandlerFor<T>, EB, R | RB>;
  <
    G extends FunctionGroup.Any,
    const Name extends FunctionGroup.Names<G, Any>,
    R = never,
    EB = never,
    RB = never,
  >(
    group: G,
    name: Name,
    handler:
      | HandlerFunction<FunctionGroup.Member<G, Name, Any>, R>
      | Effect.Effect<HandlerFunction<FunctionGroup.Member<G, Name, Any>, R>, EB, RB>,
  ): Layer.Layer<Handler<G["identifier"], Name>, EB, R | RB>;
} = ((...args: ReadonlyArray<unknown>) => {
  const [group, trigger] = target(args);
  // The handler's requirements are checked by the signatures, and provided
  // where the Layer is built.
  return internal.toLayer(
    group?.identifier,
    trigger.name,
    args[group === undefined ? 1 : 2] as internal.HandlerInput,
  );
}) as never;

/**
 * Runs events of a Document Trigger through its handler.
 *
 * **When to use**
 *
 * Use to test a trigger's handler in process, without the emulator and
 * without `firebase-functions`: build an event with {@link createdEvent},
 * {@link updatedEvent}, {@link deletedEvent} or {@link writtenEvent} and
 * provide the Layer from {@link toLayer}. `Functions.make` from
 * `@visiolab/effect-firebase-functions` runs every real event through it too.
 *
 * **Details**
 *
 * Requires the trigger's handler, which it reads once. Returns a function of
 * the event, which fails with whatever the handler fails with.
 *
 * For a trigger in a Function Group, pass the group and the member's name:
 * it then requires the handler from `toLayer(group, name, handler)`.
 *
 * @example Running an event in a test
 * ```ts
 * import { Effect, Schema } from "effect";
 * import { Collection, DocumentSnapshot, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 * import { DocumentTrigger } from "@visiolab/effect-firebase/functions";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({ title: Schema.String }) {}
 *
 * const Posts = Collection.make("posts", Post);
 * const OnPostCreated = DocumentTrigger.created("onPostCreated", Posts);
 *
 * const OnPostCreatedLive = DocumentTrigger.toLayer(OnPostCreated, (event) =>
 *   Effect.flatMap(event.snapshot.data, (post) => Effect.log(post.title)),
 * );
 *
 * const program = DocumentTrigger.serve(OnPostCreated).pipe(
 *   Effect.flatMap((run) =>
 *     run(
 *       DocumentTrigger.createdEvent({
 *         id: "event-1",
 *         time: "2026-01-01T00:00:00.000Z",
 *         snapshot: DocumentSnapshot.existing(Posts.doc(Posts.id.make("hello")), {
 *           title: "Hello",
 *         }),
 *       }),
 *     ),
 *   ),
 *   Effect.provide(OnPostCreatedLive),
 * );
 * ```
 *
 * @see {@link toLayer} for providing the handler
 * @see {@link Callable.serve} for running a call to a Callable
 *
 * @stability unstable
 * @category serving
 * @since 0.3.0
 */
export const serve: {
  <T extends Any>(
    trigger: T,
  ): Effect.Effect<(event: Event<T>) => Effect.Effect<void, unknown>, never, HandlerFor<T>>;
  <G extends FunctionGroup.Any, const Name extends FunctionGroup.Names<G, Any>>(
    group: G,
    name: Name,
  ): Effect.Effect<
    (event: Event<FunctionGroup.Member<G, Name, Any>>) => Effect.Effect<void, unknown>,
    never,
    Handler<G["identifier"], Name>
  >;
} = ((...args: ReadonlyArray<unknown>) => internal.serve(...target(args))) as never;

/**
 * Where a Document Trigger is deployed: the name it is exported under and
 * the path pattern of the documents it watches.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Deployment {
  /**
   * The name the trigger is deployed under: its own in no group, and
   * `<group>-<name>` in a group.
   */
  readonly name: string;
  /**
   * The path pattern of the documents it watches, with a wildcard for each
   * parent document's id and for the document's id. The wildcards' names are
   * not part of the API: read the ids from the event's `ref`.
   */
  readonly document: string;
}

/**
 * Returns the {@link Deployment} of a Document Trigger: its deployed name and
 * its document path pattern. A building block of the functions package. Most
 * apps don't need it.
 *
 * **When to use**
 *
 * Use when deploying triggers with a transport of your own. `Functions`
 * already uses it.
 *
 * **Details**
 *
 * Pass the trigger for one in no group, or a Function Group and a trigger
 * member's name for one in a group, which is deployed as `<group>-<name>`.
 *
 * @see {@link Callable.deployment} for where a Callable is served
 *
 * @stability unstable
 * @category serving
 * @since 0.3.0
 */
export const deployment: {
  (trigger: Any): Deployment;
  <G extends FunctionGroup.Any>(group: G, name: FunctionGroup.Names<G, Any>): Deployment;
} = ((...args: ReadonlyArray<unknown>) => internal.deployment(...target(args))) as never;
