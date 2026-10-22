---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
"@visiolab/effect-firebase-client": minor
---

The sentinel schemas, `FirestoreSchema.ServerTimestamp`/`ServerTimestampOr`,
`Increment`/`IncrementOr`, `DeleteField`/`DeleteFieldOr` and
`ArrayUnion`/`ArrayRemove`/`ArrayOr`, are now plain schemas of the portable
`FieldValue` sentinels. They ask for no `FirestoreEncoder`, so a model's
`create`, `update` and `updateUnchecked` schemas have `EncodingServices` of
`never`, whatever sentinels they write. `AdminFirestore` and `ClientFirestore`
turn the portable sentinels into their SDK's own on the way out.

Encoding one of them now gives the portable sentinel rather than the SDK's:

```ts
// Before: needed an encoder layer, and gave the SDK's own sentinel
Schema.encodeEffect(FirestoreSchema.Increment)(FieldValue.increment(1));

// After: no layer, and gives the portable sentinel; map it to the SDK's for a raw write
const encode = Schema.encodeSync(FirestoreValue.toCodecFirestore(FirestoreSchema.Increment));
AdminFirestoreValue.toAdmin(encode(FieldValue.increment(1)), firestore);
```

`ArrayUnion` and `ArrayRemove` still encode their elements through the item
schema, and `toCodecFirestore` then stores each element as Firestore stores
`item`, so `FirestoreModel.Array(Schema.DateTimeUtc)` grows and shrinks its
array with real Firestore timestamps.

Decoding a sentinel schema directly no longer always fails: it accepts the
portable sentinel and refuses anything else, such as an SDK's own sentinel.
