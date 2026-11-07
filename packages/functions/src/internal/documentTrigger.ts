/**
 * The Document Trigger kind's runtime: serves one Document Trigger as an
 * `onDocument*` export.
 *
 * @internal
 */
import { Cause, Effect, Exit, type Layer, Option } from "effect";
import * as AdminFirestoreValue from "@visiolab/effect-firebase-admin/firestore/AdminFirestoreValue";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as DocumentSnapshot from "@visiolab/effect-firebase/firestore/DocumentSnapshot";
import * as DocumentTrigger from "@visiolab/effect-firebase/functions/DocumentTrigger";
import type * as FunctionGroup from "@visiolab/effect-firebase/functions/FunctionGroup";
import * as Firestore from "firebase-functions/v2/firestore";
import * as Runtime from "./runtime.ts";

/**
 * The typed reference of the document an event is about, from its path
 * relative to the database's `documents/`. A path outside the trigger's
 * collection can't come from its own path pattern, so it is a defect.
 */
const refOf = (trigger: DocumentTrigger.Any, path: string) =>
  Option.match(Collection.fromPath(trigger.collection, path), {
    onNone: () =>
      Effect.die(
        new Error(
          `The document "${path}" is not in the collection of the trigger "${trigger.name}"`,
        ),
      ),
    onSome: Effect.succeed,
  });

/**
 * An existing Document Snapshot at `ref` of the Admin SDK's snapshot, its
 * data read into Firestore Values as a read does. Data that isn't a Firestore
 * Value, such as a vector, is a defect.
 */
const existingOf = (
  ref: Collection.DocumentReference<Collection.Any>,
  snapshot: Firestore.DocumentSnapshot | undefined,
): Effect.Effect<DocumentSnapshot.Existing<Collection.Any>> =>
  snapshot === undefined
    ? Effect.die(new Error(`The event of "${ref.path}" carries no document`))
    : Effect.map(
        Effect.orDie(Effect.fromResult(AdminFirestoreValue.fromAdmin(snapshot.data()))),
        (raw) => DocumentSnapshot.existing(ref, raw),
      );

/**
 * The core event of a `created` trigger, from what `onDocumentCreated` hands
 * over.
 */
const createdEvent = (
  trigger: DocumentTrigger.Any,
  event: Firestore.FirestoreEvent<Firestore.QueryDocumentSnapshot | undefined>,
) =>
  Effect.flatMap(refOf(trigger, event.document), (ref) =>
    Effect.map(existingOf(ref, event.data), (snapshot) =>
      DocumentTrigger.createdEvent({ id: event.id, time: event.time, snapshot }),
    ),
  );

/**
 * The core event of a `deleted` trigger, from what `onDocumentDeleted` hands
 * over: the document as it was just before it was deleted.
 */
const deletedEvent = (
  trigger: DocumentTrigger.Any,
  event: Firestore.FirestoreEvent<Firestore.QueryDocumentSnapshot | undefined>,
) =>
  Effect.flatMap(refOf(trigger, event.document), (ref) =>
    Effect.map(existingOf(ref, event.data), (snapshot) =>
      DocumentTrigger.deletedEvent({ id: event.id, time: event.time, snapshot }),
    ),
  );

/**
 * Both sides of a change, each read with `side`. An event without its change
 * is a defect.
 */
const changeOf = <S, A>(
  ref: Collection.DocumentReference<Collection.Any>,
  change: Firestore.Change<S> | undefined,
  side: (ref: Collection.DocumentReference<Collection.Any>, snapshot: S) => Effect.Effect<A>,
) =>
  change === undefined
    ? Effect.die(new Error(`The event of "${ref.path}" carries no change`))
    : Effect.all({ before: side(ref, change.before), after: side(ref, change.after) });

/**
 * The core event of an `updated` trigger, from what `onDocumentUpdated` hands
 * over: the document before and after the update, both existing.
 */
const updatedEvent = (
  trigger: DocumentTrigger.Any,
  event: Firestore.FirestoreEvent<Firestore.Change<Firestore.QueryDocumentSnapshot> | undefined>,
) =>
  Effect.flatMap(refOf(trigger, event.document), (ref) =>
    Effect.map(changeOf(ref, event.data, existingOf), ({ before, after }) =>
      DocumentTrigger.updatedEvent({ id: event.id, time: event.time, before, after }),
    ),
  );

