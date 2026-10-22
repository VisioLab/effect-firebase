import { Array, Effect, Equal, Schema, SchemaGetter, SchemaIssue, SchemaParser } from "effect";
import type * as Collection from "../Collection.ts";
import type * as FieldValue from "../FieldValue.ts";
import type * as FirestoreSchema from "../FirestoreSchema.ts";
import type * as GeoPoint_ from "../GeoPoint.ts";
import type * as Timestamp_ from "../Timestamp.ts";
import * as collection_ from "./collection.ts";
import * as fieldValue from "./fieldValue.ts";
import * as geoPoint from "./geoPoint.ts";
import * as timestamp from "./timestamp.ts";

/** Writes a timestamp as JSON without losing the digits finer than a millisecond. */
const TimestampJson = Schema.Struct({ seconds: Schema.Int, nanoseconds: Schema.Int });

/** @internal */
export const Timestamp: FirestoreSchema.Timestamp = Schema.declare<Timestamp_.Timestamp>(
  timestamp.isTimestamp,
  {
    representation: { id: "@visiolab/effect-firebase/firestore/Timestamp", payload: null },
    expected: "a Firestore Timestamp",
    toEquivalence: () => Equal.equals,
    toCodecFirestore: () => undefined,
    toCodecJson: () =>
      Schema.link<Timestamp_.Timestamp>()(TimestampJson, {
        decode: SchemaGetter.transformEffect((json: typeof TimestampJson.Type, options) =>
          Effect.fromOption(timestamp.make(json.seconds, json.nanoseconds)).pipe(
            Effect.mapError(
              () =>
                new SchemaIssue.InvalidValue(
                  { message: "Expected an instant Firestore can store" },
                  json,
                  options,
                ),
            ),
          ),
        ),
        encode: SchemaGetter.transform((value: Timestamp_.Timestamp) => ({
          seconds: value.seconds,
          nanoseconds: value.nanoseconds,
        })),
      }),
  },
);

/** @internal */
export const GeoPoint: FirestoreSchema.GeoPoint = Schema.declare<GeoPoint_.GeoPoint>(
  geoPoint.isGeoPoint,
  {
    representation: { id: "@visiolab/effect-firebase/firestore/GeoPoint", payload: null },
    expected: "a Firestore GeoPoint",
    toEquivalence: () => Equal.equals,
    toCodecFirestore: () => undefined,
  },
);

/** @internal */
export const DocumentReference = <C extends Collection.Any>(
  collection: C,
): FirestoreSchema.DocumentReference<C> => {
  const pattern = collection_.pattern(collection);
  // A reference read back names its path but not the collection it was
  // defined through, so a reference into any collection is taken, and
  // re-homed into `collection` when its path is one of `collection`'s.
  return Schema.declareConstructor<Collection.DocumentReference<C>>()(
    [],
    () => (input, ast, options) => {
      if (!collection_.isDocumentReference(input))
        return Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
      if (input.collection === collection)
        return Effect.succeed(input as Collection.DocumentReference<C>);
      return Effect.fromOption(collection_.fromPath(collection, input.path)).pipe(
        Effect.mapError(
          () =>
            new SchemaIssue.InvalidValue(
              { message: `Expected a document in ${pattern}, got "${input.path}"` },
              input,
              options,
            ),
        ),
      );
    },
    {
      representation: {
        id: "@visiolab/effect-firebase/firestore/DocumentReference",
        payload: null,
      },
      expected: `a reference to a document in ${pattern}`,
      toEquivalence: () => Equal.equals,
      toCodecFirestore: () => undefined,
    },
  ) as unknown as FirestoreSchema.DocumentReference<C>;
};

/** @internal */
export const ServerTimestamp: FirestoreSchema.ServerTimestamp =
  Schema.declare<FieldValue.ServerTimestamp>(fieldValue.isServerTimestamp, {
    representation: {
      id: "@visiolab/effect-firebase/firestore/FieldValue/ServerTimestamp",
      payload: null,
    },
    expected: "a server timestamp",
    toCodecFirestore: () => undefined,
  }).pipe(Schema.withConstructorDefault(Effect.succeed(fieldValue.serverTimestamp)));

