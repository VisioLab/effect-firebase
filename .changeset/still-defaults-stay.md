---
"@visiolab/effect-firebase": patch
---

Keep constructor defaults out of a `FirestoreModel` update. A field declared with `Schema.withConstructorDefault` used to have its default filled in by `update.make` whenever the key was left out, so the update overwrote a field nobody touched. Defaults now apply only where a document is created, at every depth.
