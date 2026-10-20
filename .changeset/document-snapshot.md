---
"@visiolab/effect-firebase": minor
---

Add `firestore/DocumentSnapshot`, what a read hands back: the typed `ref` a
document was read at, its `id`, and either the `raw` data the SDK read
(`Existing`) or nothing (`Missing`). `data` decodes `raw` through the collection's
schema only when it is run, so telling whether a document is there, or which one
it is, never touches the schema. `make(ref, raw)` builds one from what an SDK's
`snapshot.data()` returns.
