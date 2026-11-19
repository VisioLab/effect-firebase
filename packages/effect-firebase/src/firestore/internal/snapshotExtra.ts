import { Inspectable } from "effect";

/**
 * Where a snapshot keeps the extra an SDK built it with, so that it can show
 * that extra when it prints without telling the extra's fields from its own.
 */
const ExtraKey = "~@visiolab/effect-firebase/firestore/SnapshotExtra";

/** @internal */
export interface WithExtra {
  readonly [ExtraKey]?: object;
}

/**
 * `self` with the fields of `extra` on it, remembered as its extra so that
 * {@link extraToJson} shows them.
 *
 * The extra itself is held on a key that is not enumerable, so that it does
 * not show up twice: its fields are already on the snapshot.
 *
 * @internal
 */
export const attach = <A extends object>(self: A, extra: object | undefined): A => {
  if (extra === undefined) {
    return self;
  }
  Object.defineProperty(self, ExtraKey, { value: extra });
  return Object.assign(self, extra);
};

/**
 * The extra `self` was built with, or `undefined` when it was built without
 * one, so that a snapshot derived from it, such as its decoded form, can carry
 * the same.
 *
 * @internal
 */
export const extraOf = (self: object): object | undefined => (self as WithExtra)[ExtraKey];

/**
 * How the extra `self` was built with prints: each of its fields as it would
 * print on its own, or nothing when it was built without one.
 *
 * @internal
 */
export const extraToJson = (self: WithExtra): Record<string, unknown> => {
  const extra = self[ExtraKey];
  if (extra === undefined) {
    return {};
  }
  const json: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    json[key] = Inspectable.toJson(value);
  }
  return json;
};
