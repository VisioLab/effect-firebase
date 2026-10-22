/**
 * Firestore as a canonical format.
 *
 * A **Firestore Value** is a value as Firestore stores it, independent of either
 * SDK: a scalar, a timestamp, a geopoint, a document reference, bytes, a
 * sentinel, or an array or map of Firestore Values. {@link toCodecFirestore}
 * derives a codec from any plain schema to Firestore Values, the way
 * `Schema.toCodecJson` derives one to JSON, so a model stays a plain Effect
 * schema and encoding it asks for no service. Each SDK package maps Firestore
 * Values to and from its own values.
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Schema, SchemaAST } from "effect";
import type * as Collection from "./Collection.ts";
import type * as FieldValue from "./FieldValue.ts";
import type * as GeoPoint from "./GeoPoint.ts";
import * as firestoreValue from "./internal/firestoreValue.ts";
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
  | Collection.DocumentReference<Collection.Any>
  | Uint8Array
  | FieldValue.ServerTimestamp
  | FieldValue.Increment
  | FieldValue.DeleteField
  | FieldValue.ArrayUnion<FirestoreValue>
  | FieldValue.ArrayRemove<FirestoreValue>
  | ReadonlyArray<FirestoreValue>
  | { readonly [key: string]: FirestoreValue };

/**
 * Whether `u` is a {@link FirestoreValue}.
 *
 * Maps are plain objects only: an instance of any other class is not one, since
 * Firestore would store it as a map and read it back as something else.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isFirestoreValue: (u: unknown) => u is FirestoreValue =
  firestoreValue.isFirestoreValue;

/**
 * Type-level representation returned by {@link toCodecFirestore}.
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
 * string, and `undefined` as `null`. Derivation never fails and is memoized
 * per schema.
 *
 * @stability unstable
 * @category converting
 * @since 0.2.0
 */
export const toCodecFirestore: <S extends Schema.Constraint>(schema: S) => toCodecFirestore<S> =
  firestoreValue.toCodecFirestore;
