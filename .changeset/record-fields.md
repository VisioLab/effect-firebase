---
"@visiolab/effect-firebase": minor
---

Add `FirestoreModel.Record(key, value)`, a map field an update writes key by key. It is read and created as `Schema.Record(key, value)`. An update writes each key at its own path, in the value's update form: `{ votes: { pizza: FieldValue.increment(1) } }` becomes `{ "votes.pizza": <increment> }`. `arrayUnion`, `serverTimestamp`, nested structs and nested Records work the same way.

With string keys, any key may be missing, so each key also takes `FieldValue.deleteField`. A struct or Record held at a key is written whole with `Patch.replace` or removed, and only `updateUnchecked` patches it, as with an `Optional` struct. With a union of literals as keys, the Record holds every key and is updated like a struct with one field per key. A whole Record takes `Patch.replace`, and an `Optional` Record also takes `deleteField`.

Paths use each key's encoded form. The key schema encodes them as part of the update, so any service it needs becomes a requirement of the update. A key that is empty or contains `.`, before or after encoding, fails the update. A literal key written that way throws as soon as the Record is declared.

`FirestoreModel` also exports `OptionalRecord`, the type `Optional` returns for a Record, and `Value`, the union of everything a field can be declared as, which `Optional` and `Record` accept.
