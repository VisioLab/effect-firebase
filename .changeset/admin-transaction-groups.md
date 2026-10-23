---
"@visiolab/effect-firebase-admin": minor
---

`AdminTransaction.getDocs` reads a Collection Group as well as a collection,
with the same overloads as `Firestore.getDocs`. A group read inside a
transaction can fail with `UndefinedCollectionError`, which fails the body and
rolls the transaction back without retrying it. The portable `Transaction`
stays document-only.
