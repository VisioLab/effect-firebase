---
"@visiolab/effect-firebase": minor
"@visiolab/effect-firebase-client": minor
---

A Collection Group can be made of several collections that share a collection
id, such as `CollectionGroup.make(UserPosts, OrgPosts)`. Each document a read
of it finds comes back as a document of the one collection it lives in, so the
snapshot's `docs` are `Existing<UserPosts> | Existing<OrgPosts>`, and
`docs.filter(OrgPosts.contains)` narrows the id, ancestors, reference and data
together. `QuerySnapshot` and `ClientQuerySnapshot` distribute their `docs` over
a union of collections this way, through the new `QuerySnapshot.Existing` and
`ClientQuerySnapshot.Existing` types. The type checker now refuses a group whose
collections do not share the collection id of the first, or that lists a
collection twice, as described by the new `CollectionGroup.Valid`.
