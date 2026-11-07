/** @internal */
import { Context } from "effect";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/functions/FirebaseFunction";

/** @internal */
export const NoGroupTypeId = "~@visiolab/effect-firebase/functions/FirebaseFunction/NoGroup";

/** @internal */
export const HandlerTypeId = "~@visiolab/effect-firebase/functions/FirebaseFunction/Handler";

/**
 * What every kind of Function holds: its kind and its name.
 *
 * @internal
 */
export interface Fields {
  readonly kind: string;
  readonly name: string;
}

/**
 * The fields of a Function Group that a Function in it is served by.
 *
 * @internal
 */
export interface Group {
  readonly identifier: string;
}

/**
 * The key of the handler of the Function `name` in `group`, or in no group,
 * whatever its kind. A kind decides what it holds.
 *
 * Context keys are compared by their string, so every call with the same group
 * and name reaches the same service. Deployed names can't contain `/`, so the
 * two forms can't collide. Names are unique within a group, and a Function in
 * no group is deployed under its name, so two kinds never share a key they
 * could both be served under.
 *
 * @internal
 */
export const handlerKey = <S>(group: string | undefined, name: string) =>
  Context.Service<never, S>(
    group === undefined
      ? `@visiolab/effect-firebase/functions/Handler/${name}`
      : `@visiolab/effect-firebase/functions/Handler/${group}/${name}`,
  );

/**
 * The name `fn` is deployed under: its own in no group, or `<group>-<name>`
 * in `group`.
 *
 * @internal
 */
export const deployedName = (group: Group | undefined, fn: Fields): string =>
  group === undefined ? fn.name : `${group.identifier}-${fn.name}`;
