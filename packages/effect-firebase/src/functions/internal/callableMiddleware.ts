/** @internal */
import { Context, type Effect, type Schema } from "effect";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/functions/CallableMiddleware";

/**
 * A middleware's key as the chain reads it, with its types erased.
 *
 * @internal
 */
export interface Key extends Context.Key<never, Implementation> {
  readonly [TypeId]: typeof TypeId;
  readonly error: ReadonlySet<Schema.Top>;
}

/**
 * A middleware's implementation as the chain runs it.
 *
 * @internal
 */
export type Implementation = (
  effect: Effect.Effect<unknown, unknown>,
  options: { readonly callable: unknown },
) => Effect.Effect<unknown, unknown>;

/**
 * The middleware attached to a Callable, as a union, from its phantom
 * `~Middleware` field.
 *
 * @internal
 */
export type Attached<X> = X extends { readonly "~Middleware": infer M } ? M : never;

/**
 * What the middleware attached to a Callable still requires, from its phantom
 * `~MiddlewareServices` field.
 *
 * @internal
 */
export type AttachedServices<X> = X extends { readonly "~MiddlewareServices": infer R } ? R : never;

/** @internal */
export const Service = (
  id: string,
  options?: { readonly error?: Schema.Top | ReadonlyArray<Schema.Top> | undefined },
) => {
  class Service extends Context.Service<Service, any>()(id) {}
  const self = Service as any;
  self[TypeId] = TypeId;
  const error = options?.error;
  self.error = new Set(error === undefined ? [] : Array.isArray(error) ? error : [error]);
  return self;
};
