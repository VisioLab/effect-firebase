---
"@visiolab/effect-firebase": minor
---

Rename the Firestore entry to `firestore`, and stop re-exporting it from the
root. `Collection` is now reached through `@visiolab/effect-firebase/firestore`
or `@visiolab/effect-firebase/firestore/Collection` rather than through the
package root.
