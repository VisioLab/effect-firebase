# Type-check cost of dotted paths and field objects

Throwaway, never merged. Wayfinder task "Type-check cost of dotted paths and field objects" (#126) on map "Queries in Firestore" (#117).

## What was measured

Three ways to name a field, each type-checking the same queries against the same synthetic model, with the same Shared Field rule and the same operator gates from "Filter values and field typing" (#121), worked out from Type and Encoded:

- **dotted (map)**, `lib/dotted.ts`: #121 as written. One flattened map from every path to its shape, a sibling of `UpdatePaths`, so `keyof` that map is both the autocomplete list and what `where` checks against.
- **dotted (lookup)**, `lib/dottedLookup.ts`: the cheaper way to type dotted paths. A union of path strings, then a walk down the path for each call.
- **field objects**, `lib/fields.ts`: `Query.fields(definition)` returns a mapped type that resolves one level per property access. Filters are owned by their definition (nominal), as in the field-object prototypes.

`update` is the existing `UpdatePaths` (`keyof Model.update.Encoded`) on the same model, as a reference. `*1` files hold only two queries (one on a collection, one on the union document), standing in for the one file an editor re-checks.

Each style file ends with negative cases (unknown path, wrong value type, `bigint` ordered, a non-shared field of a mixed group, and for field objects a filter from another collection) as `@ts-expect-error`, so a cheap result can't come from an `any`.

### The model (`gen.ts`)

Every model has `likes`, `title` and `meta.{createdAt, likes}`, plus a generated tree. At each level a struct has `width` fields cycling through string, finite, boolean, bigint, string array, `FirestoreModel.Timestamp(Schema.Date)`, `FirestoreModel.Record(String, String)` and `Optional(Finite)`. Every third field is a nested `FirestoreModel.Struct`, down to `depth`, and the last field is a `FirestoreModel.Record` of structs. Odd-numbered models rotate the kinds. Sources: one collection per model, a `FirestoreModel.Union` document of 3 members, a **Collection Group** of 4 subcollections of the same model, and a mixed group of two models that share only the common fields.

| scale | width | depth | models | leaf paths per model | sources | queries per style |
| ----- | ----- | ----- | ------ | -------------------- | ------- | ----------------- |
| S     | 8     | 2     | 4      | 33                   | 7       | 28                |
| M     | 12    | 3     | 8      | 236                  | 11      | 66                |
| L     | 12    | 4     | 12     | 940                  | 15      | 120               |

```sh
cd packages/effect-firebase
vpx bench-query-types/gen.ts L 12 4 12 8   # likewise S 8 2 4 4, M 12 3 8 6
vpx bench-query-types/run.ts 3 S M L       # tsc --extendedDiagnostics --singleThreaded
vpx bench-query-types/editor.ts L          # tsserver latency
```

Machine: Apple Silicon laptop. Compiler: `tsc` 7.0.2 (tsgo, `effect-tsgo` 0.63.0). Editor: TypeScript 6.0.3's tsserver, the JS language service, because no scriptable tsgo language server is available here.

## Batch type-check (tsgo, median of 3)

Δ is above `baseline` (the model plus a reference to each source).

| scale | style              | check (s) | Δ check (s) | instantiations | Δ instantiations | memory (MB) |
| ----- | ------------------ | --------- | ----------- | -------------- | ---------------- | ----------- |
| S     | baseline           | 0.17      |             | 336k           |                  | 164         |
| S     | dotted (map)       | 0.26      | +0.09       | 631k           | +295k            | 180         |
| S     | dotted (lookup)    | 0.24      | +0.07       | 594k           | +258k            | 177         |
| S     | field objects      | 0.23      | +0.06       | 527k           | +191k            | 176         |
| M     | baseline           | 0.83      |             | 2.09M          |                  | 332         |
| M     | dotted (map)       | 2.42      | +1.59       | 5.38M          | +3.28M           | 524         |
| M     | dotted (lookup)    | 1.74      | +0.91       | 4.47M          | +2.38M           | 455         |
| M     | field objects      | 1.39      | +0.56       | 3.55M          | +1.46M           | 421         |
| L     | baseline           | 5.24      |             | 11.9M          |                  | 1202        |
| L     | dotted (map)       | 29.36     | +24.1       | 29.5M          | +17.6M           | 2811        |
| L     | dotted (lookup)    | 11.00     | +5.8        | 24.7M          | +12.7M           | 1960        |
| L     | field objects      | 7.59      | +2.4        | 17.9M          | +6.0M            | 1613        |
| L     | update (reference) | 5.40      | +0.2        | 12.2M          | +0.3M            | 1256        |

Two queries only (`*1`, versus `baseline1`, the same two sources with no query):

| scale | baseline1 | dotted (map)   | dotted (lookup) | field objects  |
| ----- | --------- | -------------- | --------------- | -------------- |
| M     | 0.90 s    | 1.37 s (+0.47) | 1.15 s (+0.25)  | 1.03 s (+0.13) |
| L     | 5.3 s     | 10.15 s (+4.8) | 6.45 s (+1.1)   | 5.72 s (+0.4)  |

## Editor (tsserver, TypeScript 6.0.3, two-query file)

| scale | style           | open + diagnostics (ms) | per edit (ms) | completions at the path (ms) | entries offered |
| ----- | --------------- | ----------------------- | ------------- | ---------------------------- | --------------- |
| M     | baseline1       | 1588                    | 522           |                              |                 |
| M     | dotted (map)    | 2418                    | 1672          | 561                          | 162             |
| M     | dotted (lookup) | 1992                    | 1042          | 339                          | 162             |
| M     | field objects   | 1628                    | 755           | 257                          | 15              |
| L     | baseline1       | 3039                    | 2350          |                              |                 |
| L     | dotted (map)    | 15150                   | 15777         | 6111                         | 486             |
| L     | dotted (lookup) | 5369                    | 4746          | 1464                         | 486             |
| L     | field objects   | 4064                    | 3621          | 972                          | 15              |

"Per edit" is the semantic diagnostics after a one-character edit (median of 5), which is roughly what each keystroke costs in the file. Completions are asked inside the path literal, or after `p0.`.

## Findings

- **No style hit a recursion limit** (no TS2589 or TS2321) at any scale, including depth 4, Records of structs, a 3-member union document and groups.
- **Field objects are the cheapest at every scale**, and the gap grows with the model. At L, over the baseline, they cost a tenth of the flattened dotted map's batch time (+2.4 s against +24.1 s) and half of the dotted lookup's (+5.8 s). They resolve only the levels a query touches, while both dotted styles enumerate every path of a source before they can check one literal against it.
- **The flattened dotted map, as #121 specifies it, is the only style with a noticeable editor delay.** At M it adds about 1.1 s to every edit. At L it adds 13 s per edit and takes 6 s for completions, which makes the editor unusable. The lookup form adds about 2.4 s per edit at L and field objects about 1.3 s. Below M-scale models, all three are within a few hundred milliseconds.
- **The flattened map is also wrong on nested Records.** A template key's `${string}` matches dots, so `f11.k.f11.k.f8` matches `f11.${string}.f8` as well as its own key, and the map intersects the entries (this is the TS2345 at M and L). Leaving out the key of an entry that is itself a struct fixes only one level. The lookup form walks one segment at a time and is right. Field objects never build string keys.
- **Completions differ in kind**: the dotted styles offer every path of the source at once (486 at L), and field objects offer one level (15).
- **Effect's tsgo is about 2–3× faster than TS 6's tsserver** on the same work, so the editor numbers above are the pessimistic side for users still on a JS language service.
- **Caveats**: the libraries are approximations of the real typing (paths are walked over Type/Encoded, not over the schema AST, and there is no annotation override), and they are equally rough in all three styles. The `UpdatePaths` reference costs almost nothing above the baseline, which suggests the model's classes already pay for it. It does not separate out here.
