---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
"@visiolab/effect-firebase-client": minor
---

Read every document of a collection across all of its parents with a
Collection Group. The new `firestore/CollectionGroup` module defines one from
the `Collection` definitions it stands for, all sharing one collection id:
`CollectionGroup.make(UserPosts)`, or `CollectionGroup.make(UserPosts,
OrgPosts)` for several. It also offers `isCollectionGroup`, `Members` and
`Valid`. The type checker refuses a group whose collections do not share the
collection id of the first, or that has two collections at the same path, and
`make` throws on those and on an empty group.

`Firestore.getDocs` and `Firestore.streamDocs` take a group as well as a
collection reference, on the Admin and client SDKs alike. Each document comes
back as a document of the one collection it lives in: its `DocumentReference`
typed by that collection, its ancestor ids filled in from its path, and its
data decoded through that collection's model. The snapshot's `docs` are a union
per collection, such as `Existing<UserPosts> | Existing<OrgPosts>`, so
`docs.filter(OrgPosts.contains)` narrows the id, ancestors, reference and data
together. `QuerySnapshot` and `ClientQuerySnapshot` distribute their `docs`
this way through the new `QuerySnapshot.Existing` and
`ClientQuerySnapshot.Existing` types. A stream emits the whole group each time
a document in any of its collections changes.

A document under the collection id at a path the group does not define fails
the read, or the stream at the first snapshot holding it, with the new
`UndefinedCollectionError`, carrying its `path` and the `collectionId`. Reading
a collection still fails with `FirestoreError` alone. On the client SDK, group
reads and streams take the same read and listen options as collection ones, and
hand back `ClientQuerySnapshot`s with their metadata.
