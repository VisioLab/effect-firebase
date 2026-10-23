---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
"@visiolab/effect-firebase-client": minor
---

`Firestore.streamDocs` listens to a Collection Group as well as to a collection
reference, on the Admin and client SDKs alike. It emits the whole group each
time a document under any parent changes, each document typed and decoded as
`getDocs` hands it back, and fails with `UndefinedCollectionError` at the first
snapshot holding a document at a path the group does not define. Streaming a
collection still fails with `FirestoreError` alone. On the client SDK, a group
stream takes the same listen options and emits `ClientQuerySnapshot`s with
their metadata.
