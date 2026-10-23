---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
"@visiolab/effect-firebase-client": minor
---

A Collection Group reads every document of a subcollection across all of its
parents. The new `firestore/CollectionGroup` module defines one from the
`Collection` it stands for with `CollectionGroup.make(UserPosts)`, and offers
`isCollectionGroup`, `Members` and `fromPath`. `make` throws on an empty group,
on collections that do not share their collection id, and on a collection listed
twice.

`Firestore.getDocs` takes a group as well as a collection reference, on the
Admin and client SDKs alike. Each document comes back with a `DocumentReference`
typed by its collection, its ancestor ids filled in from its path, and its data
decoded through its model. A document under the collection id at a path the
group does not define fails the read with the new `UndefinedCollectionError`,
carrying its `path` and the `collectionId`. Reading a collection still fails
with `FirestoreError` alone. On the client SDK, a group read takes the same
read options and hands back a `ClientQuerySnapshot` with its metadata.
