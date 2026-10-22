# SDK services extend the portable ones

The core package's `Firestore` is the strict intersection of the Admin and client SDKs, so portable code written against it runs on either. What only one SDK can do lives in that SDK package, in a service that extends the portable one, the way `@effect/sql-pg`'s `PgClient` extends `SqlClient`. For example, `AdminFirestore extends Firestore`. An SDK's `layer` provides the same object under both tags, so portable code and SDK-specific code can share one database.

An SDK service only ever widens the portable one. It may add methods for capabilities the portable one lacks, add optional options to existing methods, return richer types (a `ClientDocumentSnapshot` with metadata), and exclude more requirements. It never adds required parameters, errors or requirements to an existing method, and it never adds a parallel variant of one (no `streamDocWithMetadata`). That keeps every SDK service assignable to its portable one.

A type takes an SDK prefix (`AdminFirestore`, `AdminTransaction`, `ClientDocumentSnapshot`) exactly when it extends a portable type, because that is when both live side by side in one program and plain names would be ambiguous. Types with no portable counterpart (`App`, `Auth`) and modules that only implement a portable type (`FirestoreEncoder`) keep their plain name.

## Considered Options

- **Same names with their own keys** (`Firestore` in every package, told apart by namespace import), following `App`. Rejected because `Firestore` would mean two things in any file that touches both.
- **A side-car service** holding only the SDK extras next to an untouched `Firestore`. Rejected: it splits one database into two services, and SDK methods could no longer share the portable ones' encoder and error mapping.
- **Only an escape hatch to the raw SDK instance.** Kept as a field on the SDK services, but rejected as the whole answer, since it gives up schemas and typed errors for everything it touches.
