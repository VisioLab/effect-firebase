---
"@visiolab/effect-firebase": minor
---

`DocumentSnapshot.make`, `DocumentSnapshot.existing`, `DocumentSnapshot.missing` and `QuerySnapshot.make` take an optional `extra`: an SDK passes what it knows about a read beyond the portable snapshot, and each of its fields is put on the snapshot and shown when it prints. Snapshots built without one are unchanged.

`QuerySnapshot` takes the extra its documents carry as a second type argument, `QuerySnapshot<C, Extra>`, whose `docs` are each `Existing<C> & Extra`. `QuerySnapshot<C>` means what it did. `QuerySnapshot.make` infers it from the documents it is given, as `QuerySnapshot.ExtraOf` of them, so a query snapshot built from snapshots with an extra keeps it in its type.
