---
"@visiolab/effect-firebase": minor
---

`FirestoreModel` updates only take patches that are safe for any stored document. A document may go without an `Optional` group, and a patch into one that is missing creates the group holding only what the patch carried, so the document no longer reads. `update` now takes a patch into an `Optional` group only where it carries every field the group cannot go without, at any depth, or the removal with `FieldValue.deleteField`. Patches into groups every document holds stay partial.

Breaking: a partial patch into an `Optional` group is now a type error, and its encoding is rejected. Where the group is known to be there (an earlier read, a query, a transaction), use the new `updateUnchecked`, which takes the patches `update` took before. `UpdateFields`, `UpdatePaths` and `Update` take an `UpdateMode` (`"checked"` by default, or `"unchecked"`), and `UpdatePaths`' prefix moves to its third parameter.
