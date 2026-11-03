/**
 * Firestore Values: values as Firestore stores them, independent of either
 * SDK.
 *
 * {@link toCodecFirestore} derives a codec from any Effect schema to Firestore
 * Values, the way `Schema.toCodecJson` derives one to JSON. That keeps a model
 * a plain Effect schema that needs no service to encode. Each SDK package then
 * maps Firestore Values to and from its own SDK's values.
 *
 * You rarely call this module yourself: {@link Firestore} encodes and decodes
 * documents through it.
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Result, Schema, SchemaAST } from "effect";
import type * as DocumentPath from "./DocumentPath.ts";
import type * as FieldValue from "./FieldValue.ts";
import type { FirestoreError } from "./Firestore.ts";
import type * as GeoPoint from "./GeoPoint.ts";
import * as firestoreValue from "./internal/firestoreValue.ts";
import * as firestoreValueWalk from "./internal/firestoreValueWalk.ts";
import type * as Timestamp from "./Timestamp.ts";

declare module "effect/Schema" {
  namespace Annotations {
    // The augmentation has to repeat Effect's type parameters, `T` included.
    // oxlint-disable-next-line no-unused-vars
    interface Declaration<T, TypeParameters extends ReadonlyArray<Constraint> = readonly []> {
      /**
       * Returns the link used to derive the declaration's Firestore
       * representation, or `undefined` when it already holds a Firestore Value.
       *
       * {@link toCodecFirestore} prefers it to `toCodecJson` and `toCodec`.
       */
      readonly toCodecFirestore?:
        | ((typeParameters: TypeParameters.Encoded<TypeParameters>) => SchemaAST.Link | undefined)
        | undefined;
    }
  }
}

/**
 * A value as Firestore stores it, independent of either SDK.
 *
 * **Details**
 *
 * One of: `null`, a boolean, a number, a string, a {@link Timestamp.Timestamp},
 * a {@link GeoPoint.GeoPoint}, a {@link DocumentPath.DocumentPath}, bytes as a
 * `Uint8Array`, a {@link FieldValue} sentinel, or an array or plain-object map
 * of Firestore Values.
 *
 * A typed {@link Collection.DocumentReference} is not one: Firestore stores
 * only its path, as a {@link DocumentPath.DocumentPath}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type FirestoreValue =
  | null
  | boolean
  | number
  | string
  | Timestamp.Timestamp
  | GeoPoint.GeoPoint
  | DocumentPath.DocumentPath
  | Uint8Array
  | FieldValue.ServerTimestamp
  | FieldValue.Increment
  | FieldValue.DeleteField
  | FieldValue.ArrayUnion<FirestoreValue>
  | FieldValue.ArrayRemove<FirestoreValue>
  | ReadonlyArray<FirestoreValue>
  | { readonly [key: string]: FirestoreValue };

/**
 * Checks whether `u` is a {@link FirestoreValue}, all the way down.
 *
 * **Details**
 *
 * Maps must be plain objects. An instance of any other class is not a
 * Firestore Value, since Firestore would store it as a map and read it back as
 * a plain object.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isFirestoreValue: (u: unknown) => u is FirestoreValue =
  firestoreValue.isFirestoreValue;

// The walk the SDK packages map Firestore Values with. Not API: they reach it
// here because a package can only import another's public modules.

/** @internal */
export type FieldPath = firestoreValueWalk.FieldPath;

/** @internal */
export type Kinds = firestoreValueWalk.Kinds;

/** @internal */
export type Writer = firestoreValueWalk.Writer;

/** @internal */
export type Reader = firestoreValueWalk.Reader;

/** @internal */
export const formatFieldPath: (path: FieldPath) => string = firestoreValueWalk.formatFieldPath;

/** @internal */
export const toSdk: (value: FirestoreValue, writer: Writer) => unknown = firestoreValueWalk.toSdk;

/** @internal */
export const fromSdk: (
  value: unknown,
  reader: Reader,
) => Result.Result<FirestoreValue, FirestoreError> = firestoreValueWalk.fromSdk;

/** @internal */
export const readDocument: (
  path: string,
  data: unknown,
  reader: Reader,
) => Result.Result<FirestoreValue | undefined, FirestoreError> = firestoreValueWalk.readDocument;

/**
 * Type-level representation of the codec {@link toCodecFirestore} returns: the
 * schema's `Type`, encoded as a {@link FirestoreValue}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface toCodecFirestore<S extends Schema.Constraint> extends Schema.BottomLazy<
  S["ast"],
  toCodecFirestore<S>,
  S["~type.parameters"],
  S["~type.mutability"],
  S["~type.optionality"],
  S["~type.constructor.default"],
  S["~encoded.mutability"],
  S["~encoded.optionality"]
> {
  readonly Type: S["Type"];
  readonly Encoded: FirestoreValue;
  readonly DecodingServices: S["DecodingServices"];
  readonly EncodingServices: S["EncodingServices"];
  readonly "~type.make.in": S["~type.make.in"];
  readonly "~type.make": S["~type.make"];
  readonly Iso: S["Iso"];
  readonly schema: S;
}

/**
 * Derives a codec from a schema to Firestore Values.
 *
 * **When to use**
 *
 * Use to encode or decode a value the way {@link Firestore} stores it outside
 * a read or write, such as in a test or a custom backend. Reads and writes
 * through {@link Firestore} already use it.
 *
 * **Details**
 *
 * It works like `Schema.toCodecJson`: the schema's own transformations run
 * first, then structs, tuples, arrays, unions and `Schema.suspend` are walked.
 * A declaration is resolved in this order:
 *
 * 1. `Schema.Date` and `Schema.DateTimeUtc` become a portable `Timestamp`, and
 *    `Schema.Uint8Array` is stored as bytes. Reading a `Date` or `DateTime.Utc`
 *    back keeps milliseconds only.
 * 2. A `toCodecFirestore` annotation.
 * 3. A `toCodecJson` annotation, since every JSON value is a Firestore Value.
 * 4. A `toCodec` annotation.
 * 5. Otherwise the value must already be a Firestore Value, and encoding
 *    anything else fails with a schema issue at its path.
 *
 * Keywords follow `Schema.toCodecJson`: a `bigint` or `symbol` is written as a
 * string, and `undefined` as `null`. Unlike there, `Schema.Any` is no escape
 * hatch: like `Schema.Unknown` it takes Firestore Values only, since the SDK
 * mappings take nothing else. Derivation never fails and is memoized per
 * schema.
 *
 * @example Encoding a value to Firestore Values
 * ```ts
 * import { DateTime, Effect, Schema } from "effect";
 * import { FirestoreValue } from "@visiolab/effect-firebase/firestore";
 *
 * const Event = Schema.Struct({ name: Schema.String, at: Schema.DateTimeUtc });
 * const codec = FirestoreValue.toCodecFirestore(Event);
 *
 * // `at` is encoded as a portable `Timestamp`.
 * const encoded = Schema.encodeEffect(codec)({
 *   name: "launch",
 *   at: DateTime.makeUnsafe("2024-01-01T00:00:00Z"),
 * });
 * ```
 *
 * @see {@link FirestoreSchema} for schemas of the values Effect has none for
 *
 * @stability unstable
 * @category converting
 * @since 0.2.0
 */
export const toCodecFirestore: <S extends Schema.Constraint>(schema: S) => toCodecFirestore<S> =
  firestoreValue.toCodecFirestore;
