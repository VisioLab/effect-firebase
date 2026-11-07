/** @internal */
import { Pipeable } from "effect";
import type * as FirebaseFunction from "./firebaseFunction.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/functions/FunctionGroup";

/** @internal */
export interface Fields {
  readonly identifier: string;
  readonly functions: Readonly<Record<string, FirebaseFunction.Fields>>;
}

/** @internal */
export const isFunctionGroup = (u: unknown): u is Fields =>
  (typeof u === "function" || (typeof u === "object" && u !== null)) && TypeId in u;

const Proto = {
  [TypeId]: TypeId,
  add(this: Fields, ...toAdd: ReadonlyArray<FirebaseFunction.Fields>) {
    const functions = { ...this.functions };
    for (const fn of toAdd) {
      if (Object.hasOwn(functions, fn.name)) {
        throw new Error(
          `The Function Group "${this.identifier}" already has a Function named "${fn.name}"`,
        );
      }
      functions[fn.name] = fn;
    }
    return make({ identifier: this.identifier, functions });
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
  function FunctionGroup() {}
  Object.setPrototypeOf(FunctionGroup, Proto);
  return Object.assign(FunctionGroup, fields);
};
