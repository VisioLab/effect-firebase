---
"@visiolab/effect-firebase": minor
---

`FirestoreModel` updates only take patches that are safe for any stored document. A document may go without an `Optional` struct, and a patch into one that is missing creates the struct holding only what the patch carried, so the document no longer reads. `update` now writes an `Optional` struct whole with the new `Patch.replace`, or removes it with `FieldValue.deleteField`, and never patches it.

The new `firestore/Patch` module says how a patch writes a struct: a plain object is written field by field at its paths, as before, and `Patch.replace(value)` writes the struct whole, as `set` would, constructor defaults filled in. It works on any struct, in either mode, unless the struct holds a field that `set` or an update leaves out (`Immutable`, or one only ever read), which replacing it would change or drop.

Breaking: a patch into an `Optional` struct is now a type error, and its encoding is rejected. Use `Patch.replace` to write the struct whole, or the new `updateUnchecked` where the struct is known to be there (an earlier read, a query, a transaction). `updateUnchecked` takes every patch `update` takes and writes it the same, plus patches into `Optional` structs. `UpdateFields`, `UpdatePaths` and `Update` take an `UpdateMode` (`"checked"` by default, or `"unchecked"`), and `UpdatePaths`' prefix moves to its third parameter. A struct's own path now takes the struct written whole where it may be replaced.