/** @internal */
export const ServerTimestampOr = <S extends FirestoreSchema.TimeSchema>(
  schema: S,
): FirestoreSchema.ServerTimestampOr<S> => Schema.Union([schema, ServerTimestamp]);

/** @internal */
export const Increment: FirestoreSchema.Increment = Schema.declare<FieldValue.Increment>(
  fieldValue.isIncrement,
  {
    representation: {
      id: "@visiolab/effect-firebase/firestore/FieldValue/Increment",
      payload: null,
    },
    expected: "an increment",
    toEquivalence: () => Equal.equals,
    toCodecFirestore: () => undefined,
  },
);

/** @internal */
export const IncrementOr = <S extends Schema.Codec<unknown, number, unknown, unknown>>(
  schema: S,
): FirestoreSchema.IncrementOr<S> => Schema.Union([schema, Increment]);

/** @internal */
export const DeleteField: FirestoreSchema.DeleteField = Schema.declare<FieldValue.DeleteField>(
  fieldValue.isDeleteField,
  {
    representation: {
      id: "@visiolab/effect-firebase/firestore/FieldValue/DeleteField",
      payload: null,
    },
    expected: "a field deletion",
    toCodecFirestore: () => undefined,
  },
);

/** @internal */
export const DeleteFieldOr = <S extends Schema.Top>(schema: S): FirestoreSchema.DeleteFieldOr<S> =>
  Schema.Union([DeleteField, schema]);

/**
 * Declares a sentinel that carries elements, each of them run through `item` -
 * decoded on the way in and encoded on the way out, as `Schema.Option` does
 * with what it holds.
 *
 * The sentinel is already in Firestore form, apart from its elements:
 * `toCodecFirestore` keeps it and derives `item`'s own codec for them, so a
 * `DateTimeUtc` among them is stored as a timestamp.
 */
const elementsSentinel =
  <Sentinel extends { readonly elements: ReadonlyArray<unknown> }>(
    name: string,
    is: (u: unknown) => u is Sentinel,
    make: (...elements: ReadonlyArray<unknown>) => Sentinel,
  ) =>
  <S extends Schema.Top>(item: S) =>
    Schema.declareConstructor<Sentinel, Sentinel>()(
      [item],
      ([item]) => {
        const elements = Schema.Array(item);
        return (input, ast, options) =>
          is(input)
            ? SchemaParser.decodeEffect(elements)(input.elements, options).pipe(
                Effect.mapBothEager({
                  onSuccess: (decoded) => make(...decoded),
                  onFailure: (issue) => new SchemaIssue.Pointer(["elements"], issue),
                }),
              )
            : Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
      },
      {
        representation: {
          id: `@visiolab/effect-firebase/firestore/FieldValue/${name}`,
          payload: null,
        },
        expected: `an ${name}`,
        toCodecFirestore: () => undefined,
        toEquivalence: ([item]) => {
          const elements = Array.makeEquivalence(item);
          return (self, that) => elements(self.elements, that.elements);
        },
      },
    );

const ArrayUnionSentinel = elementsSentinel(
  "ArrayUnion",
  fieldValue.isArrayUnion,
  fieldValue.arrayUnion,
);

/** @internal */
export const ArrayUnion = <S extends Schema.Top>(item: S): FirestoreSchema.ArrayUnion<S> =>
  ArrayUnionSentinel(item) as unknown as FirestoreSchema.ArrayUnion<S>;

const ArrayRemoveSentinel = elementsSentinel(
  "ArrayRemove",
  fieldValue.isArrayRemove,
  fieldValue.arrayRemove,
);

/** @internal */
export const ArrayRemove = <S extends Schema.Top>(item: S): FirestoreSchema.ArrayRemove<S> =>
  ArrayRemoveSentinel(item) as unknown as FirestoreSchema.ArrayRemove<S>;

/** @internal */
export const ArrayOr = <S extends Schema.Top>(item: S): FirestoreSchema.ArrayOr<S> =>
  Schema.Union([Schema.Array(item), ArrayUnion(item), ArrayRemove(item)]);
