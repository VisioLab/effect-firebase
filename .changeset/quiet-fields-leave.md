---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
---

Let an update remove a field.

`firestore/FieldValue` gains `deleteField`, with `DeleteField` and
`DeleteFieldOr` to write it in `firestore/FirestoreSchema`.
`firestore/FirestoreModel` gains `Optional`: an optional key where a field is
read and created, and removable where it is updated. It takes a schema or
another field.

```ts
nickname: FirestoreModel.Optional(Schema.String);
lastSeenAt: FirestoreModel.Optional(FirestoreModel.Timestamp(FirestoreSchema.Timestamp));
```
