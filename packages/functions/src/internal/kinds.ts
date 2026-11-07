/**
 * Where `Functions.make` and `Functions.group` dispatch on a Function's kind.
 * A new kind adds its runtime's `deploy` here, and its types to the
 * kind-dispatched types of `Functions.ts` (`Export`, `Options`, `Services`).
 *
 * @internal
 */
import type { Layer } from "effect";
import type * as Callable from "@visiolab/effect-firebase/functions/Callable";
import type * as FirebaseFunction from "@visiolab/effect-firebase/functions/FirebaseFunction";
import type * as FunctionGroup from "@visiolab/effect-firebase/functions/FunctionGroup";
import * as callable from "./callable.ts";

/**
 * The export of `fn` in `group`, or in no group, from its kind's runtime.
 * `options` are the member's own, typed by kind in the public signatures.
 *
 * @internal
 */
export const deploy = <R, E>(
  group: FunctionGroup.Any | undefined,
  fn: FirebaseFunction.Any,
  live: Layer.Layer<R, E>,
  options: object | undefined,
): unknown => {
  switch (fn.kind) {
    case "Callable":
      return callable.deploy(group, fn as Callable.Any, live, options);
    default:
      throw new Error(`Functions can't deploy "${fn.name}": its kind "${fn.kind}" is unknown`);
  }
};
