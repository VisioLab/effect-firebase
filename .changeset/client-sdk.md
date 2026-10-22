---
"@visiolab/effect-firebase-client": minor
---

Add the Firebase client SDK implementation: `App.layer` initializes a client
SDK app for the lifetime of the layer, and `firestore/Firestore.layer` provides
the shared `Firestore` service over it, with `layerWithEncoder` providing its
`FirestoreEncoder` as well. The layer takes the emulator to connect to and the
local cache to keep, and reads documents with pending server timestamps
estimated.
