---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-admin": minor
"@visiolab/effect-firebase-client": minor
---

Move `App` and `Auth` into their own lowercase entries, the way `firestore` is laid out, and drop the package roots, which re-exported only them. Import `App` from `@visiolab/effect-firebase-admin/app` or `@visiolab/effect-firebase-client/app`, `Auth` from `@visiolab/effect-firebase-admin/auth`, and `defaultAppName` from `@visiolab/effect-firebase/app/App` (or `App` from `@visiolab/effect-firebase/app`). The bare package imports and the `/App` and `/Auth` subpaths are gone. The service keys follow the new paths too: `@visiolab/effect-firebase-admin/app/App`, `@visiolab/effect-firebase-client/app/App` and `@visiolab/effect-firebase-admin/auth/Auth`.
