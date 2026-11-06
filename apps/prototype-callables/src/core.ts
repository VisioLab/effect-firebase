// PROTOTYPE, throwaway. Rough stand-in for @visiolab/effect-firebase/functions
// (Callable, CallableGroup, CallableMiddleware, CallableError, Caller), built to
// check that the decided shape holds up end to end (wayfinder #165).
import { Context, Effect, Layer, Schema } from "effect";

// ---------------------------------------------------------------------------
// Error codes

export type FunctionsErrorCode =
  | "cancelled"
  | "unknown"
  | "invalid-argument"
  | "deadline-exceeded"
  | "not-found"
  | "already-exists"
  | "permission-denied"
  | "resource-exhausted"
  | "failed-precondition"
  | "aborted"
  | "out-of-range"
  | "unimplemented"
  | "internal"
  | "unavailable"
  | "data-loss"
  | "unauthenticated";

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      readonly callableErrorCode?: FunctionsErrorCode | undefined;
    }
  }
}

export const errorCode =
  (code: FunctionsErrorCode) =>
  <S extends Schema.Top>(self: S): S["Rebuild"] =>
    self.annotate({ callableErrorCode: code });

export const getErrorCode = (schema: Schema.Top): FunctionsErrorCode =>
  Schema.resolveAnnotations(schema)?.callableErrorCode ?? "internal";

// ---------------------------------------------------------------------------
// Middleware

export interface MiddlewareFn<Provides, Requires> {
  (
    effect: Effect.Effect<unknown, unknown, Provides>,
    options: { readonly callable: AnyCallable },
  ): Effect.Effect<unknown, unknown, Requires>;
}

export interface MiddlewareClass<Self, Provides, Requires, Errors extends ReadonlyArray<Schema.Top>>
  extends Context.Key<Self, MiddlewareFn<Provides, Requires>> {
  new (_: never): {};
  readonly errors: Errors;
  readonly "~provides": Provides;
  readonly "~requires": Requires;
}

export type AnyMiddleware = MiddlewareClass<any, any, any, ReadonlyArray<Schema.Top>>;

export const Middleware =
  <Self, Config extends { provides?: any; requires?: any } = {}>() =>
  <const Errors extends ReadonlyArray<Schema.Top> = []>(
    id: string,
    options?: { readonly error?: Errors },
  ): MiddlewareClass<
    Self,
    "provides" extends keyof Config ? Config["provides"] : never,
    "requires" extends keyof Config ? Config["requires"] : never,
    Errors
  > => {
    function MiddlewareClass() {}
    Object.setPrototypeOf(MiddlewareClass, Object.getPrototypeOf(Context.Service<Self, any>(id)));
    (MiddlewareClass as any).key = id;
    (MiddlewareClass as any).errors = options?.error ?? [];
    return MiddlewareClass as any;
  };

// ---------------------------------------------------------------------------
// Callable

export interface Callable<
  Name extends string,
  Payload extends Schema.Top,
  Success extends Schema.Top,
  Errors extends ReadonlyArray<Schema.Top>,
  M extends AnyMiddleware = never,
> {
  readonly name: Name;
  readonly payload: Payload;
  readonly success: Success;
  readonly errors: Errors;
  readonly middlewares: ReadonlyArray<AnyMiddleware>;
  readonly handlerKey: Context.Key<Handler<Name>, HandlerFn>;
  readonly "~middleware"?: M;
  middleware<M2 extends AnyMiddleware>(m: M2): Callable<Name, Payload, Success, Errors, M | M2>;
}

export interface AnyCallable {
  readonly name: string;
  readonly payload: Schema.Top;
  readonly success: Schema.Top;
  readonly errors: ReadonlyArray<Schema.Top>;
  readonly middlewares: ReadonlyArray<AnyMiddleware>;
  readonly handlerKey: Context.Key<any, HandlerFn>;
}

export type PayloadOf<C> = C extends Callable<any, infer P, any, any, any> ? P["Type"] : never;
export type SuccessOf<C> = C extends Callable<any, any, infer S, any, any> ? S["Type"] : never;
export type MiddlewareOf<C> = C extends Callable<any, any, any, any, infer M> ? M : never;
type MiddlewareErrors<M> =
  M extends MiddlewareClass<any, any, any, infer E> ? E[number]["Type"] : never;
type MiddlewareProvides<M> = M extends MiddlewareClass<any, infer P, any, any> ? P : never;
type MiddlewareIds<M> = M extends MiddlewareClass<infer Id, any, any, any> ? Id : never;
/** Declared errors plus the errors of every attached middleware. */
export type ErrorOf<C> =
  C extends Callable<any, any, any, infer E, infer M>
    ? E[number]["Type"] | MiddlewareErrors<M>
    : never;
/** Error schemas the wire may carry: declared plus middleware. */
export const allErrors = (c: AnyCallable): ReadonlyArray<Schema.Top> => [
  ...c.errors,
  ...c.middlewares.flatMap((m) => m.errors),
];

/** Handler key identity: unique per Callable object. */
export interface Handler<Name extends string> {
  readonly _: unique symbol;
  readonly name: Name;
}
export type HandlerFn = (payload: unknown) => Effect.Effect<unknown, unknown, unknown>;

let handlerCounter = 0;

export const make = <
  const Name extends string,
  Payload extends Schema.Top | Schema.Struct.Fields = Schema.Void,
  Success extends Schema.Top = Schema.Void,
  const Error extends Schema.Top | ReadonlyArray<Schema.Top> = [],
