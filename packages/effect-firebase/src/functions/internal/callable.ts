/** @internal */
import { Context, Effect, Layer, Pipeable, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as CallableError from "../CallableError.ts";
import type * as CallableRequest from "../CallableRequest.ts";
import type * as CallableMiddleware from "./callableMiddleware.ts";
import * as callableRequest from "./callableRequest.ts";
import * as FirebaseFunction from "./firebaseFunction.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/functions/Callable";

/** @internal */
export const kind = "Callable";

/** @internal */
export interface Fields extends FirebaseFunction.Fields {
  readonly kind: typeof kind;
  readonly name: string;
  readonly payload: Schema.Top;
  readonly success: Schema.Top;
  readonly error: ReadonlySet<Schema.Top>;
  readonly middlewares: ReadonlySet<CallableMiddleware.Key>;
}

const Proto = {
  [TypeId]: TypeId,
  middleware(this: Fields, middleware: CallableMiddleware.Key) {
    return make({
      kind,
      name: this.name,
      payload: this.payload,
      success: this.success,
      error: this.error,
      middlewares: new Set([...this.middlewares, middleware]),
    });
  },
  pipe() {
    return Pipeable.pipeArguments(this, arguments);
  },
};

/** @internal */
export const make = (fields: Fields): Fields => Object.assign(Object.create(Proto), fields);

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
 * The name `callable` is deployed under: its own in no group, or
 * `<group>-<name>` in `group`. The server exports it under this name, and the
 * client calls it.
 *
 * @internal
 */
export const deployedName: (group: FirebaseFunction.Group | undefined, callable: Fields) => string =
  FirebaseFunction.deployedName;

/**
 * The attributes of the server's and the client's span of a call to
 * `callable` in `group`, or in no group.
 *
 * @internal
 */
export const spanAttributes = (
  group: FirebaseFunction.Group | undefined,
  callable: Fields,
): Readonly<Record<string, string>> => ({
  "rpc.system": "firebase_callable",
  "rpc.method": callable.name,
  ...(group === undefined ? {} : { "rpc.service": group.identifier }),
  "faas.name": deployedName(group, callable),
});

/**
 * The schemas of every error a call to `callable` can be answered with: its
 * declared errors, then those of its middleware.
 *
 * @internal
 */
export const errorSchemas = (callable: Fields): ReadonlyArray<Schema.Top> => [
  ...callable.error,
  ...[...callable.middlewares].flatMap((middleware) => [...middleware.error]),
];

/**
 * Turns a failure of the call into the answer that carries it: the code of
 * the error schema it matches, a readable message, and the encoded error. A
 * failure no schema matches, or one that doesn't encode, is a defect.
 */
const encodeFailure = (schemas: ReadonlyArray<Schema.Top>, error: unknown) =>
  Effect.gen(function* () {
    for (const schema of schemas) {
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

/**
 * The failure of a raw Payload that doesn't decode, as it leaves the chain.
 * Middleware sees it like any other failure.
 */
class PayloadDecodeError {
  constructor(readonly cause: Schema.SchemaError) {}
}

/**
 * The middleware chain of `callable` in `group`, or in no group, around the
 * Payload's decoding and the handler. `serve`, which `Functions` runs,
 * and `handler` both run this one chain.
 *
 * The middleware implementations are read from the context once. The context
 * the chain was read in sits under that of each call, and the call's request
 * on top of both.
 *
 * @internal
 */
export const chain = (group: FirebaseFunction.Group | undefined, callable: Fields) =>
  Effect.gen(function* () {
    const handler = yield* Effect.service(handlerKey(group?.identifier, callable.name));
    const context = yield* Effect.context<never>();
    // Innermost first: a middleware attached later wraps the ones before it.
    const implementations = [...callable.middlewares].map((key) => Context.getUnsafe(context, key));
    const decode = Schema.decodeUnknownEffect(codec(callable.payload));
    return (request: CallableRequest.CallableRequest): Effect.Effect<unknown, unknown> => {
      let effect: Effect.Effect<unknown, unknown> = decode(request.data).pipe(
        Effect.mapError((cause) => new PayloadDecodeError(cause)),
        Effect.flatMap(handler),
      );
      for (const implementation of implementations) {
        effect = implementation(effect, { callable });
      }
      return effect.pipe(
        Effect.provideService(callableRequest.CallableRequest, request),
        Effect.updateContext((call: Context.Context<never>) => Context.merge(context, call)),
      );
    };
  });

/** @internal */
export const serve = (group: FirebaseFunction.Group | undefined, callable: Fields) =>
  Effect.map(chain(group, callable), (run) => {
    const encode = Schema.encodeUnknownEffect(codec(callable.success));
    const schemas = errorSchemas(callable);
    const fail = (reason: CallableError.ResponseError) =>
      new CallableError.CallableError({
        callable: deployedName(group, callable),
        reason,
      });
    return (request: CallableRequest.CallableRequest) =>
      run(request).pipe(
        Effect.catch((error) =>
          error instanceof PayloadDecodeError
            ? Effect.logDebug("The Payload of a Callable didn't decode", error.cause).pipe(
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
              )
            : Effect.flatMap(encodeFailure(schemas, error), (reason) => Effect.fail(fail(reason))),
        ),
        Effect.flatMap((value) => Effect.orDie(encode(value))),
      );
  });

/**
 * The HTTP request of a call `handler` runs with no request given: a JSON
 * `POST` of the encoded Payload to the deployed name.
 */
const syntheticRequest = (name: string, data: unknown) =>
  HttpServerRequest.fromWeb(
    new Request(`http://localhost/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }),
  );

/** @internal */
export const handler = (group: FirebaseFunction.Group | undefined, callable: Fields) =>
  Effect.map(chain(group, callable), (run) => {
    const encode = Schema.encodeUnknownEffect(codec(callable.payload));
    const name = deployedName(group, callable);
    return (payload: unknown, input: CallableRequest.Input) =>
      encode(payload).pipe(
        Effect.orDie,
        Effect.flatMap((data) =>
          run({
            auth:
              input.auth === undefined
                ? undefined
                : {
                    uid: input.auth.uid,
                    token: input.auth.token,
                    rawToken: input.auth.rawToken ?? "",
                  },
            app: input.app,
            instanceIdToken: input.instanceIdToken,
            data,
            rawRequest: input.rawRequest ?? syntheticRequest(name, data),
          }),
        ),
        // The Payload was encoded from its own type, so a Payload that doesn't
        // decode back is a defect of its schema.
        Effect.catchIf(
          (error): error is PayloadDecodeError => error instanceof PayloadDecodeError,
          (error) => Effect.die(error.cause),
        ),
      );
  });
