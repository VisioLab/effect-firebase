---
"@visiolab/effect-firebase-client": minor
---

`ClientFirestore`'s `streamDoc` and `streamDocs` take optional
`ListenOptions`, named as in the client SDK's listen options.
`includeMetadataChanges: true` also emits when only the Snapshot Metadata
changes, such as when the server acknowledges a pending write, and
`source: "cache"` listens to the local cache alone, never reaching the server.
Without options, streams behave as before. The portable `Firestore` streams take
no options, since the Admin SDK's listeners have none.
