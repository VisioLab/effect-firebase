import type { Inspectable } from "effect";
import type * as ClientDocumentSnapshot from "../ClientDocumentSnapshot.ts";

/**
 * A prototype for the client's own snapshots, built on top of the portable
 * one `base` was made with, so that it keeps the portable snapshot's type id,
 * tag, guards and lazily decoded `data`, and only adds its metadata to how it
 * prints.
 *
 * Built once per portable prototype rather than once per snapshot.
 */
const protos = new WeakMap<object, object>();

const protoOf = (base: object): object => {
  const parent = Object.getPrototypeOf(base) as Inspectable.Inspectable;
  let proto = protos.get(parent);
  if (proto === undefined) {
    proto = Object.create(parent, {
      toJSON: {
        value(this: { readonly metadata: ClientDocumentSnapshot.SnapshotMetadata }) {
          return { ...(parent.toJSON.call(this) as object), metadata: { ...this.metadata } };
        },
      },
    }) as object;
    protos.set(parent, proto);
  }
  return proto;
};

/**
 * `base`, a portable snapshot, with the {@link ClientDocumentSnapshot.SnapshotMetadata}
 * the client SDK reported for it.
 *
 * @internal
 */
export const withMetadata = <A extends object>(
  base: A,
  metadata: ClientDocumentSnapshot.SnapshotMetadata,
): A & { readonly metadata: ClientDocumentSnapshot.SnapshotMetadata } =>
  Object.assign(Object.create(protoOf(base)) as A, base, {
    metadata: { fromCache: metadata.fromCache, hasPendingWrites: metadata.hasPendingWrites },
  });
