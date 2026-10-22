---
"@visiolab/effect-firebase-client": minor
---

`ClientFirestore`'s `getDoc` and `getDocs` take optional `ReadOptions`, whose
`source` says where a one-off read is served from: `"default"` (what a read
does without options), `"server"` (fails when the server can't be reached) or
`"cache"` (the local cache alone).

Cache misses behave as they do in the SDK: a cached `getDoc` of a document the
cache has never seen fails with a `FirestoreError` coded `unavailable`, while
one the cache knows was deleted reads as `Missing`. A cached `getDocs` never
fails for a miss, and hands back whatever the cache holds, possibly nothing,
with `fromCache: true`. The portable `Firestore` is unchanged.
