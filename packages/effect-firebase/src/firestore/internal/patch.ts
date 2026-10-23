import { Inspectable, Predicate } from "effect";
import type * as Patch from "../Patch.ts";

/** @internal */
export const ReplaceTypeId = "~@visiolab/effect-firebase/firestore/Patch/Replace";

const ReplaceProto: Omit<Patch.Replace<unknown>, "value"> = {
  ...Inspectable.BaseProto,
  [ReplaceTypeId]: ReplaceTypeId,
  toJSON(this: Patch.Replace<unknown>) {
    return { _id: "Replace", value: Inspectable.toJson(this.value) };
  },
};

/** @internal */
export const isReplace = (u: unknown): u is Patch.Replace<unknown> =>
  Predicate.hasProperty(u, ReplaceTypeId);

/** @internal */
export const replace = <const A>(value: A): Patch.Replace<A> =>
  Object.assign(Object.create(ReplaceProto) as typeof ReplaceProto, { value });
