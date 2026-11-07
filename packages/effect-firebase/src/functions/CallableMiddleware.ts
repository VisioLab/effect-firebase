/**
 * Callable Middleware: what runs around every call to the Callables it is
 * attached to, before the Payload is decoded.
 *
 * A middleware is declared once, with what it provides to the handler, what it
 * requires from middleware outside it and the errors it can fail with. It is
 * attached to a Callable with `.middleware(M)`, and implemented as a Layer of a
 * function that wraps the call. The implementation is provided where the
 * chain runs: to `CallableFunction` from `@visiolab/effect-firebase-functions`,
 * or to `Callable.handler`.
 *
 * @example Declaring, attaching and implementing a middleware
 * ```ts
 * import { Context, Effect, Layer, Schema } from "effect";
 * import { Callable, CallableError, CallableMiddleware, CallableRequest } from "@visiolab/effect-firebase/functions";
 *
 * class Tenant extends Context.Service<Tenant, { readonly id: string }>()("Tenant") {}
 *
 * class WithTenant extends CallableMiddleware.Service<WithTenant, { provides: Tenant }>()(
 *   "WithTenant",
 *   { error: CallableError.PermissionDenied },
 * ) {}
 *
 * const ListUsers = Callable.make("listUsers", { success: Schema.Array(Schema.String) }).middleware(
 *   WithTenant,
 * );
 *
 * const WithTenantLive = Layer.succeed(WithTenant, (effect) =>
 *   Effect.gen(function* () {
 *     const { auth } = yield* CallableRequest.CallableRequest;
 *     const id = auth?.token["tenant"];
 *     if (typeof id !== "string") return yield* new CallableError.PermissionDenied();
 *     return yield* Effect.provideService(effect, Tenant, { id });
 *   }),
 * );
 * ```
 *
 * @stability unstable
 * @since 0.3.0
 */
import type { Context, Effect, Schema } from "effect";
import type { unhandled } from "effect/Types";
import type * as Callable from "./Callable.ts";
// Only the documentation links to it.
// oxlint-disable-next-line no-unused-vars
import type * as CallableGroup from "./CallableGroup.ts";
import type * as CallableRequest from "./CallableRequest.ts";
import * as internal from "./internal/callableMiddleware.ts";

const TypeId = internal.TypeId;

/**
 * The errors a middleware can fail with: one schema or an array.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type ErrorConstraint = Schema.Top | ReadonlyArray<Schema.Top>;

type ErrorSchemaFromConstraint<E> =
  E extends ReadonlyArray<Schema.Top> ? E[number] : E extends Schema.Top ? E : never;

/**
 * What a middleware's implementation is told about the call it wraps.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface Options {
  /** The Callable being called. */
  readonly callable: Callable.Any;
}

/**
 * The implementation of a middleware: a function that wraps the rest of the
 * call.
 *
 * **Details**
 *
 * `effect` is the rest of the call: the middleware inside this one, the
 * Payload's decoding and the handler. It needs what this middleware
 * `Provides`. The implementation may run it, fail instead, or catch what it
 * fails with. It may require what middleware outside it provides, and always
 * the {@link CallableRequest.CallableRequest}.
 *
 * A Payload that doesn't decode fails `effect` too. An implementation that
 * catches every failure catches that one as well, and the caller then no
 * longer gets `invalid-argument`. Catch only the errors you mean to.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type CallableMiddleware<Provides, E extends ErrorConstraint, Requires> = (
  effect: Effect.Effect<unknown, unhandled, Provides>,
  options: Options,
) => Effect.Effect<
  unknown,
  unhandled | ErrorSchemaFromConstraint<E>["Type"],
  Requires | CallableRequest.CallableRequest
>;

/**
 * Any middleware, as the type of its service class's instances: what it
 * provides, requires and fails with.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface AnyId {
  readonly [TypeId]: {
    readonly provides: any;
    readonly requires: any;
    readonly error: ErrorConstraint;
  };
}

/**
 * Any middleware's service key, as `.middleware` takes it.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export interface AnyKey extends Context.Key<any, any> {
  readonly [TypeId]: typeof TypeId;
  /** The schemas of the errors the middleware can fail with. */
  readonly error: ReadonlySet<Schema.Top>;
}

