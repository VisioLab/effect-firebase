import type * as ClientDocumentSnapshot from "../ClientDocumentSnapshot.ts";

/**
 * The extra a client snapshot is built with: its metadata, copied out of the
 * SDK's own object so that the snapshot holds, and prints, only these two
 * fields.
 *
 * @internal
 */
export const extraOf = (
  metadata: ClientDocumentSnapshot.SnapshotMetadata,
): { readonly metadata: ClientDocumentSnapshot.SnapshotMetadata } => ({
  metadata: { fromCache: metadata.fromCache, hasPendingWrites: metadata.hasPendingWrites },
});
