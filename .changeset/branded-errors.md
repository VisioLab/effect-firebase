---
"@visiolab/effect-firebase": patch
"@visiolab/effect-firebase-admin": patch
"@visiolab/effect-firebase-client": patch
---

Brand the error classes (`FirestoreError`, `UndefinedCollectionError`, `AppError`,
`AuthError`), so TypeScript no longer accepts a plain object of the same shape
where one is expected. Construct them with `new` as before.
