---
"@visiolab/effect-firebase": minor
---

Add `FirestoreModel.Record(key, value)`, a map field an update writes key by key. It is read and created as `Schema.Record(key, value)`, and an update patch writes each key at its own path in the value's update form: `{ votes: { pizza: FieldValue.increment(1) } }` becomes `{ "votes.pizza": <increment> }`, and the same goes for `arrayUnion`, `serverTimestamp` and nested groups and Records.

Where the key is a string, any key may be missing, so each one also takes `FieldValue.deleteField`. A group or Record held at a key is replaced with `Patch.replace` or removed, and is only patched by `updateUnchecked`, the same as an `Optional` group. Where the key is a union of literals, the Record holds every key and is updated like a group with one field per key. A whole Record takes `Patch.replace`, and an `Optional` Record also takes `deleteField`. A key that is empty or contains `.` fails the update when it is encoded.

`FirestoreModel` also exports `OptionalRecord`, the type `Optional` returns for a Record, and `Value`, the union of everything a field can be declared as, which `Optional` and `Record` both accept.
