/** @internal */
import { Context, Effect, Layer, Pipeable, Schema } from "effect";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/functions/Callable";

/** @internal */
export const NoGroupTypeId = "~@visiolab/effect-firebase/functions/Callable/NoGroup";

/** @internal */
export const HandlerTypeId = "~@visiolab/effect-firebase/functions/Callable/Handler";

/** @internal */
export interface Fields {
  readonly name: string;
  readonly payload: Schema.Top;
  readonly success: Schema.Top;
}

const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return Pipeable.pipeArguments(this, arguments);
  },
};

/** @internal */
export const make = (fields: Fields) => Object.assign(Object.create(Proto), fields);

/**
 * A handler as it sits in the context: the services it was built with are
 * already provided, so it needs only those of the call.
 *
 * @internal
 */
export type HandlerService = (payload: unknown) => Effect.Effect<unknown>;

/**
 * What `toLayer` takes, with the types its signature has already checked
 * erased.
 *
 * @internal
 */
export type HandlerInput = HandlerService | Effect.Effect<HandlerService>;

/**
 * The key of the handler of the Callable `name` in `group`, or in no group.
 *
 * Context keys are compared by their string, so every call with the same group
 * and name reaches the same service. Deployed names can't contain `/`, so the
 * two forms can't collide.
 *
 * @internal
 */
export const handlerKey = (group: string | undefined, name: string) =>
  Context.Service<never, HandlerService>(
    group === undefined
      ? `@visiolab/effect-firebase/functions/Callable/Handler/${name}`
      : `@visiolab/effect-firebase/functions/Callable/Handler/${group}/${name}`,
  );

/** @internal */
export const toLayer = (name: string, handler: HandlerInput) =>
  Layer.effect(
    handlerKey(undefined, name),
    Effect.gen(function* () {
      const run = Effect.isEffect(handler) ? yield* handler : handler;
      // The services the Layer was built with, under those of the call.
      const built = yield* Effect.context<never>();
      return (payload: unknown) =>
        Effect.updateContext(run(payload), (call: Context.Context<never>) =>
          Context.merge(built, call),
        );
    }),
  );

/**
 * Schemas with their services erased: a Callable's codecs need none that the
 * types track, and `Schema.Top` leaves them `unknown`.
 */
const codec = (schema: Schema.Top) => Schema.toCodecJson(schema as Schema.Codec<unknown>);

/** @internal */
export const serve = (callable: Fields) =>
  Effect.map(Effect.service(handlerKey(undefined, callable.name)), (handler) => {
    const decode = Schema.decodeUnknownEffect(codec(callable.payload));
    const encode = Schema.encodeUnknownEffect(codec(callable.success));
    return (data: unknown) =>
      decode(data).pipe(
        Effect.flatMap(handler),
        Effect.flatMap((value) => Effect.orDie(encode(value))),
      );
  });
