---
"@visiolab/effect-firebase-client": patch
---

Client snapshots attach their `metadata` through the core snapshot constructors' `extra` instead of rebuilding core's snapshot prototypes. They carry and print `metadata` as before.
