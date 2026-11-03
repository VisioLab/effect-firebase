---
"@visiolab/effect-firebase": minor
---

Build a `Firestore` for any backend with `Firestore.make`. A backend supplies Effect-native hooks that read and write Firestore Values by document path, and core does the rest: models, snapshots, Collection Groups, spans and transactions. `Firestore.transactionFromCallback` and `Firestore.streamFromListener` wrap an SDK that runs transactions as callbacks or listens through callbacks. The Admin and client packages are now built this way.

What `make` returns is typed from its hooks, as a `Firestore.With<ReadOptions, ListenOptions, Extra, TransactionServices>`. The options a backend's reads take, what its snapshots carry beyond the portable ones, and the services a transaction body can ask for all stay in the type, and a backend's own service extends `Firestore.With`. The portable `Firestore` is `Firestore.With` with nothing added and is unchanged for portable code. Everything `make` takes is `@stability unstable`.
