---
"@visiolab/effect-firebase-client": minor
---

Write documents from the UI with mutation atoms on `FirestoreAtom.Service`: `Db.setDoc(ref)` and `Db.updateDoc(ref)` per document, and `Db.addDoc(collectionRef)` per collection. Set them with `{ data }`, and `updateDoc` with `{ data, mode: "unchecked" }` for a patch only the unchecked schema takes. Each atom runs its writes side by side: it stays `waiting` until the server has acknowledged every write in flight, which lasts while the client is offline, and fails when any of them fails, with exactly the `ClientFirestore` call's `FirestoreError | SchemaError`. `addDoc` succeeds with the new `DocumentReference`, the oldest one's while several adds are in flight. Writes to different documents never share status. A ref whose model needs Encoding Services the layer does not provide is a type error.
