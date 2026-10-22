---
"@visiolab/effect-firebase-client": minor
---

Every snapshot read through `ClientFirestore` carries its Snapshot Metadata:
`metadata.fromCache` says whether it was served from the local cache, and
`metadata.hasPendingWrites` whether it reflects writes the server has not
acknowledged yet.

The new `firestore/ClientDocumentSnapshot` module holds `Existing` and
`Missing`, which extend the portable variants with `metadata`, and the new
`firestore/ClientQuerySnapshot` module holds `ClientQuerySnapshot`, which
extends the portable `QuerySnapshot` with the metadata of the read as a whole -
the only place an empty result says where it came from. `ClientFirestore`'s
`getDoc`, `getDocs`, `streamDoc` and `streamDocs` return or emit these, and
stay assignable to the portable `Firestore`. Reads inside a transaction keep
handing back the portable snapshots.
