---
"@visiolab/effect-firebase": minor
---

Every `Collection` definition has a `contains` guard that tells whether a
`DocumentReference`, or an `Existing` or `Missing` snapshot, belongs to that
collection, and narrows it to that collection's id, ancestors, reference and
data. Two definitions are the same collection only when they are the same
object, so one built separately with the same path is another collection. The
guard is bound, so `snapshot.docs.filter(Posts.contains)` works and narrows the
element type.
