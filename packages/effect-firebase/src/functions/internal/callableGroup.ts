/** @internal */
import { Pipeable } from "effect";
import type * as Callable from "./callable.ts";
import type * as CallableMiddleware from "./callableMiddleware.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/functions/CallableGroup";

/** @internal */
export interface Fields {
  readonly identifier: string;
  readonly callables: Readonly<Record<string, Callable.Fields>>;
  /** The group's own middleware, in the order it was attached. */
  readonly middlewares: ReadonlySet<CallableMiddleware.Key>;
}

/** @internal */
export const isCallableGroup = (u: unknown): u is Fields =>
  (typeof u === "function" || (typeof u === "object" && u !== null)) && TypeId in u;

const Proto = {
  [TypeId]: TypeId,
  add(this: Fields, ...toAdd: ReadonlyArray<Callable.Fields>) {
    const callables = { ...this.callables };
    for (const callable of toAdd) {
      if (Object.hasOwn(callables, callable.name)) {
        throw new Error(
          `The Callable Group "${this.identifier}" already has a Callable named "${callable.name}"`,
        );
      }
      callables[callable.name] = callable;
    }
    return make({ identifier: this.identifier, callables, middlewares: this.middlewares });
  },
  middleware(this: Fields, middleware: CallableMiddleware.Key) {
    return make({
      identifier: this.identifier,
      callables: this.callables,
      middlewares: new Set([...this.middlewares, middleware]),
    });
  },
  pipe() {
    return Pipeable.pipeArguments(this, arguments);
  },
};

/**
 * A function, so that a group can be the base of a class. Its `name` is the
 * function's own, so the group's name is its `identifier`.
 *
 * @internal
 */
export const make = (fields: Fields) => {
  function CallableGroup() {}
  Object.setPrototypeOf(CallableGroup, Proto);
  return Object.assign(CallableGroup, fields);
};
