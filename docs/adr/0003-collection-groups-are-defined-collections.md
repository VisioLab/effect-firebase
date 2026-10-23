# Collection groups are made of defined collections

Firestore's collection group is every collection with a given collection id, wherever it sits, but this library brands a document's id with its collection's whole path so that `posts` under `users` and `posts` under `orgs` never mix. A `CollectionGroup` is therefore built from the `Collection` definitions it stands for, all sharing one last segment, rather than from a bare collection id. Each document a group read finds is matched by its path back to the one member it lives in, and comes back typed, addressed and decoded as that member's, so a group of `UserPosts` and `OrgPosts` reads as `Existing<UserPosts> | Existing<OrgPosts>`, told apart with `UserPosts.contains`.

A document under the collection id that no member defines, such as one under `teams/{id}/posts`, fails the read with an `UndefinedCollectionError` naming its path. It is a typed error rather than a defect, because what is in the database decides whether it happens and correct code cannot rule it out, and a caller who treats it as a bug can `orDie` it. Only group reads can raise it: `getDocs` and `streamDocs` are overloaded so that reading one collection still fails with `FirestoreError` alone.

## Considered Options

- **A collection id and one model** (`CollectionGroup.make("posts", Post)`). Rejected because the documents it reads belong to no defined collection, which brings back the untyped reference the path-branded ids exist to rule out.
- **Skipping documents no member defines.** Rejected because it hides data the model claims not to exist. If lenient reads are ever wanted, they belong in an explicit option rather than the default.
- **Separate `getGroupDocs` and `streamGroupDocs` methods**, which would have kept the error type unconditional. Rejected in favour of the overloads, since both methods are reads of many and group reads should get what an SDK adds to them, such as client snapshot metadata, without a parallel variant.
