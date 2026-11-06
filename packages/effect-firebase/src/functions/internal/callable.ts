/** @internal */
import { Pipeable, type Schema } from "effect";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/functions/Callable";

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
