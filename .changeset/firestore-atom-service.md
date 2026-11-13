---
"@visiolab/effect-firebase-client": minor
---

Render Firestore documents live from `effect/reactivity` atoms with the new `FirestoreAtom` module, at `./firestore/FirestoreAtom` and in the `./firestore` barrel. Declare one service class for the app with `class Db extends FirestoreAtom.Service<Db>()("app/Db", { layer: FirestoreLive }) {}`. `Db.doc(ref)` holds the document's latest Decoded Snapshot: `Initial` until the first snapshot, then `Success` with `Existing` or `Missing`, showing local writes at once through `hasPendingWrites`. It fails with exactly `FirestoreError | SchemaError`. A snapshot that does not decode fails the atom but keeps the listener, so the next valid snapshot recovers it. A dropped listen, such as on `permission-denied`, is not retried until `registry.refresh`. `Db.runtime` runs your own atoms and effects, where `yield* Db` gives Client Firestore. A ref whose model needs Decoding Services the layer does not provide is a type error.
