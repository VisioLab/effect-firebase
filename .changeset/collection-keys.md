---
"@visiolab/effect-firebase": minor
---

A model can hold a typed `FirestoreSchema.DocumentReference` into its own collection, into a subcollection of it, or into a collection whose model references it back. Name the target with a `Collection.Key` (`interface UsersKey extends Collection.Key<typeof Users> {}`) and write the field as `Schema.suspend((): FirestoreSchema.DocumentReference<UsersKey> => FirestoreSchema.DocumentReference(Users))`. The reference reads back as `Collection.DocumentReference<typeof Users>`. Fields that close no cycle are unchanged.
