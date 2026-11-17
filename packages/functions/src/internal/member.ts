/**
 * How a kind's runtime calls the core functions that take a Function alone or
 * a Function Group and a member's name, such as `deployment` and `serve`.
 *
 * @internal
 */
import type { Effect } from "effect";
import type * as FirebaseFunction from "@visiolab/effect-firebase/functions/FirebaseFunction";
import type * as FunctionGroup from "@visiolab/effect-firebase/functions/FunctionGroup";

/**
 * Calls `api` with `fn` alone, or with `group` and the name of `fn` when it is
 * a member of `group`. The kind's public signatures already checked that `fn`
 * is of the kind `api` takes, so its arguments are erased.
 *
 * @internal
 */
export const call = <A>(
  group: FunctionGroup.Any | undefined,
  fn: FirebaseFunction.Any,
  api: (...args: ReadonlyArray<never>) => A,
): A => (group === undefined ? api(fn as never) : api(group as never, fn.name as never));

/**
 * `call` for a kind's `serve`, with the services it requires taken to be
 * those `live` provides: `R`. The kind's public signatures already checked
 * that `live` provides them.
 *
 * @internal
 */
export const serve = <S, R>(
  group: FunctionGroup.Any | undefined,
  fn: FirebaseFunction.Any,
  api: (...args: ReadonlyArray<never>) => Effect.Effect<S, never, any>,
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off `Functions.make` and `Functions.group` checked that `live` provides what `api` requires
): Effect.Effect<S, never, R> => call(group, fn, api);
