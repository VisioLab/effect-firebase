---
"@visiolab/effect-firebase": minor
---

Build a `Firestore` for any backend with `Firestore.make`. A backend supplies Effect-native hooks that read and write Firestore Values by document path, and core does the rest: models, snapshots, Collection Groups, spans and transactions. `Firestore.transactionFromCallback` and `Firestore.streamFromListener` wrap an SDK that runs transactions as callbacks or listens through callbacks. The Admin and client packages are now built this way.

What `make` returns is typed from its hooks, as a `Firestore.With<ReadOptions, ListenOptions, Extra, TransactionServices>`. The options a backend's reads take, what its snapshots carry beyond the portable ones, and the services a transaction body can ask for all stay in the type, and a backend's own service extends `Firestore.With`. What `make` returns is always a portable `Firestore` too, so it can be provided as one. The portable `Firestore` and `Transaction` now carry a type id, so a backend's own service and transaction types, which extend `Firestore.With` and the new `Firestore.TransactionBase`, stay apart from them in an effect's requirements. Everything `make` takes is `@stability unstable`.
