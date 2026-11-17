---
"@visiolab/effect-firebase": minor
---

Unit test Portable code without the emulator by providing `Firestore.layerMemory`, the In-memory Firestore. It keeps documents in the running process, encodes and decodes through your models as the SDKs do, resolves sentinels at commit, serves Collection Groups, keeps listeners live and runs optimistic transactions. Each build of the layer starts empty. It also provides `Firestore.MemoryDriver`, to seed and inspect raw documents, and `serverTimestamp` and `addDoc` ids follow `TestClock` and a seeded `Random`. `Firestore.makeMemory` builds the same without a layer.
