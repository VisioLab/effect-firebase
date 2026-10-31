# What Firestore allows in a query

Research for [#118](https://github.com/VisioLab/effect-firebase/issues/118) (map [#117](https://github.com/VisioLab/effect-firebase/issues/117)). This note records facts only and makes no design decisions.

## Versions covered

| Repo pin (`pnpm-workspace.yaml` catalog) | Resolved in `pnpm-lock.yaml` | Firestore implementation                                                       |
| ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `firebase-admin: ^14.5.0`                | `firebase-admin@14.5.0`      | `@google-cloud/firestore@9.1.0` (uses `google-gax` 6 and `@grpc/grpc-js` 1.14) |
| `firebase: ^13.0.0`                      | `firebase@13.0.0`            | `@firebase/firestore@4.18.0`                                                   |

Source paths below are relative to each package root in `node_modules/.pnpm`:

- **[A]** is `@google-cloud/firestore@9.1.0`, for example `build/src/reference/query.js:184`.
- **[C]** is `@firebase/firestore@4.18.0`. Its public validation lives in `dist/index.esm.js` and its core in `dist/common-D9UYuXJO.esm.js`. The other bundles have the same code.

Docs are the Firebase pages fetched on 2026-10-31:

- **[D-queries]** https://firebase.google.com/docs/firestore/query-data/queries
- **[D-order]** https://firebase.google.com/docs/firestore/query-data/order-limit-data
- **[D-multi]** https://firebase.google.com/docs/firestore/query-data/multiple-range-fields
- **[D-cursors]** https://firebase.google.com/docs/firestore/query-data/query-cursors
- **[D-index]** https://firebase.google.com/docs/firestore/query-data/indexing and https://firebase.google.com/docs/firestore/concepts/index-overview
- **[D-quotas]** https://firebase.google.com/docs/firestore/quotas
- **[D-emu]** https://firebase.google.com/docs/emulator-suite/connect_firestore

The limits quoted from the docs are the ones the docs label **Standard edition**. The Enterprise edition (MongoDB compatibility) is out of scope.

A general pattern runs through every section. **The client SDK checks much more before it sends a query, and the Admin SDK leaves almost all rule checks to the backend.** When this note says "the backend enforces" a rule, the SDK does not check it, so a breach shows up only as a server error when the query runs.

---

## 1. Operators

- **Same set in both SDKs.** `WhereFilterOp` is `'<' | '<=' | '==' | '!=' | '>=' | '>' | 'array-contains' | 'in' | 'not-in' | 'array-contains-any'` in both. Sources: [A] `types/firestore.d.ts:1710`, [C] `dist/index.d.ts:4288`, [D-queries] "Query operators".
- **The Admin SDK also accepts `'='` as an untyped alias for `'=='`.** It is not in the type. Source: [A] `build/src/reference/helpers.js:57-59`.
- **`OrderByDirection` is `'asc' | 'desc'` in both.** The default is ascending. Sources: [A] `types/firestore.d.ts:1704`, [C] `dist/index.d.ts:2895`.
- **Composite filters:**
  - Admin uses `Filter.where`, `Filter.or` and `Filter.and`, passed to `query.where(filter)`. Source: [A] `types/firestore.d.ts:3053-3149`.
  - The client uses `or(...)` and `and(...)` constraints. Source: [C] `dist/index.d.ts:172,2871`.
  - The client rejects more than one composite filter at the top level of `query()`, and also a composite filter mixed with a plain `where` there. The error is `"InvalidQuery. When using composite filters, you cannot use more than one filter at the top level..."`. Admin has no equivalent check because filters chain through `.where()`. Sources: [C] `dist/index.esm.js:118-123`, [A] `build/src/reference/query.js:146-163`.
  - Both SDKs drop empty composite filters and unwrap a composite filter that has a single child. Sources: [A] `query.js:154-158,208-219`, [C] `dist/index.esm.js:247-250`.
- **`null` and `NaN` values:**
  - Admin allows only `==` and `!=`. Source: [A] `helpers.js:60-70`.
  - The client allows `==`, `!=` **and `array-contains`**. Source: [C] `dist/index.esm.js:179-180`.
- **Semantics from the docs:**
  - `!=` and `not-in` exclude documents where the field does not exist.
  - `x != null` evaluates to undefined, so `null` values do not match `!=`.
  - A `not-in` that has `null` among its values matches nothing.
  - `in` with an array value matches the whole array exactly.
  - Results of `array-contains-any` are de-duplicated.

  Source: [D-queries] "Not equal", "not-in", "array-contains-any".

- **Admin-only query methods:**
  - `offset()` and `select(...)`. The type docs say "Queries that contain field masks cannot be listened to via `onSnapshot()`". Source: [A] `types/firestore.d.ts:1815,1831`.
  - `stream()` and `explain()`.
  - The client has no `offset` or `select`. Its `QueryConstraintType` is `where | orderBy | limit | limitToLast | startAt | startAfter | endAt | endBefore`. Source: [C] `dist/index.d.ts:3159-3167`.

## 2. Inequalities and `orderBy`

- **What counts as an inequality:** `<`, `<=`, `>`, `>=`, `!=` and `not-in`, identically in both SDKs. Sources: [A] `field-filter-internal.js:59-71`, [C] `common-D9UYuXJO.esm.js:4470-4472`.
- **Inequalities on several fields are allowed.** The limit is **10 range or inequality fields** per query. Source: [D-multi] "Limitations".
- **Unsupported shape:** "Queries with range or inequality filters on document fields and only equality constraints on the document key (`__name__`) aren't supported." Source: [D-multi] "Limitations".
- **Neither SDK checks how inequalities relate to `orderBy`.** The installed client has no "first orderBy must match the inequality field" validation. Its only operator-combination check is the conflict table below. Admin has none either. Sources: [C] `dist/index.esm.js:545-568`, [A] `query.js:179-203`.
- **The docs contradict themselves on this rule.** [D-order] still says "if you have a filter with a range comparison (<, <=, >, >=), your first ordering must be on the same field, see the list of orderBy() limitations below". The list it points to names only the existence rule, and [D-multi] describes free ordering across inequality fields. Neither SDK enforces the old rule. Treat the backend as the only authority here; this note did not test it at runtime.
- **Implicit ordering, which both SDKs compute the same way:**
  1. The explicit `orderBy` clauses come first.
  2. Next come the inequality fields that are not already ordered, in lexicographic field-path order, with each field added once.
  3. `__name__` comes last unless it is already ordered.
  4. The implicit clauses use **the direction of the last explicit `orderBy`**, or ascending when there is none.

  Sources: [C] `common-D9UYuXJO.esm.js:5318-5348` (`__PRIVATE_queryNormalizedOrderBy`), [A] `query.js:611-642` (`createImplicitOrderBy`).

- **The implied ordering filters for existence.** "A query with an inequality filter on a field implies ordering by that field and filters for existence of that field". In the same way, an `orderBy` field must exist for a document to be returned. Sources: [D-queries] "Standard edition query limitations", [D-order] "orderBy and existence".
- **What goes on the wire differs:**
  - The client always sends the normalized order, with the implicit inequality fields and `__name__`. Source: [C] `common-D9UYuXJO.esm.js:5354-5357` (`__PRIVATE_queryToTarget`).
  - Admin `get()` sends **only the explicit** `orderBy` unless `Settings.alwaysUseImplicitOrderBy: true` is set. Source: [A] `query.js:1095-1103`, `build/src/index.js:642,702`, `types/firestore.d.ts:522`.
  - Admin `onSnapshot` always forces the implicit order. Source: [A] `watch.js:682`, which calls `toProto(undefined, undefined, true)`.
- **`orderBy` after a cursor:**
  - Both SDKs reject it. The client says `"Invalid query. You must not call startAt() or startAfter() before calling orderBy()."` and the matching endAt/endBefore message. Admin says `"Cannot specify an orderBy() constraint after calling startAt()..."`. Sources: [C] `dist/index.esm.js:320-321`, [A] `query.js:291-296`.
  - Admin also rejects `where()` after a cursor. Source: [A] `query.js:151-153`.

## 3. Limits on `in`, `not-in`, `array-contains-any` and `or`

All numeric limits below come from the backend and the docs. **Neither SDK checks the counts.** The only client check is that the array is non-empty.

- **Limits from the docs.** Source: [D-queries] "in, not-in, and array-contains-any", "Standard edition query limitations", "Limits on OR queries".
  - `in`: up to **30** values.
  - `array-contains-any`: up to **30** values.
  - `not-in`: up to **10** values.
  - `or`, `in` and `array-contains-any` together: at most **30 disjunctions in disjunctive normal form**. "This limit is fixed and cannot be adjusted." `a in [1,2]` counts as `a = 1 OR a = 2`, and an AND of OR groups multiplies. The docs show a query with 50 disjunctions as an error.
  - Filters, sort orders and the parent path (1 for a subcollection, 0 for a root collection) may sum to at most **100**, counted on the DNF.
  - At most one `array-contains` per disjunction. `array-contains` cannot be combined with `array-contains-any` in the same disjunction.
  - Only a single `not-in` or `!=` per query. `not-in` cannot be combined with `!=`, nor with `in`, `array-contains-any` or `or`.
  - The client enforces a subset of these before sending, as the conflict table in `__PRIVATE_validateNewFieldFilter` (`dist/index.esm.js:545-568`), checked across flattened filters:

    | New filter                 | Rejected if the query already has          |
    | -------------------------- | ------------------------------------------ |
    | `!=`                       | `!=`, `not-in`                             |
    | `in`, `array-contains-any` | `not-in`                                   |
    | `not-in`                   | `array-contains-any`, `in`, `not-in`, `!=` |

    The errors are `"Invalid query. You cannot use more than one '<op>' filter."` or `"...You cannot use '<op>' filters with '<other>' filters."`. The client does **not** check `array-contains` against `array-contains-any`, `not-in` against a plain `or`, the value counts or the DNF size. Admin checks none of these.
- **Empty arrays:**
  - The client rejects an empty or non-array value for `in`, `not-in` and `array-contains-any` with `"Invalid Query. A non-empty array is required for '<op>' filters."`. Source: [C] `dist/index.esm.js:203,541-543`.
  - Admin performs this check only when the field is `FieldPath.documentId()`. Otherwise it passes the value on unchecked. Source: [A] `query.js:192-196`.

## 4. `limit` and `limitToLast`

- **Argument validation:**
  - Client: `limit(n)` and `limitToLast(n)` require `n > 0` and are not checked to be integers. The error is `"Function limit() requires a positive number, but it was: n."`. Sources: [C] `dist/index.esm.js:385-386,398-399`, `common-D9UYuXJO.esm.js:1455-1457`.
  - Admin: both require an integer of any sign, including 0. Source: [A] `query.js:325-332,356-360`, `validate.js:198-213`.
  - [D-order]: "If you specify a limit(), the value must be greater than or equal to zero."
- **`limitToLast` needs at least one explicit `orderBy`.**
  - Client: the check runs when `getDocs` or `onSnapshot` is called, and throws `FirestoreError` code **`unimplemented`** with `"limitToLast() queries require specifying at least one orderBy() clause"`. `getDocsFromServer` and `getDocsFromCache` skip this pre-check. Sources: [C] `dist/index.esm.js:100-102,1185-1189,1197-1214,1321`.
  - Admin: the check runs when the query is serialized, at execution time, and throws a plain `Error('limitToLast() queries require specifying at least one orderBy() clause.')`. Source: [A] `query.js:1104-1106`.
- **How it is implemented.** Both SDKs flip every orderBy direction, swap `startAt` and `endAt` (inverting inclusivity), send the query as a normal limit, then reverse the results. Sources: [C] `common-D9UYuXJO.esm.js:5372-5384`, [A] `query.js:1014-1035`, `query-util.js:66-76`.
- **In listeners:**
  - Client `onSnapshot` supports `limitToLast` and keeps the window in its view. Source: [C] `common-D9UYuXJO.esm.js:26438,26486`.
  - Admin `onSnapshot` sends the flipped target, because `toProto` applies the limitToLast rewrite, and sorts the snapshot with the query's original comparator. So the source supports `limitToLast` in Admin listeners too. This was not tested at runtime. Source: [A] `watch.js:672-683`, `query.js:1189-1217`.
- **Admin streaming.** `stream()` and `explainStream()` throw for `limitToLast` with `"Query results for queries that include limitToLast() constraints cannot be streamed. Use Query.get() instead."`. Sources: [A] `query-util.js:106-110`, `query.js:963-965`, `types/firestore.d.ts:1799`.
- **In transactions:**
  - Admin `Transaction.get` accepts a `Query` or an `AggregateQuery` and runs `query._get()`. That is the same buffered path as `get()`, which reverses the results. So `limitToLast` works inside Admin transactions, including read-only ones. Source: [A] `transaction.js:112-128,578-579`.
  - The client `Transaction.get` accepts **only a `DocumentReference`**, so client transactions cannot run queries at all. Source: [C] `dist/index.d.ts:3983-3985`.
- **Admin retry note.** When a non-transactional Admin query stream fails with a retryable error after delivering documents, the SDK re-issues the query with `startAfter(lastDoc)` and a reduced `limit` or `limitToLast`. Source: [A] `query-util.js:197-245`.

## 5. Cursors (`startAt`, `startAfter`, `endAt`, `endBefore`)

- **From a snapshot, values come from the normalized order** described in section 2: explicit `orderBy`, then unordered inequality fields, then `__name__`. One value is taken per entry, and the position is therefore unambiguous. Sources: [C] `dist/index.esm.js:470-490`, [A] `query.js:603-610` together with `_extractFieldValues` at `102-121`.
  - Admin applies this only when the cursor gets exactly one argument that is a `DocumentSnapshot`. Source: [A] `query.js:605-607`.
  - [D-cursors]: "The values in the document snapshot serve as the values in the query cursor."
- **From field values, the cursor uses only the explicit `orderBy` clauses**, with no implicit `__name__` or inequality fields.
  - You may pass **fewer** values than there are clauses. Passing **more** throws:
    - Client: `"Too many arguments provided to startAt(). The number of arguments must be less than or equal to the number of orderBy() clauses"`. Source: [C] `dist/index.esm.js:497-500`.
    - Admin: `"Too many cursor values specified. The specified values must match the orderBy() constraints of the query."`. Source: [A] `query.js:656-668`.
  - To paginate unambiguously by value, add `orderBy(documentId())` explicitly and pass the id as the last value. [D-cursors] "Set cursor based on multiple fields" describes adding values to reduce ambiguity.
- **Snapshot edge cases:**
  - Client: a non-existent snapshot throws `NOT_FOUND`. A missing order field throws `"...the field '<f>' (used as the orderBy) does not exist."`. A pending server timestamp throws `"...is an uncommitted server timestamp..."`. Source: [C] `dist/index.esm.js:472-487`.
  - Admin: a missing order field throws `'Field "<f>" is missing in the provided DocumentSnapshot...'`. Admin has no server-timestamp or existence check. Source: [A] `query.js:108-115`.
- **Value for a `documentId()` order in a field-value cursor:**
  - Client: the value must be a **string**. Otherwise it throws `"Expected a string for document ID in startAt(), but got a <type>"`. Source: [C] `dist/index.esm.js:503-511`.
  - Admin: the value may be a string or a `DocumentReference`, checked by `validateReference`. Source: [A] `query.js:671-674,693-731`.

## 6. `documentId()` on collections and collection groups

- **Spelling:**
  - The client uses `documentId()`, which returns a `FieldPath`. Source: [C] `dist/index.d.ts:773`.
  - Admin uses `FieldPath.documentId()`.
  - Both map to `__name__`.
- **Operators.** `array-contains` and `array-contains-any` on the document id are rejected by both: "You can't perform '<op>' queries on documentId()" (Admin says `FieldPath.documentId()`). `in` and `not-in` need a non-empty array whose elements are each validated as ids. Sources: [C] `dist/index.esm.js:192-200`, [A] `query.js:187-200`.
- **String values on a collection.** The value must be a **plain id** with no `/`. Empty strings are also rejected on the client.
  - Client: `"When querying a collection by documentId(), you must provide a plain document ID, but '<v>' contains a '/' character."` (`dist/index.esm.js:526-530`).
  - Admin: `"...the corresponding value must be a plain document ID, but '<v>' contains a slash."` (`query.js:707-711`).
- **String values on a collection group.** The value must form a **full document path relative to the group's parent**, with an even number of segments, such as `cities/SF/landmarks/golden-gate`. A plain id fails with "...odd number of segments". Sources: [C] `dist/index.esm.js:531-532`, [A] `query.js:700-706`.
- **`DocumentReference` values:**
  - Admin requires the reference to sit under the query's base path. For a plain collection it must be a **direct child**: `"Only a direct child can be used as a query boundary."`. Source: [A] `query.js:713-731`.
  - The client accepts any `DocumentReference` in a `where` filter without that check. Source: [C] `dist/index.esm.js:533`.
- **Index scope.** A collection-group query needs an index with **collection group scope**. Automatic collection-group indexes are not maintained by default, so you must create them, and client SDKs also need security rules that allow collection-group reads. Sources: [D-queries] "Collection group queries", [D-index] "Index modes and query scopes".

## 7. How a missing composite index surfaces

- **The backend behavior is the same for both SDKs.**
  - A query that no existing index supports fails with gRPC status **`FAILED_PRECONDITION` (9)**.
  - The message contains a **link to the Firebase console that creates the missing index**. "These links will always open in the Firebase console."
  - For a vector index, the message contains a `gcloud` command instead.
  - Sources: [D-index] "Create a missing index through an error message" and index-overview "Manual indexes". The Firebase JS SDK integration test `packages/firestore/test/integration/api/query.test.ts` ("can catch error message for missing index with error handler", around line 673) asserts `err.code === 'failed-precondition'` and that the message matches `/index.*https:\/\/console\.firebase\.google\.com/`. The test applies the link check only on the default database. The test is in https://github.com/firebase/firebase-js-sdk.
- **Client (`firebase` 13):**
  - `getDocs` and `onSnapshot` both run through the watch stream. Source: [C] `dist/index.esm.js:1188`, which uses `__PRIVATE_firestoreClientGetDocumentsViaSnapshotListener`.
  - The error is a `FirestoreError` with `code: 'failed-precondition'`, delivered to the listener's error callback or as a rejected promise. `FAILED_PRECONDITION` is a permanent error, so it is not retried. Source: [C] `common-D9UYuXJO.esm.js:5585-5600`.
  - A listener with no error callback logs `"Uncaught Error in snapshot listener:"`. Source: [C] `common-D9UYuXJO.esm.js:24837`.
- **Admin, `get()`, `stream()` and `Transaction.get(query)`:**
  - The error is the gRPC error from `google-gax`/`@grpc/grpc-js`.
  - It has a numeric **`code: 9`**, plus `details` and `metadata`.
  - Its `message` is `` `${code} ${Status[code]}: ${details}` ``, that is `"9 FAILED_PRECONDITION: <server text with console link>"`. Source: `@grpc/grpc-js@1.14` `build/src/call.js:30-35` (`callErrorFromStatus`).
  - The SDK appends the call-site stack. Source: [A] `util.js:215-218` (`wrapError`), used at `query-util.js:51`.
  - The `preferRest` transport may format the error differently; this was not checked.
- **Admin, `onSnapshot`:**
  - A target `REMOVE` with a cause becomes **`new Error('Error ' + code + ': ' + message)`**, for example `"Error 9: The query requires..."`.
  - This error has **no `.code` property**. The source carries the comment `// @todo: Surface a .code property on the exception.`.
  - Source: [A] `watch.js:385-393`.
- **Emulator:** "The emulator does not track compound indexes and instead will execute any valid query." So missing-index errors never appear against the emulator. The JS SDK tests skip this case on the emulator. Sources: [D-emu] "Indexes", plus the tests above.
- **Related quotas:** Source: [D-quotas].
  - Composite indexes per database: 200 without billing, 1000 with billing.
  - Fields per composite index: at most 100.
  - Index entries per document: at most 40,000.
  - Indexed values over 1500 bytes are truncated, which can make query results inconsistent.

---

## Admin vs client: every difference found

| Topic                                                           | Admin (`@google-cloud/firestore` 9.1.0)                                      | Client (`@firebase/firestore` 4.18.0)                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `'='` alias                                                     | accepted                                                                     | not accepted                                                       |
| `null` or `NaN` with `array-contains`                           | rejected                                                                     | allowed                                                            |
| Top-level composite filters                                     | chain freely with `.where()`                                                 | at most one, and not mixed with `where` in one `query()` call      |
| Operator conflicts (`!=`, `not-in`, `in`, `array-contains-any`) | not checked; backend enforces                                                | checked locally                                                    |
| Empty `in`, `not-in` or `array-contains-any` array              | checked only on `documentId()`                                               | always checked                                                     |
| `where()` after a cursor                                        | throws                                                                       | no such check found                                                |
| `limit(n)` validation                                           | any integer, including 0 and negatives                                       | `n > 0`, integer not checked                                       |
| `limitToLast` without `orderBy`                                 | plain `Error` at execution                                                   | `FirestoreError('unimplemented')` from `getDocs` or `onSnapshot`   |
| `limitToLast` in listeners                                      | supported in source (untested)                                               | supported                                                          |
| Queries in transactions                                         | supported, including `limitToLast`                                           | not supported (`Transaction.get` takes only a `DocumentReference`) |
| Implicit `orderBy` sent on `get()`                              | only with `alwaysUseImplicitOrderBy` (listeners always send it)              | always                                                             |
| `offset`, `select`, `stream`, `explain`                         | available (`select` cannot be listened to; `limitToLast` cannot be streamed) | not available                                                      |
| `documentId()` cursor value                                     | string or `DocumentReference`                                                | string only                                                        |
| `DocumentReference` in a `documentId()` filter                  | must be under the query path (a direct child for a collection)               | not checked                                                        |
| Snapshot cursor edge cases                                      | missing-field check only                                                     | checks existence, missing field and pending server timestamp       |
| Missing-index error from `get`                                  | gRPC error with `code` 9, message `"9 FAILED_PRECONDITION: ..."`             | `FirestoreError`, `code: 'failed-precondition'`                    |
| Missing-index error from `onSnapshot`                           | `Error("Error 9: ...")` with no `code`                                       | `FirestoreError`, `code: 'failed-precondition'`                    |

## Not verified at runtime

These facts come from reading source and docs only:

- Admin `limitToLast` inside `onSnapshot`.
- How the backend treats an inequality whose field is not the first `orderBy`, given that the order-limit docs page contradicts itself.
- The exact server error text for a breach of the DNF limit, the `not-in` count limit or the `in` count limit.
- The exact error shape when the Admin SDK runs with `preferRest`.
