---
"@visiolab/effect-firebase-client": minor
---

`Db.doc(ref, options)` takes one flat `FirestoreAtom.ReadAtomOptions` object: the listen options `source` and `includeMetadataChanges`, and `timeToLive`. A finite `timeToLive` keeps the atom and its listener alive that long after the last reader leaves, `Infinity` keeps it alive for as long as the registry lives, and without it the registry's `defaultIdleTTL` applies. Equal refs with equal options give the same atom, with one SDK listener and one decode: leaving the options out, passing `{}` and passing the defaults all count as equal, as do refs built separately for the same path and `"1 minute"` and `Duration.minutes(1)`.
