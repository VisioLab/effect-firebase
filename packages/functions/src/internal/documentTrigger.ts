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
import * as Member from "./member.ts";
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
 * The document of an event that hands over one, as an existing Document
 * Snapshot: the created one, or the deleted one as it was just before.
 */
const snapshotOf = (
  ref: Collection.DocumentReference<Collection.Any>,
  snapshot: Firestore.QueryDocumentSnapshot | undefined,
) => Effect.map(existingOf(ref, snapshot), (snapshot) => ({ snapshot }));

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
 * Both sides of a change, each read with `side`: both existing for an update,
 * and either one missing for a write. An event without its change is a defect.
 */
const changeOf =
  <S, A>(
    side: (ref: Collection.DocumentReference<Collection.Any>, snapshot: S) => Effect.Effect<A>,
  ) =>
  (ref: Collection.DocumentReference<Collection.Any>, change: Firestore.Change<S> | undefined) =>
    change === undefined
      ? Effect.die(new Error(`The event of "${ref.path}" carries no change`))
      : Effect.all({ before: side(ref, change.before), after: side(ref, change.after) });

/**
 * The conversion of what an `onDocument*` provider hands over into the core
 * event of a trigger: `read` reads the event's data at the document's typed
 * reference, and `make` builds the core event from that and the CloudEvent's
 * `id` and `time`.
 */
const conversion =
  <Data, Fields>(
    read: (ref: Collection.DocumentReference<Collection.Any>, data: Data) => Effect.Effect<Fields>,
    make: (input: Fields & { readonly id: string; readonly time: string }) => unknown,
  ) =>
  (trigger: DocumentTrigger.Any, event: Firestore.FirestoreEvent<Data>) =>
    Effect.flatMap(refOf(trigger, event.document), (ref) =>
      Effect.map(read(ref, event.data), (fields) =>
        make({ ...fields, id: event.id, time: event.time }),
      ),
    );

const createdEvent = conversion(snapshotOf, DocumentTrigger.createdEvent);
const deletedEvent = conversion(snapshotOf, DocumentTrigger.deletedEvent);
const updatedEvent = conversion(changeOf(existingOf), DocumentTrigger.updatedEvent);
const writtenEvent = conversion(changeOf(sideOf), DocumentTrigger.writtenEvent);

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
  const deployment = Member.call(group, trigger, DocumentTrigger.deployment);
  const serve = Member.call<Serve>(group, trigger, DocumentTrigger.serve);
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
  // After `options`, so a caller that passes event filters past the public
  // types can't move the trigger to another path, database or namespace.
  const providerOptions = {
    ...options,
    document: deployment.document,
    database: "(default)",
    namespace: "(default)",
  };
  switch (trigger.event) {
    case "created":
      return Firestore.onDocumentCreated(providerOptions, handler(createdEvent));
    case "deleted":
      return Firestore.onDocumentDeleted(providerOptions, handler(deletedEvent));
    case "updated":
      return Firestore.onDocumentUpdated(providerOptions, handler(updatedEvent));
    case "written":
      return Firestore.onDocumentWritten(providerOptions, handler(writtenEvent));
  }
};
