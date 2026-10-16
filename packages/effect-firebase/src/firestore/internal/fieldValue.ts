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
