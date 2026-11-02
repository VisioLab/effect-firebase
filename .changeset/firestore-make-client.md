---
"@visiolab/effect-firebase-client": patch
---

Client Firestore is now built through core's `Firestore.make`, with its transactions run through `Firestore.transactionFromCallback` and its streams through `Firestore.streamFromListener`. Its own copies of the transaction and listener bridges, Collection Group matching, snapshot assembly and write encoding are gone. Read source and listen options still apply, and snapshots still carry Snapshot Metadata. Error messages, codes and causes are unchanged.
