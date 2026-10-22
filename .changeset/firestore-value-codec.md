---
"@visiolab/effect-firebase": minor
---

Add `FirestoreValue`, which makes Firestore a canonical format the way JSON is
one. `FirestoreValue.toCodecFirestore(schema)` derives a codec from any plain
schema to Firestore Values, needing no service and no SDK:

```ts
import { FirestoreValue } from "@visiolab/effect-firebase/firestore";
import { Schema } from "effect";

const User = Schema.Struct({ name: Schema.String, joinedAt: Schema.DateTimeUtc });

// { name: "Ada", joinedAt: Timestamp(...) }
const encoded = Schema.encodeSync(FirestoreValue.toCodecFirestore(User))(user);
```

`Schema.Date` and `Schema.DateTimeUtc` are written as a portable `Timestamp`
(and read back to the millisecond), `Schema.Uint8Array` as bytes, and any
other declaration through its `toCodecFirestore`, `toCodecJson` or `toCodec`
annotation, so `Option`, `Duration`, `Schema.Class` and the like need no extra
work. A `bigint` is written as a string, as in JSON. A value Firestore can't
store fails with a schema error at its path. Unlike `Schema.toCodecJson`,
`Schema.Any` is no escape hatch: like `Schema.Unknown`, it takes Firestore
Values only.

`FirestoreValue.FirestoreValue` is the union of values Firestore stores, with
`FirestoreValue.isFirestoreValue` as its guard. `FirestoreSchema.Timestamp`
also gains a `toCodecJson` form, `{ seconds, nanoseconds }`, so the same model
can be sent over HTTP.

Firestore stores a document reference as the document's path alone, so the
union holds the new `DocumentPath` (built with `DocumentPath.make(path)`, equal
by path) rather than a typed `Collection.DocumentReference`.
`FirestoreSchema.DocumentReference(collection)` writes a typed reference as its
`DocumentPath` and reads one back into `collection`, failing on a path outside
it. A typed reference held under `Schema.Unknown` is written as its path too,
and read back as a `DocumentPath`. `FirestoreSchema.DocumentPath` is the schema
for a field that holds the path itself.

The `effect` peer range is pinned to `4.0.4`, since the derivation builds on
Effect internals a patch release may change.
