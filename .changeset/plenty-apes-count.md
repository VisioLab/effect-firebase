---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
---

Add the Firestore increment sentinel.

`firestore/FieldValue` gains `increment` and `decrement`, which ask the server
to move a number by however far rather than to write one over it, so two clients
that each add one leave the field two higher. Firestore has the one sentinel for
both directions, so `decrement(2)` is `increment(-2)` and reads back as such.

`firestore/FirestoreSchema` gains the `Increment` codec that writes it, and
`IncrementOr`, which takes the schema a field is read through and hands back the
one it is written through. `firestore/FirestoreModel` gains `Number`, the field
built from the pair: read as that schema, written as it or as a move.

```ts
visits: FirestoreModel.Number(Schema.Int);
balance: FirestoreModel.Number(Schema.Finite);
```

What the number may be is the call site's to say, down to any check it cares to
put on it, and the writes hold it as closely as the read does.
