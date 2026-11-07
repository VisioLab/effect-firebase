/** @internal */
import { Context, Effect, Layer, Pipeable } from "effect";
import type * as Collection from "../../firestore/Collection.ts";
import type * as DocumentSnapshot from "../../firestore/DocumentSnapshot.ts";
import * as FirebaseFunction from "./firebaseFunction.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/functions/DocumentTrigger";

/** @internal */
export const kind = "DocumentTrigger";

/**
 * The changes to a document a trigger can listen to.
 *
 * @internal
 */
export type EventKind = "created" | "deleted" | "updated" | "written";

/** @internal */
export interface Fields extends FirebaseFunction.Fields {
  readonly kind: typeof kind;
  readonly name: string;
  readonly event: EventKind;
  readonly collection: Collection.Any;
}

const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return Pipeable.pipeArguments(this, arguments);
  },
};

/** @internal */
export const make = (fields: Fields): Fields => Object.assign(Object.create(Proto), fields);

/** @internal */
export const isDocumentTrigger = (u: unknown): u is Fields =>
  typeof u === "object" && u !== null && TypeId in u;

/**
 * A handler as it sits in the context: the services it was built with are
 * already provided, so it needs only those of the event.
 *
 * @internal
 */
export type HandlerService = (event: unknown) => Effect.Effect<void, unknown>;

/**
 * What `toLayer` takes, with the types its signature has already checked
 * erased.
 *
 * @internal
 */
export type HandlerInput = HandlerService | Effect.Effect<HandlerService>;

/**
 * The key of the handler of the Document Trigger `name` in `group`, or in no
 * group.
 *
 * @internal
 */
export const handlerKey = (group: string | undefined, name: string) =>
  FirebaseFunction.handlerKey<HandlerService>(group, name);

/** @internal */
export const toLayer = (group: string | undefined, name: string, handler: HandlerInput) =>
  Layer.effect(
    handlerKey(group, name),
    Effect.gen(function* () {
      const run = Effect.isEffect(handler) ? yield* handler : handler;
      // The services the Layer was built with, under those of the event.
      const built = yield* Effect.context<never>();
      return (event: unknown) =>
        Effect.updateContext(run(event), (call: Context.Context<never>) =>
          Context.merge(built, call),
        );
    }),
  );

/** @internal */
export const serve = (group: FirebaseFunction.Group | undefined, trigger: Fields) =>
  Effect.service(handlerKey(group?.identifier, trigger.name));

/**
 * The path pattern of the documents of `collection`, with a wildcard of its
 * own for each ancestor id and for the document id:
 * `users/{id0}/posts/{id1}`. The wildcards are only ever read back through
 * the event's document path, so their names are free.
 *
 * @internal
 */
export const documentPattern = (collection: Collection.Any): string =>
  collection.path.map((segment, i) => `${segment}/{id${i}}`).join("/");

/** @internal */
export const deployment = (group: FirebaseFunction.Group | undefined, trigger: Fields) => ({
  name: FirebaseFunction.deployedName(group, trigger),
  document: documentPattern(trigger.collection),
});

/** @internal */
export const createdEvent = <C extends Collection.Any>(input: {
  readonly id: string;
  readonly time: string;
  readonly snapshot: DocumentSnapshot.Existing<C>;
}) => ({
  id: input.id,
  time: input.time,
  ref: input.snapshot.ref,
  snapshot: input.snapshot,
});

/**
 * A `deleted` event has the shape of a `created` one, with the document as it
 * was just before it was deleted.
 *
 * @internal
 */
export const deletedEvent = createdEvent;

/**
 * The event of a change with a document on each side. Both sides are at the
 * same reference; `ref` is taken from `after`.
 *
 * @internal
 */
export const changeEvent = <
  C extends Collection.Any,
  S extends DocumentSnapshot.DocumentSnapshot<C>,
>(input: {
  readonly id: string;
  readonly time: string;
  readonly before: S;
  readonly after: S;
}) => ({
  id: input.id,
  time: input.time,
  ref: input.after.ref,
  before: input.before,
  after: input.after,
});
