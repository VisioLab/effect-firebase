# Firestore Values via a canonical codec, not an encoder service

Every `FirestoreSchema` codec used to build the SDK's own values through a `FirestoreEncoder` service, so the encoder showed up in every model's `EncodingServices` and had to be excluded, provided or faked wherever a document was encoded. Instead, models are plain Effect schemas and Firestore becomes a canonical format, the way JSON is one: `toCodecFirestore(schema)` derives a codec from a model to Firestore Values. Firestore Values are portable and SDK-free. Each SDK then owns one total mapping between Firestore Values and its own values, in both directions, playing the role `JSON.stringify` plays for JSON. Encoding is pure and asks for no service, and adding a kind of value no longer breaks anyone's encoder.

The Firestore service derives the codec where it reads or writes, as `HttpApiEndpoint` derives `toCodecJson`, relying on Effect's memoization of the AST; a collection holds only the plain model. For a declaration, derivation looks for `toCodecFirestore`, then `toCodecJson`, then `toCodec`, the way `toCodecStringTree` falls back to JSON: every JSON value is already a Firestore Value, so anything Effect can write as JSON can be written to Firestore. Firestore's own types come first, so `Date` and `DateTimeUtc` become timestamps and `Uint8Array` bytes rather than strings. A declaration with no link at all must already hold a Firestore Value, and encoding fails with a schema issue rather than letting the SDK store a class instance as a map. Keywords follow JSON, so a `bigint` is written as a string.

`FirestoreSchema` keeps only the schemas for Firestore Values Effect has no schema for (`Timestamp`, `GeoPoint`, `DocumentReference`, the sentinels), each a plain declaration with no encoding step. Reads map the SDK's values into Firestore Values before decoding, so the codec's encoded side is a Firestore Value both ways and the structural `*Like` types are no longer needed.

## Considered Options

- **Keep the encoder service.** Rejected: it is the leak, and its interface grows a method, and breaks every implementation, with each new kind of value.
- **Derive per SDK**, handing derivation a dialect that builds that SDK's values directly. Rejected: the dialect is the encoder interface again, only passed at derivation rather than through a service, and references would force a derivation per database.
- **Derive in the collection.** Rejected: it ties the model to Firestore for nothing, since derivation is memoized wherever it happens.

## Consequences

- `FirestoreEncoder`, both SDK implementations of it, `layerWithEncoder`, `WriteServices` and `UpdateServices`, the `*Like` types and `FirestoreSchema.DateTimeUtcFromTimestamp` go. Writing through the raw SDK takes each SDK package's mapping function instead.
- Effect has no public way to define a canonical format, so derivation builds on `SchemaAST` helpers marked `@internal` (`replaceEncoding`, `mapLink`, `applyToSelfOrLastLinkEncodingIdempotent`), and `effect` is pinned to an exact version until Effect offers pluggable formats.
- A `DateTimeUtc` or `Date` read back loses whatever precision a timestamp held below a millisecond; a field that needs it is a `Timestamp`.