/**
 * A Document Snapshot at `ref` of a side of a write: `Missing` for the side
 * that doesn't exist, as the Admin SDK marks it with `exists`.
 */
const sideOf = (
  ref: Collection.DocumentReference<Collection.Any>,
  snapshot: Firestore.DocumentSnapshot,
): Effect.Effect<DocumentSnapshot.DocumentSnapshot<Collection.Any>> =>
  snapshot.exists ? existingOf(ref, snapshot) : Effect.succeed(DocumentSnapshot.missing(ref));

/**
 * The core event of a `written` trigger, from what `onDocumentWritten` hands
 * over: `before` is missing on a create, and `after` on a delete.
 */
const writtenEvent = (
  trigger: DocumentTrigger.Any,
  event: Firestore.FirestoreEvent<Firestore.Change<Firestore.DocumentSnapshot> | undefined>,
) =>
  Effect.flatMap(refOf(trigger, event.document), (ref) =>
    Effect.map(changeOf(ref, event.data, sideOf), ({ before, after }) =>
      DocumentTrigger.writtenEvent({ id: event.id, time: event.time, before, after }),
    ),
  );

/**
 * Logs the Cause of a failed event or Layer build in the event's span.
 */
const logFailure = (message: string) => (cause: Cause.Cause<unknown>) =>
  Effect.logError(message, cause);

/**
 * `DocumentTrigger.serve` of one trigger, with its requirements erased, since
 * the public signatures check that `live` meets them.
 */
type Serve = Effect.Effect<(event: unknown) => Effect.Effect<void, unknown>, never, unknown>;

/**
 * What an `onDocument*` provider returns, by the change it runs on.
 *
 * @internal
 */
export type Export =
  | ReturnType<typeof Firestore.onDocumentCreated>
  | ReturnType<typeof Firestore.onDocumentUpdated>
  | ReturnType<typeof Firestore.onDocumentWritten>;

/**
 * The export of `trigger` in `group`, or in no group: the `onDocument*`
 * export of its change (`onDocumentCreated`, `onDocumentDeleted`,
 * `onDocumentUpdated` or `onDocumentWritten`) on the `(default)` database, at
 * the path pattern of the trigger's collection, that converts each event and
 * runs it through `DocumentTrigger.serve`. It builds `live` on its own first
 * event. A failed event, or a failed build, is logged and thrown, so Firebase
 * delivers it again when `retry` is set.
 *
 * @internal
 */
export const deploy = <R, E>(
  group: FunctionGroup.Any | undefined,
  trigger: DocumentTrigger.Any,
  live: Layer.Layer<R, E>,
  options: object = {},
): Export => {
  const deployment =
    group === undefined
      ? DocumentTrigger.deployment(trigger)
      : DocumentTrigger.deployment(group, trigger.name as never);
  const serve: Serve = (
    group === undefined
      ? DocumentTrigger.serve(trigger)
      : DocumentTrigger.serve(group, trigger.name as never)
  ) as never;
  const run = Runtime.make(live, {
    span: `DocumentTrigger.${deployment.name}`,
    attributes: { "faas.name": deployment.name, "faas.trigger": "datasource" },
    onBuildFailure: logFailure("The Layer of a Document Trigger failed to build"),
  });
  /** The raw handler that converts each event with `convert` and serves it. */
  const handler =
    <Data>(
      convert: (
        trigger: DocumentTrigger.Any,
        event: Firestore.FirestoreEvent<Data>,
      ) => Effect.Effect<unknown>,
    ) =>
    async (event: Firestore.FirestoreEvent<Data>) => {
      const exit = await run(
        serve.pipe(
          Effect.flatMap((handle) =>
            Effect.flatMap(convert(trigger, event), (input) => handle(input)),
          ),
          // Logged with the services of `live`, so a logger it provides is used.
          Effect.onError(logFailure("A Document Trigger failed")),
        ),
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
    };
  const opts = { ...options, document: deployment.document };
  switch (trigger.event) {
    case "created":
      return Firestore.onDocumentCreated(opts, handler(createdEvent));
    case "deleted":
      return Firestore.onDocumentDeleted(opts, handler(deletedEvent));
    case "updated":
      return Firestore.onDocumentUpdated(opts, handler(updatedEvent));
    case "written":
      return Firestore.onDocumentWritten(opts, handler(writtenEvent));
  }
};
