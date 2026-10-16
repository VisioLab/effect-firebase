---
"@visiolab/effect-firebase": minor
---

Let an update reach into a nested map.

A `FirestoreModel.Class`'s `update` now takes a nested partial: every group -
a `FirestoreModel.Struct` or a class - is a partial of its own, and each field
it carries is written at its path rather than the group being written whole.

```ts
Place.update.make({ address: { city: "Berlin", nickname: FieldValue.deleteField } });
// encodes to { "address.city": "Berlin", "address.nickname": <delete> }
```

That leaves the rest of the map as it is, and lets every sentinel sit at any
depth - including `deleteField`, which Firestore refused inside a map written
whole. A field declared with any other schema, a plain `Schema.Struct`
included, is still written whole.

`FirestoreModel.Optional` now takes a group as well. The map is an optional
key where it is read and created, and where it is updated it takes a patch as
before or `FieldValue.deleteField` to remove it whole.

```ts
billing: FirestoreModel.Optional(Address);
Place.update.make({ billing: FieldValue.deleteField });
```

`update` is now a transformation from the patch onto its paths rather than a
struct. The patch it takes is `update.to`, and the paths it writes are
`update.from`, whose fields - and the encoded type - name every path, such as
`"address.city"`. Decoding it fails, since a document is never read in that
shape. A field name holding a `.` is refused when the class is defined, since a
path would read it as two.

`FirestoreSchema.DeleteFieldOr` tries the sentinel before the schema it is
handed, so a schema that takes any object no longer swallows the removal.
