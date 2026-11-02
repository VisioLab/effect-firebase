---
"@visiolab/effect-firebase": minor
---

`Firestore.make` builds a portable `Firestore` from Effect-native hooks that read and write Firestore Values by document path and `CollectionSelector`, so a backend supplies only those hooks. Core encodes writes through the model, decodes reads into snapshots with any extra a hook hands back, matches Collection Group documents to their collections, names spans, and provides the `Transaction` built from a hook's `TransactionOperations` to the body, with a `transactionContext` for further tags. `MakeOptions`, `CollectionSelector`, `TransactionOperations` and the types they read and write are public and unstable.