>(
  name: Name,
  options: {
    readonly payload?: Payload;
    readonly success?: Success;
    readonly error?: Error;
  } = {},
): Callable<
  Name,
  Payload extends Schema.Struct.Fields ? Schema.Struct<Payload> : Payload,
  Success,
  Error extends ReadonlyArray<Schema.Top> ? Error : [Error]
> => {
  const payload = Schema.isSchema(options.payload)
    ? options.payload
    : options.payload
      ? Schema.Struct(options.payload as Schema.Struct.Fields)
      : Schema.Void;
  const errors: ReadonlyArray<Schema.Top> = options.error
    ? Array.isArray(options.error)
      ? (options.error as ReadonlyArray<Schema.Top>)
      : [options.error as Schema.Top]
    : [];
  return makeProto(name, payload, options.success ?? Schema.Void, errors, []) as any;
};

const makeProto = (
  name: string,
  payload: Schema.Top,
  success: Schema.Top,
  errors: ReadonlyArray<Schema.Top>,
  middlewares: ReadonlyArray<AnyMiddleware>,
  handlerKey = Context.Service<any, HandlerFn>(`Callable/${name}#${handlerCounter++}`),
): any => ({
  name,
  payload,
  success,
  errors,
  middlewares,
  handlerKey,
  middleware: (m: AnyMiddleware) =>
    makeProto(name, payload, success, errors, [...middlewares, m], handlerKey),
});

/**
 * `Callable.toLayer(C, handler | Effect<handler>)`. The Layer requires the
 * handler's services minus what the middlewares provide, plus the middleware
 * implementations themselves.
 */
export const toLayer = <C extends Callable<any, any, any, any, any>, E = never, R = never, RL = never, EL = never>(
  callable: C,
  handler:
    | ((payload: PayloadOf<C>) => Effect.Effect<SuccessOf<C>, ErrorOf<C>, R>)
    | Effect.Effect<(payload: PayloadOf<C>) => Effect.Effect<SuccessOf<C>, ErrorOf<C>, R>, EL, RL>,
): Layer.Layer<
  Handler<C["name"]>,
  EL | E,
  Exclude<R, MiddlewareProvides<MiddlewareOf<C>>> | MiddlewareIds<MiddlewareOf<C>> | RL
> =>
  Layer.effect(
    callable.handlerKey,
    Effect.gen(function* () {
      const fn = Effect.isEffect(handler) ? yield* handler : handler;
      // Capture the context the Layer was built in, as RpcGroup.toHandlers does.
      const context = yield* Effect.context<any>();
      return ((payload: unknown) =>
        Effect.provideContext(fn(payload as any), context) as any) as HandlerFn;
    }),
  ) as any;

// ---------------------------------------------------------------------------
// CallableGroup

export interface CallableGroup<Name extends string, Members extends AnyCallable> {
  readonly name: Name;
  readonly callables: ReadonlyArray<Members>;
  add<const More extends ReadonlyArray<AnyCallable>>(
    ...callables: More
  ): CallableGroup<Name, Members | More[number]>;
  middleware<M extends AnyMiddleware>(
    m: M,
  ): CallableGroup<Name, Members extends Callable<infer N, infer P, infer S, infer E, infer M0> ? Callable<N, P, S, E, M0 | M> : never>;
}

export const group = <const Name extends string>(name: Name): CallableGroup<Name, never> =>
  makeGroup(name, []);

const makeGroup = (name: string, callables: ReadonlyArray<any>): any => ({
  name,
  callables,
  add: (...more: ReadonlyArray<AnyCallable>) => makeGroup(name, [...callables, ...more]),
  middleware: (m: AnyMiddleware) =>
    makeGroup(
      name,
      callables.map((c) => c.middleware(m)),
    ),
});

// ---------------------------------------------------------------------------
// CallableError: the client's error and the built-in errors

export class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  cause: Schema.Defect(),
}) {}
export class ResponseError extends Schema.TaggedError<ResponseError>()("ResponseError", {
  code: Schema.String,
  message: Schema.String,
  details: Schema.Unknown,
}) {}
export class DecodeError extends Schema.TaggedError<DecodeError>()("DecodeError", {
  cause: Schema.Defect(),
}) {}
export class EncodeError extends Schema.TaggedError<EncodeError>()("EncodeError", {
  cause: Schema.Defect(),
}) {}

export class CallableError extends Schema.TaggedError<CallableError>()("CallableError", {
  callable: Schema.String,
  reason: Schema.Union([TransportError, ResponseError, DecodeError, EncodeError]),
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "not-found" },
) {}
export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Unauthenticated",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "unauthenticated" },
) {}
export class PermissionDenied extends Schema.TaggedError<PermissionDenied>()(
  "PermissionDenied",
  { message: Schema.optional(Schema.String) },
  { callableErrorCode: "permission-denied" },
) {}

// ---------------------------------------------------------------------------
// Caller + Authenticated

export class Caller extends Context.Service<
  Caller,
  {
    readonly uid: string;
    readonly claims: Readonly<Record<string, unknown>>;
    readonly token: string;
  }
>()("effect-firebase/functions/Caller") {}

export class Authenticated extends Middleware<Authenticated, { provides: Caller }>()(
  "effect-firebase/functions/Authenticated",
  { error: [Unauthenticated] },
) {}
