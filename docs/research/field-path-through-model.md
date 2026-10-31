# Resolving a field path through a model

Research for [#119](https://github.com/VisioLab/effect-firebase/issues/119), under the map [#117](https://github.com/VisioLab/effect-firebase/issues/117) "Queries in Firestore". It is fact-finding, not a design.

**Question.** With Effect 4.1's `Schema` and `SchemaAST`, as `FirestoreModel` and `toCodecFirestore` use them here, can a field path such as `author.name` be resolved through a model to that field's schema and its Firestore codec, so that a filter value is encoded exactly as the field is stored?

**Short answer.** Yes, for every path that runs through plain structure: classes, `FirestoreModel.Struct`, plain `Schema.Struct`, `FirestoreModel.Record` and unions, down to a leaf of any kind. The walk uses only the public `SchemaAST`. Encoding the filter value through `toCodecFirestore(leaf)` gives the same Firestore Value that encoding the whole document stores at that path. `resolve.ts` checks this case by case. The walk has to refuse four kinds of path:

- a path through a struct that was transformed as a whole, which includes `Schema.encodeKeys`;
- a path into a declaration other than a class;
- a path that indexes into an array;
- a model value with no stored form, such as `Option.none()` under `OptionFromOptionalKey`.

Union fields and union documents resolve to one leaf per member that holds the path. A single filter value is correct only where those members store it the same way. That is the condition the glossary's **Shared Field** already states. Separately, several of this repo's encodings do not keep Firestore's ordering or equality in step with the model's (see [Ordering and equality](#ordering-and-equality)).

Sources: the installed `effect@4.1.0` (`packages/effect-firebase/node_modules/effect/src`), this repo at `f4ba114`, and the Firestore docs. Paths below are relative to `packages/effect-firebase/src/firestore/` unless they say otherwise.

## Scripts

They sit in [`field-path-through-model/`](field-path-through-model/). Run them from the repo root with `vpx`:

- `vpx docs/research/field-path-through-model/explore.ts` prints the AST of a `FirestoreModel.Class` and of its `toCodecFirestore` codec.
- `vpx docs/research/field-path-through-model/resolve.ts` is a throwaway resolver of about 60 lines. For each path it compares the filter value it encodes with what encoding the whole document stores at that path.
- `vpx docs/research/field-path-through-model/encodings.ts` prints what each kind of schema is stored as, plus the timestamp round trip and the union collision cited below.
- `effect.ts` re-exports the package's own `effect`. pnpm installs `effect` only under `packages/effect-firebase`, so a script under `docs/` cannot import it directly. Re-exporting the same file gives the scripts the same module instance the package source uses.

## What the model looks like as an AST

`explore.ts` shows that the read schema of a `FirestoreModel.Class` is a `Declaration` with exactly one type parameter. That parameter is an `Objects` (the struct), and the declaration's encoding is one `Link` to that very same `Objects` node. `FirestoreModel.Struct` fields appear as nested plain `Objects`, `FirestoreModel.Optional` as a property whose `context.isOptional` is set, and `FirestoreModel.Array` as `Arrays`. A `FirestoreModel.Union` is a `Union` of the member classes.

The shape comes from Effect's class factory. `getClassSchemaFactory` builds `new SchemaAST.Declaration([from.ast], …)` and then `decodeTo(to, transformation)(from)` (`effect/src/Schema.ts:17487-17529`). The type parameter and the link target are therefore the same node, and the transformation only builds or unwraps the instance. A class's keys are its struct's keys. A class schema also exposes `.fields` publicly, which a resolver could use instead of the identity check that `resolve.ts` makes.

`toCodecFirestore` (`internal/firestoreValue.ts:134-196`) does not change keys or structure:

- `Objects` and `Arrays` are recursed with `schemaAST.recur`.
- A `Union` is recursed after `reorderUnion` moves string-encoded members first (`:117`).
- A declaration gets a link from `nativeLink`, `toCodecFirestore`, `toCodecJson` or `toCodec`, in that order (`:87-115`).

So the codec of a leaf, derived alone, matches the codec the document derives at that leaf. Derivation is memoized per AST node (`applyToSelfOrLastLinkEncodingIdempotent`), so deriving the leaf alone costs nothing extra. The one difference is that a property's constructor default is dropped (`withoutConstructorDefault`, `:184`), which does not matter for encoding a filter value.

Every part of the AST the walk reads is public in `dist/SchemaAST.d.ts`: `encoding`, `typeParameters`, `propertySignatures`, `indexSignatures`, `Suspend.thunk`, the `is*` guards, `toType` and `toEncoded`. Resolving a path needs none of the `@internal` helpers that ADR 0002 accepts for derivation.

## The resolver, and what it costs

`resolve(ast, path)` in `resolve.ts` takes one step per segment:

| Node                          | Step                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Declaration` that is a class | Into its struct (the type parameter that equals the link target).                                                                        |
| Any other `Declaration`       | Refuse. Its encoded keys are not known.                                                                                                  |
| `Objects` with no `encoding`  | The property signature named by the segment. Otherwise the first index signature whose parameter accepts the segment. Otherwise nothing. |
| `Objects` with an `encoding`  | Refuse. The struct is transformed as a whole.                                                                                            |
| `Union`                       | Resolve in every member and collect the leaves. A member without the path adds none.                                                     |
| `Arrays`                      | Refuse. A Firestore field path cannot index into an array.                                                                               |
| `Suspend`                     | Step into `thunk()`.                                                                                                                     |

It returns one leaf AST per member that can hold the path. A filter value is encoded with `Schema.encodeUnknownSync(toCodecFirestore(Schema.make(leaf)))`.

The cost is a small recursive function over public AST nodes plus one derived codec per leaf, which is memoized. It never touches `VariantSchema`, because the read variant is already a plain schema.

The update machinery is the alternative. `FirestoreModel` already resolves dotted paths for updates, but it walks `VariantSchema` fields (`nodeOf`, `internal/firestoreModel.ts:321`) and only reaches into `FirestoreModel.Struct`, `FirestoreModel.Record` and `FirestoreModel.Union`. A plain `Schema.Struct` field is a leaf there, written whole. An AST walk of the read schema reaches more paths and is the natural fit for queries, which filter on stored, read-shaped data.

## The ticket's cases

All results below are from `resolve.ts`. "Stored" is what `toCodecFirestore(Model)` writes at the path.

### Nested maps

`author.name` and `author.joined` (`DateTimeUtc`) inside a `FirestoreModel.Struct` resolve to one leaf each. The filter value equals the stored value: `"Ada"`, and `Timestamp(1, 0)`. A plain `Schema.Struct` field resolves the same way.

### Records

`counts.a` in a `FirestoreModel.Record(Schema.String, Schema.BigInt)` resolves through the index signature to the `BigInt` leaf, so `1n` becomes `"1"`, which is what is stored.

A record key whose schema transforms the key (for example a number-keyed record) needs the segment encoded too. The update side already does this with `PathKey` (`internal/firestoreModel.ts:148`), and `toCodecFirestore` applies `parameterFromString` to keys (`internal/firestoreValue.ts:159`). The prototype only checks that the parameter accepts the raw segment, so it does not cover key encoding.

### Optional fields

- **`FirestoreModel.Optional(Schema.String)`** is an optional key. The path resolves, and a present value encodes as stored. A document without the key is never matched by any filter. Firestore says `!=` and `not-in` "exclude documents where the given field does not exist", and an `orderBy` "also filters for existence of the given field" ([queries](https://firebase.google.com/docs/firestore/query-data/queries), [order and limit](https://firebase.google.com/docs/firestore/query-data/order-limit-data)). No filter value can mean "missing".
- **`Schema.optional(Schema.String)`** (optional key, value `| undefined`) stores `undefined` as `null`. `Undefined` follows its JSON codec (`internal/firestoreValue.ts:144-147`). So the model value `undefined` maps to two stored states, key missing or `null`, and `== null` matches only the second.
- **`Schema.OptionFromOptionalKey(Schema.String)`** changes optionality inside the property's own encoding. `Some("Eve")` encodes to `"Eve"`, but `None` fails ("Expected a valid value") because its stored form is "no key". A filter on `None` has to be refused or turned into something other than a value filter.

### Keys renamed between Type and Encoded

Effect 4.1 supports renaming with `Schema.encodeKeys({ name: "full_name" })` (`effect/src/Schema.ts:3692-3723`). It builds `Struct(encodedFields).pipe(decodeTo(self, transform({ decode: renameKeys(reverse), encode: renameKeys(mapping) })))`. In the AST this is an `Objects` with an `encoding` whose transformation is a pair of functions, so the mapping cannot be read off the AST.

Matching the encoded struct's fields by identity, `toEncoded(field) === encodedField`, does not recover it either. `toEncoded` is memoized per AST (`SchemaAST.ts:4775`), so two fields of the same schema (two `String`s, say) share one encoded node and cannot be told apart. `resolve.ts` refuses `renamed.name` for this reason. The same applies to any struct-to-struct `decodeTo` and to declarations other than classes. For example, `Schema.ReadonlySet` is stored as an array, but its element is reachable only through that declaration's own link.

Supporting renaming would take one of these:

- an annotation that carries the mapping;
- a model-level renaming primitive that this library owns, so it knows the mapping;
- resolving paths on the encoded side, which loses the Type-side codec of the leaf.

This repo's models do not use key renaming. A search for `encodeKeys` or `renameKeys` in `packages/*/src` and the tests finds nothing, and `FirestoreModel` has no renaming primitive of its own. A user can still nest `Schema.Struct(...).pipe(Schema.encodeKeys(...))` as a plain field, because `FirestoreModel.Value` admits any `Schema.Top`. `toCodecFirestore` stores that field under the encoded keys.

### Transformations and links

A transformation on a leaf is harmless, because the leaf's own codec runs it.

| Leaf                                       | Filter value              | Stored as                                                       |
| ------------------------------------------ | ------------------------- | --------------------------------------------------------------- |
| `NumberFromString`                         | `7`                       | `"7"`                                                           |
| `DateTimeUtc`                              | value                     | timestamp                                                       |
| `FirestoreSchema.DocumentReference(Posts)` | a reference to `posts/p1` | `DocumentPath("posts/p1")`, through its `toCodecFirestore` link |

Each row matches what the document stores. A transformation on an inner node is a problem only when a path continues through it (see the previous section).

### Union fields and union documents, and Shared Fields

A union resolves to one leaf per member that holds the path. Members without it add no leaf, and their documents never match a filter on it, since the field does not exist there. Three outcomes, from `resolve.ts`:

- **Same Type, same storage.** `title` on `Article = Union([Draft, Published])` resolves to two leaves, and both encode `"t"` to `"t"`. One filter value is right.
- **Same Type, different storage.** `shape.at` is `Schema.Date` in `circle` and `Schema.DateFromString` in `square`. A `Date` encodes to a timestamp in one member and an ISO string in the other. No single filter value matches both, so a faithful filter needs an `or`/`in` over both encodings, or has to be refused.
- **Different Type, same storage.** `updated` is `DateTimeUtc` in `Draft` and `Date` in `Published`. A `Date` value encodes only through `Published`, but both members store a timestamp. By stored value the field is shared, even though no one model value belongs to both Types.

The glossary's **Shared Field** ("a field every member of a union holds … with a value every member accepts and stores the same way") is already implemented for updates. `SharedValueSchema` (`internal/firestoreModel.ts:731`) encodes the value through every member's `toCodecFirestore` and requires one equal Firestore Value. `haveValueInCommon` (`:719`) uses Type overlap to decide whether a key is shared at all.

For a filter that test is stricter than it needs to be in one respect, and too narrow in another:

- **Stricter.** A query may filter on a key that only some members hold. Under Firestore's semantics, documents of the other members simply do not match. This is the unchecked update's "key only some members hold", without the need for the caller to vouch for anything.
- **Too narrow.** It requires every member to accept the value. A filter only needs agreement among the members that accept it and hold the path. The `updated` case shows this: one member rejects the `Date`, yet the stored values agree.

So "encode through every member that holds the path and accepts the value, and require the results to be equal" is the query-side rule that matches the glossary's Shared Field condition. `discriminator == "draft"` is the degenerate case: it encodes in one member and fails in the other, which is correct.

### Arrays and `array-contains`

`FirestoreModel.Array(X)` reads as `Arrays` with `rest: [X]`. The element leaf is `rest[0]`, and its codec encodes the `array-contains` value:

- `tags` with `"a"` gives `"a"`.
- `seen` (`Array(Date)`) with `new Date(5)` gives `Timestamp(0, 5000000)`.

The same element codec serves `array-contains-any`, and the field's own codec serves each entry of `in` and `not-in`.

- **Tuples.** A tuple has a different schema per position. Firestore's `array-contains` does not care about position, so the element schema is the union of the elements. `resolve.ts` encodes `1n` as `"1"` through `Tuple([String, BigInt])`, which would also match the string `"1"` in position 0.
- **Indexing.** A path segment cannot index into an array (`tags.0` is refused). Firestore field paths do not address array elements.
- **Array-shaped declarations.** A declaration stored as an array, such as `ReadonlySet`, has no `Arrays` node on the Type side, so its element is not reachable generically.

## Ordering and equality

These are the encodings where Firestore's comparison of the stored values differs from the model's comparison of the model values. They come from `encodings.ts` and the codec source.

Firestore's rules are from [Supported data types](https://firebase.google.com/docs/firestore/manage-data/data-types):

- Values of different types are ordered by type: null, booleans, numbers, timestamps, strings, bytes, references, geopoints, arrays, maps.
- Integers and doubles are interleaved numerically, and `NaN` sorts below `-Infinity`.
- Strings are ordered by "UTF-8 encoded byte order".
- References are ordered "by path elements".
- Timestamps are "precise only to microseconds".
- Arrays compare element by element, with a prefix first.
- Maps compare "by key and … key-value pairs, first comparing the keys and then the values", then by length.

| Encoding (model to stored)                                                                                                             | Equality                                                                                                                                                                                            | Ordering                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bigint` to decimal string (`keywordToCodecStringTree`, `internal/firestoreValue.ts:148-151`)                                          | Kept, because the encoding is canonical.                                                                                                                                                            | Broken: `"10" < "9"`, `"-1" < "-10"`, and negatives sort before positives only by the `-` byte.                                                                                                                      |
| `Date`, `DateTimeUtc` to timestamp, through milliseconds (`dateToTimestamp`, `dateTimeUtcToTimestamp`; `internal/timestamp.ts:82,107`) | Broken for values written elsewhere. A server timestamp holds microseconds and reads back floored to milliseconds: `Timestamp(1700000000, 123456789)` reads as `…123000000` and re-encodes unequal. | Monotone but not strict. A `>` filter or cursor built from a read value matches the document it was read from, and `<=` excludes it.                                                                                 |
| `DateTimeZoned` to ISO string with offset and zone (`toCodecJson`)                                                                     | Instant equality broken: the same instant in two zones gives two strings.                                                                                                                           | Broken: strings sort by local wall time, then offset.                                                                                                                                                                |
| `BigDecimal` to string                                                                                                                 | Kept if canonical.                                                                                                                                                                                  | Broken: string order (`"10.5" < "9"`).                                                                                                                                                                               |
| `Duration` to `{ _tag, value }` map (`{_tag:"Millis",value:1500}`, `{_tag:"Infinity"}`)                                                | Mostly kept within one `_tag`.                                                                                                                                                                      | Broken: maps compare by key, then value, across tags, and units differ by tag.                                                                                                                                       |
| `Option` to `{ _tag: "None" }` / `{ _tag: "Some", value }` map                                                                         | Kept.                                                                                                                                                                                               | Meaningless as an order. `None` and `Some` differ in their key sets.                                                                                                                                                 |
| `ReadonlySet` to array (in insertion order)                                                                                            | Broken: sets that are equal but were built in a different order store different arrays.                                                                                                             | Broken.                                                                                                                                                                                                              |
| `ReadonlyMap` to an array of `[k, v]` arrays                                                                                           | Broken by order, as for `ReadonlySet`.                                                                                                                                                              | Broken. It also nests arrays directly in an array, which Firestore does not store (not checked here).                                                                                                                |
| `DocumentReference` to `DocumentPath`                                                                                                  | Kept by path. A reference into another project or database stores the same path as one in this one.                                                                                                 | Ordered by path elements, not by the path string. The model defines no order for references.                                                                                                                         |
| `undefined` (`Schema.optional`, `UndefinedOr`) to `null`                                                                               | Broken: `undefined` is both "key missing" and "`null` stored", and only the second matches `== null`.                                                                                               | `null` sorts first.                                                                                                                                                                                                  |
| `NumberFromString` and any other number-to-string link                                                                                 | Kept if canonical.                                                                                                                                                                                  | Broken: string order.                                                                                                                                                                                                |
| A union whose members store as different Firestore types (`Number \| BigInt` gives a number or a string)                               | Not injective across members: `Union(String, BigInt)` stores both `"1"` and `1n` as `"1"`, and reads `"1"` back as `1n`, because `reorderUnion` puts `BigInt` first.                                | Firestore orders across types by type, so `5n` (a string) sorts after every number.                                                                                                                                  |
| `string` stays `string`                                                                                                                | Kept.                                                                                                                                                                                               | Can differ from a model that compares with JS `<`, which is UTF-16 code-unit order. Firestore uses UTF-8 byte order, and the two disagree for characters from U+E000 up against astral characters (surrogate pairs). |
| `number` stays `number` (`NaN`, `±Infinity` and `-0` kept, as `encodings.ts` shows)                                                    | `NaN`: Firestore normalizes `NaN`. Whether `-0` equals `0` is not stated in the data-types page.                                                                                                    | `NaN` sorts below `-Infinity`. `Order.Number` puts it elsewhere.                                                                                                                                                     |
| `Uint8Array` to bytes, `GeoPoint`, `Timestamp`, `DocumentPath` (native)                                                                | Kept.                                                                                                                                                                                               | Firestore's own order, which is the only one these types have.                                                                                                                                                       |

Not verified against a primary source here: whether range filters in Firestore return only values of the same type as the filter value. The data-types page states only the cross-type order. If they do, a range filter on a union field stored as mixed types silently skips the members stored as another type.

## Summary of what is possible and what it costs

- **Possible with public AST only.** Walk the read schema through classes (type parameter equal to the link target, or `.fields`), unlinked `Objects` and their index signatures, `Union` (collecting per member) and `Suspend`. Encode the filter value with `toCodecFirestore(Schema.make(leaf))`. For `array-contains`, use the element of an unlinked `Arrays`, or the union of a tuple's elements. Each case above was checked to equal the document's stored value.
- **Must refuse, or needs new information.**
  - A path through a struct transformed as a whole, including `encodeKeys`: the mapping is opaque and identity matching is ambiguous.
  - A path into a non-class declaration, including array-like ones such as `ReadonlySet`.
  - A path through array indexes.
  - A model value with no stored form (`None` under `OptionFromOptionalKey`), and "missing" in general.
- **Unions.** The rule that keeps "encoded exactly as stored" is the glossary's Shared Field condition, restricted to the members that hold the path and accept the value. Where members disagree, one filter cannot be faithful.
- **Ordering and equality.** `bigint`, `BigDecimal`, `DateTimeZoned`, number-from-string links, `Duration`, `Option`, `ReadonlySet` and `ReadonlyMap` break ordering, and some of them break equality too. `Date` and `DateTimeUtc` break equality, and strict ordering, against timestamps with sub-millisecond parts, which includes every server timestamp. `undefined` stored as `null` breaks "missing" semantics. Unions that mix stored types break both.
