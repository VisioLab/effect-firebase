---
"@visiolab/effect-firebase": minor
---

Let a timestamp field say how the instant is held.

`FirestoreSchema.TimestampOrServer` becomes `ServerTimestampOr`, which takes the
schema a field is read through and hands back the one it is written through, and
`FirestoreModel.Timestamp` takes that schema too. This is what
`FirestoreModel.Number` already does for a number.

```ts
createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp);
seenAt: FirestoreModel.Timestamp(Schema.DateTimeUtc);
```

A field held as a `DateTime.Utc` no longer has to be declared variant by variant
to keep the server sentinel: the schema goes into the read as it stands and into
both writes beside the sentinel.

`FirestoreModel.Timestamp` was a field and is now a function, so a declaration
that named it bare has to hand it `FirestoreSchema.Timestamp` to read as before.