/**
 * The services a middleware provides to what it wraps.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Provides<A> = A extends { readonly [TypeId]: { readonly provides: infer P } }
  ? P
  : never;

/**
 * The services a middleware requires from the middleware outside it.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Requires<A> = A extends { readonly [TypeId]: { readonly requires: infer R } }
  ? R
  : never;

/**
 * The services still required after wrapping `R` in the middleware `A`: `A`'s
 * `provides` are removed and its `requires` added.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type ApplyServices<A extends AnyId, R> = Exclude<R, Provides<A>> | Requires<A>;

/**
 * The union of the error schemas of a middleware.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type ErrorSchema<A> = A extends { readonly [TypeId]: { readonly error: infer E } }
  ? ErrorSchemaFromConstraint<E>
  : never;

/**
 * The errors a middleware can fail with.
 *
 * @stability unstable
 * @category type-level
 * @since 0.3.0
 */
export type Error<A> = ErrorSchema<A>["Type"];

/**
 * The class {@link Service} returns: a service key whose instances carry the
 * middleware's types.
 *
 * @stability unstable
 * @category models
 * @since 0.3.0
 */
export type ServiceClass<
  Self,
  Id extends string,
  Config extends { requires: any; provides: any; error: ErrorConstraint },
> = Context.Service<
  Self,
  CallableMiddleware<Config["provides"], Config["error"], Config["requires"]>
> & {
  new (_: never): Context.ServiceClass.Shape<
    Id,
    CallableMiddleware<Config["provides"], Config["error"], Config["requires"]>
  > & {
    readonly [TypeId]: {
      readonly error: Config["error"];
      readonly requires: Config["requires"];
      readonly provides: Config["provides"];
    };
  };
  readonly [TypeId]: typeof TypeId;
  /** The schemas of the errors the middleware can fail with. */
  readonly error: ReadonlySet<Schema.Top>;
};

/**
 * Declares a Callable Middleware as a class.
 *
 * **When to use**
 *
 * Use to state a requirement of a Callable, such as "the caller is a member of
 * a tenant", as part of its contract. For "the caller is signed in", use the
 * built-in `Caller.Authenticated`.
 *
 * **Details**
 *
 * `provides` is what the middleware gives the handler: the handler's Layer no
 * longer needs it. `requires` is what it needs from middleware outside it; a
 * `requires` that nothing outside provides is left for the Layers where the
 * chain runs. The {@link CallableRequest.CallableRequest} is always there and
 * is never listed.
 *
 * `error` is one schema or an array. A middleware's errors join the error
 * union of every Callable it is attached to. They are sent like the
 * Callable's declared errors, and the client decodes them back.
 *
 * The middleware runs before the Payload is decoded, so a call it rejects
 * learns nothing from the Payload's decoding. The decoding runs inside the
 * chain, so an implementation that catches every failure also catches a
 * Payload that doesn't decode.
 *
 * @example Declaring a middleware
 * ```ts
 * import { Context } from "effect";
 * import { CallableError, CallableMiddleware } from "@visiolab/effect-firebase/functions";
 *
 * class Tenant extends Context.Service<Tenant, { readonly id: string }>()("Tenant") {}
 *
 * class WithTenant extends CallableMiddleware.Service<WithTenant, { provides: Tenant }>()(
 *   "WithTenant",
 *   { error: CallableError.PermissionDenied },
 * ) {}
 * ```
 *
 * @see {@link Callable.Callable.middleware} for attaching it to a Callable
 * @see {@link CallableGroup.CallableGroup.middleware} for attaching it to every member of a group
 * @see {@link Caller.Authenticated} for the built-in middleware
 *
 * @stability unstable
 * @category constructors
 * @since 0.3.0
 */
export const Service =
  <
    Self,
    Config extends { requires?: any; provides?: any } = { requires: never; provides: never },
  >() =>
  <const Id extends string, const Error extends ErrorConstraint = never>(
    id: Id,
    options?: { readonly error?: Error | undefined },
  ): ServiceClass<
    Self,
    Id,
    {
      requires: "requires" extends keyof Config ? Config["requires"] : never;
      provides: "provides" extends keyof Config ? Config["provides"] : never;
      error: Error;
    }
  > =>
    internal.Service(id, options);
