import { Equal, Hash, Inspectable, Predicate } from "effect";
import type * as FieldValue from "../FieldValue.ts";

/** @internal */
export const ServerTimestampTypeId =
  "~@visiolab/effect-firebase/firestore/FieldValue/ServerTimestamp";

const ServerTimestampProto: FieldValue.ServerTimestamp = {
  ...Inspectable.BaseProto,
  [ServerTimestampTypeId]: ServerTimestampTypeId,
  toJSON() {
    return { _id: "ServerTimestamp" };
  },
};

/** @internal */
export const serverTimestamp: FieldValue.ServerTimestamp = Object.create(
  ServerTimestampProto,
) as FieldValue.ServerTimestamp;

/** @internal */
export const isServerTimestamp = (u: unknown): u is FieldValue.ServerTimestamp =>
  Predicate.hasProperty(u, ServerTimestampTypeId);

/** @internal */
export const IncrementTypeId = "~@visiolab/effect-firebase/firestore/FieldValue/Increment";

/** @internal */
export const isIncrement = (u: unknown): u is FieldValue.Increment =>
  Predicate.hasProperty(u, IncrementTypeId);

const IncrementProto: Omit<FieldValue.Increment, "by"> = {
  ...Inspectable.BaseProto,
  [IncrementTypeId]: IncrementTypeId,
  toJSON(this: FieldValue.Increment) {
    return { _id: "Increment", by: this.by };
  },
  [Equal.symbol](this: FieldValue.Increment, that: unknown): boolean {
    return isIncrement(that) && this.by === that.by;
  },
  [Hash.symbol](this: FieldValue.Increment): number {
    return Hash.combine(Hash.string(IncrementTypeId), Hash.number(this.by));
  },
};

/** @internal */
export const increment = (by: number): FieldValue.Increment => {
  if (!Number.isFinite(by)) {
    throw new Error(`Invalid Firestore increment: by must be a finite number, got ${by}`);
  }
  return Object.assign(Object.create(IncrementProto) as typeof IncrementProto, { by });
};

/** @internal */
export const decrement = (by: number): FieldValue.Increment => increment(-by);

/** @internal */
export const DeleteFieldTypeId = "~@visiolab/effect-firebase/firestore/FieldValue/DeleteField";

const DeleteFieldProto: FieldValue.DeleteField = {
  ...Inspectable.BaseProto,
  [DeleteFieldTypeId]: DeleteFieldTypeId,
  toJSON() {
    return { _id: "DeleteField" };
  },
};

/** @internal */
export const deleteField: FieldValue.DeleteField = Object.create(
  DeleteFieldProto,
) as FieldValue.DeleteField;

/** @internal */
export const isDeleteField = (u: unknown): u is FieldValue.DeleteField =>
  Predicate.hasProperty(u, DeleteFieldTypeId);

/** @internal */
export const ArrayUnionTypeId = "~@visiolab/effect-firebase/firestore/FieldValue/ArrayUnion";

const ArrayUnionProto: Omit<FieldValue.ArrayUnion<unknown>, "elements"> = {
  ...Inspectable.BaseProto,
  [ArrayUnionTypeId]: ArrayUnionTypeId,
  toJSON(this: FieldValue.ArrayUnion<unknown>) {
    return {
      _id: "ArrayUnion",
      elements: this.elements.map((element) => Inspectable.toJson(element)),
    };
  },
};

/** @internal */
export const isArrayUnion = (u: unknown): u is FieldValue.ArrayUnion<unknown> =>
  Predicate.hasProperty(u, ArrayUnionTypeId);

/** @internal */
export const arrayUnion = <A>(...elements: ReadonlyArray<A>): FieldValue.ArrayUnion<A> =>
  Object.assign(Object.create(ArrayUnionProto) as typeof ArrayUnionProto, { elements });

/** @internal */
export const ArrayRemoveTypeId = "~@visiolab/effect-firebase/firestore/FieldValue/ArrayRemove";

const ArrayRemoveProto: Omit<FieldValue.ArrayRemove<unknown>, "elements"> = {
  ...Inspectable.BaseProto,
  [ArrayRemoveTypeId]: ArrayRemoveTypeId,
  toJSON(this: FieldValue.ArrayRemove<unknown>) {
    return {
      _id: "ArrayRemove",
      elements: this.elements.map((element) => Inspectable.toJson(element)),
    };
  },
};

/** @internal */
export const isArrayRemove = (u: unknown): u is FieldValue.ArrayRemove<unknown> =>
  Predicate.hasProperty(u, ArrayRemoveTypeId);

/** @internal */
export const arrayRemove = <A>(...elements: ReadonlyArray<A>): FieldValue.ArrayRemove<A> =>
  Object.assign(Object.create(ArrayRemoveProto) as typeof ArrayRemoveProto, { elements });
