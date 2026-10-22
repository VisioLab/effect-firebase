---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
---

Add `Firestore.streamDoc` and `Firestore.streamDocs`, which listen to a
document or a collection and emit a snapshot - what `getDoc` or `getDocs` would
hand back - each time it changes. Running the stream attaches a listener of its
own, which is detached once the stream stops; a reader that falls behind sees
the latest snapshot rather than every one in between, and the stream fails with
a `FirestoreError` when Firestore drops the listener. The Admin SDK implements
them in `firestore/Firestore.layer`.
