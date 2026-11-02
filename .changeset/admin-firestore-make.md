---
"@visiolab/effect-firebase-admin": patch
---

Admin Firestore is built through core's `Firestore.make`, with `Firestore.transactionFromCallback` and `Firestore.streamFromListener` for transactions and listening. The package keeps only opening the database, its hooks over the Admin SDK, and the Admin Transaction's read of many documents. Behaviour is unchanged, except that each span now also covers encoding and decoding.
