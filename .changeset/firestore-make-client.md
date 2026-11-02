---
"@visiolab/effect-firebase-client": minor
---

`ClientFirestore` is now built on core's `Firestore.make`, so it requires `@visiolab/effect-firebase` 0.3.0. Its methods, options and types are unchanged: read source and listen options still apply, and snapshots still carry and print Snapshot Metadata. One difference you may notice is that each `Firestore.*` span now covers encoding and decoding as well as the SDK call.
