/** @internal */
import { Context, Effect, Layer, Pipeable, Schema } from "effect";
import * as CallableError from "../CallableError.ts";

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
  readonly error: ReadonlySet<Schema.Top>;
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
export type HandlerService = (payload: unknown) => Effect.Effect<unknown, unknown>;

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
export const getErrorCode = (schema: Schema.Top): CallableError.ErrorCode =>
  Schema.resolveAnnotations(schema)?.callableErrorCode ?? "internal";

/**
 * Turns a failure of the handler into the answer that carries it: the code of
 * the declared schema it matches, a readable message, and the encoded error.
 * A failure no declared schema matches, or one that doesn't encode, is a
 * defect.
 */
const encodeFailure = (callable: Fields, error: unknown) =>
  Effect.gen(function* () {
    for (const schema of callable.error) {
      if (!Schema.is(schema as Schema.Codec<unknown>)(error)) continue;
      const code = getErrorCode(schema);
      const details = yield* Effect.orDie(Schema.encodeUnknownEffect(codec(schema))(error));
      const fields = error as { readonly message?: unknown; readonly _tag?: unknown };
      const message =
        typeof fields.message === "string" && fields.message !== ""
          ? fields.message
          : typeof fields._tag === "string"
            ? fields._tag
            : code;
      return new CallableError.ResponseError({ code, message, details });
    }
    return yield* Effect.die(error);
  });

/** @internal */
export const serve = (callable: Fields) =>
  Effect.map(Effect.service(handlerKey(undefined, callable.name)), (handler) => {
    const decode = Schema.decodeUnknownEffect(codec(callable.payload));
    const encode = Schema.encodeUnknownEffect(codec(callable.success));
    const fail = (reason: CallableError.ResponseError) =>
      new CallableError.CallableError({ callable: callable.name, reason });
    return (data: unknown) =>
      decode(data).pipe(
        Effect.catch((error) =>
          Effect.logDebug("The Payload of a Callable didn't decode", error).pipe(
            Effect.andThen(
              Effect.fail(
                fail(
                  new CallableError.ResponseError({
                    code: "invalid-argument",
                    message: "The Payload didn't decode",
                    details: undefined,
                  }),
                ),
              ),
            ),
          ),
        ),
        Effect.flatMap((payload) =>
          handler(payload).pipe(
            Effect.catch((error) =>
              Effect.flatMap(encodeFailure(callable, error), (reason) => Effect.fail(fail(reason))),
            ),
          ),
        ),
        Effect.flatMap((value) => Effect.orDie(encode(value))),
      );
  });
