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
  snapshot: Firestore.QueryDocumentSnapshot | undefined,
) =>
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
 * What an `onDocument*` provider returns.
 *
 * @internal
 */
export type Export = ReturnType<typeof Firestore.onDocumentCreated>;

/**
 * The export of `trigger` in `group`, or in no group: an `onDocumentCreated` export on the
 * `(default)` database, at the path pattern of the trigger's collection, that
 * converts each event and runs it through `DocumentTrigger.serve`. It builds
 * `live` on its own first event. A failed event, or a failed build, is logged
 * and thrown, so Firebase delivers it again when `retry` is set.
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
  return Firestore.onDocumentCreated(
    { ...options, document: deployment.document },
    async (event) => {
      const exit = await run(
        serve.pipe(
          Effect.flatMap((handle) =>
            Effect.flatMap(createdEvent(trigger, event), (input) => handle(input)),
          ),
          // Logged with the services of `live`, so a logger it provides is used.
          Effect.onError(logFailure("A Document Trigger failed")),
        ),
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
    },
  );
};
