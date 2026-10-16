---
"@visiolab/effect-firebase": minor
---

`FirestoreModel` updates reach into nested groups: `update` takes a nested
partial and writes each field at its path (`{ address: { city } }` →
`{ "address.city": city }`). `Optional` now accepts a group, which an update can
remove with `FieldValue.deleteField`.

Breaking: `update` is now a transformation, not a struct. Use `update.to` for
the patch and `update.from` for the paths.
