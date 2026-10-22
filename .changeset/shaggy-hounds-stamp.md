---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
---

Add Firestore document models.

`firestore/FirestoreModel` derives the shapes a document is read and written in
from one field declaration, over the `VariantSchema` that `effect/schema`'s
`Model` is built on. The class is the `read` variant, which is what a snapshot
decodes into, and `create` and `update` hang off it - the latter with every
field it carries made optional, since an update writes the fields that change
rather than a whole document.

`Immutable` keeps a field out of the writes that must not carry it, and
`Timestamp` is a field read as a timestamp and written either as one or as the
sentinel the server resolves.

`firestore/FieldValue` holds the sentinels that only exist on the way to the
database, which is `serverTimestamp` for now. `firestore/FirestoreSchema` gains
the `ServerTimestamp` codec that writes it, and `TimestampOrServer` for a field
that takes either.
