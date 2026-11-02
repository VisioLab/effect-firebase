---
"@visiolab/effect-firebase": minor
---

`DocumentSnapshot.make`, `DocumentSnapshot.existing`, `DocumentSnapshot.missing` and `QuerySnapshot.make` take an optional `extra`: an SDK passes what it knows about a read beyond the portable snapshot, and each of its fields is put on the snapshot and shown when it prints. Snapshots built without one are unchanged.
