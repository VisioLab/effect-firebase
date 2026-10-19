---
"@visiolab/effect-firebase": minor
---

`FirestoreModel` updates only take patches that are safe for any stored document. A document may go without an `Optional` group, and a patch into one that is missing creates the group holding only what the patch carried, so the document no longer reads. `update` now writes an `Optional` group whole with the new `Patch.replace`, or removes it with `FieldValue.deleteField`, and never patches it.

The new `firestore/Patch` module says how a patch writes a group: a plain object is written field by field at its paths, as before, and `Patch.replace(value)` writes the group whole, as `set` would, constructor defaults filled in. It works on any group, in either mode, unless the group holds a field that `set` or an update leaves out (`Immutable`, or one only ever read), which replacing it would change or drop.

Breaking: a patch into an `Optional` group is now a type error, and its encoding is rejected. Use `Patch.replace` to write the group whole, or the new `updateUnchecked` where the group is known to be there (an earlier read, a query, a transaction). `updateUnchecked` takes every patch `update` takes and writes it the same, plus patches into `Optional` groups. `UpdateFields`, `UpdatePaths` and `Update` take an `UpdateMode` (`"checked"` by default, or `"unchecked"`), and `UpdatePaths`' prefix moves to its third parameter. A group's own path now takes the group written whole where it may be replaced.
