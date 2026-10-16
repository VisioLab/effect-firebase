import {
  Array,
  DateTime,
  Effect,
  Equal,
  Schema,
  SchemaGetter,
  SchemaIssue,
  SchemaParser,
} from "effect";
import type * as FieldValue from "../FieldValue.ts";
import { FirestoreEncoder } from "../FirestoreEncoder.ts";
import type * as FirestoreSchema from "../FirestoreSchema.ts";
import type * as Timestamp_ from "../Timestamp.ts";
import * as fieldValue from "./fieldValue.ts";
import * as timestamp from "./timestamp.ts";

/** Accepts a timestamp in the shape Firestore hands back, whichever SDK read it. */
const TimestampLikeValue = Schema.declare<Timestamp_.TimestampLike>(timestamp.isTimestampLike, {
  representation: { id: "@visiolab/effect-firebase/firestore/Timestamp/Like", payload: null },
  expected: "a Firestore timestamp",
  toEquivalence: () => (self, that) =>
    self.seconds === that.seconds && self.nanoseconds === that.nanoseconds,
});

const TimestampValue = Schema.declare<Timestamp_.Timestamp>(timestamp.isTimestamp, {
  representation: { id: "@visiolab/effect-firebase/firestore/Timestamp", payload: null },
  expected: "a Firestore Timestamp",
  toEquivalence: () => Equal.equals,
});

/** @internal */
export const Timestamp: FirestoreSchema.Timestamp = TimestampLikeValue.pipe(
  Schema.decodeTo(TimestampValue, {
    decode: SchemaGetter.transform(timestamp.fromTimestampLikeUnsafe),
    encode: SchemaGetter.transformEffect((value: Timestamp_.Timestamp) =>
      Effect.map(FirestoreEncoder, (encoder) => encoder.timestamp(value)),
    ),
  }),
);

/** @internal */
export const DateTimeUtcFromTimestamp: FirestoreSchema.DateTimeUtcFromTimestamp =
  TimestampLikeValue.pipe(
    Schema.decodeTo(Schema.DateTimeUtc, {
      decode: SchemaGetter.transform((like: Timestamp_.TimestampLike) =>
        timestamp.toDateTime(timestamp.fromTimestampLikeUnsafe(like)),
      ),
      encode: SchemaGetter.transformEffect((dateTime: DateTime.Utc) =>
        Effect.map(FirestoreEncoder, (encoder) =>
          encoder.timestamp(timestamp.fromDateTimeUnsafe(dateTime)),
        ),
      ),
    }),
  );

const ServerTimestampValue = Schema.declare<FieldValue.ServerTimestamp>(
  fieldValue.isServerTimestamp,
  {
    representation: {
      id: "@visiolab/effect-firebase/firestore/FieldValue/ServerTimestamp",
      payload: null,
    },
    expected: "a server timestamp",
  },
);

const ServerTimestampSentinel = Schema.Unknown.pipe(
  Schema.decodeTo(ServerTimestampValue, {
    decode: SchemaGetter.forbidden(
      () => "A server timestamp is only ever written, never read back",
    ),
    encode: SchemaGetter.transformEffect(() =>
      Effect.map(FirestoreEncoder, (encoder) => encoder.serverTimestamp()),
    ),
  }),
);

/** @internal */
export const ServerTimestamp: FirestoreSchema.ServerTimestamp = ServerTimestampSentinel.pipe(
  Schema.withConstructorDefault(Effect.succeed(fieldValue.serverTimestamp)),
);

/** @internal */
export const ServerTimestampOr = <
  S extends Schema.Codec<unknown, Timestamp_.TimestampLike, unknown, unknown>,
>(
  schema: S,
): FirestoreSchema.ServerTimestampOr<S> => Schema.Union([schema, ServerTimestamp]);

const IncrementValue = Schema.declare<FieldValue.Increment>(fieldValue.isIncrement, {
  representation: {
    id: "@visiolab/effect-firebase/firestore/FieldValue/Increment",
    payload: null,
  },
  expected: "an increment",
  toEquivalence: () => Equal.equals,
});

/** @internal */
export const Increment: FirestoreSchema.Increment = Schema.Unknown.pipe(
  Schema.decodeTo(IncrementValue, {
    decode: SchemaGetter.forbidden(() => "An increment is only ever written, never read back"),
    encode: SchemaGetter.transformEffect((value: FieldValue.Increment) =>
      Effect.map(FirestoreEncoder, (encoder) => encoder.increment(value.by)),
    ),
  }),
);

/** @internal */
export const IncrementOr = <S extends Schema.Codec<unknown, number, unknown, unknown>>(
  schema: S,
): FirestoreSchema.IncrementOr<S> => Schema.Union([schema, Increment]);

const DeleteFieldValue = Schema.declare<FieldValue.DeleteField>(fieldValue.isDeleteField, {
  representation: {
    id: "@visiolab/effect-firebase/firestore/FieldValue/DeleteField",
    payload: null,
  },
  expected: "a field deletion",
});

/** @internal */
export const DeleteField: FirestoreSchema.DeleteField = Schema.Unknown.pipe(
  Schema.decodeTo(DeleteFieldValue, {
    decode: SchemaGetter.forbidden(() => "A field deletion is only ever written, never read back"),
    encode: SchemaGetter.transformEffect(() =>
      Effect.map(FirestoreEncoder, (encoder) => encoder.deleteField()),
    ),
  }),
);

/** @internal */
export const DeleteFieldOr = <S extends Schema.Top>(schema: S): FirestoreSchema.DeleteFieldOr<S> =>
  Schema.Union([DeleteField, schema]);

/**
 * Declares a sentinel that carries elements, each of them run through `item` -
 * decoded on the way in and encoded on the way out, as `Schema.Option` does
 * with what it holds - so a timestamp among them reaches the encoder as the
 * SDK's own.
 */
const elementsValue =
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
        toEquivalence: ([item]) => {
          const elements = Array.makeEquivalence(item);
          return (self, that) => elements(self.elements, that.elements);
        },
      },
    );

const ArrayUnionValue = elementsValue("ArrayUnion", fieldValue.isArrayUnion, fieldValue.arrayUnion);

/** @internal */
export const ArrayUnion = <S extends Schema.Top>(item: S): FirestoreSchema.ArrayUnion<S> =>
  Schema.Unknown.pipe(
    Schema.decodeTo(ArrayUnionValue(item), {
      decode: SchemaGetter.forbidden(() => "An array union is only ever written, never read back"),
      encode: SchemaGetter.transformEffect((value: FieldValue.ArrayUnion<unknown>) =>
        Effect.map(FirestoreEncoder, (encoder) => encoder.arrayUnion(value.elements)),
      ),
    }),
  );

const ArrayRemoveValue = elementsValue(
  "ArrayRemove",
  fieldValue.isArrayRemove,
  fieldValue.arrayRemove,
);

/** @internal */
export const ArrayRemove = <S extends Schema.Top>(item: S): FirestoreSchema.ArrayRemove<S> =>
  Schema.Unknown.pipe(
    Schema.decodeTo(ArrayRemoveValue(item), {
      decode: SchemaGetter.forbidden(
        () => "An array removal is only ever written, never read back",
      ),
      encode: SchemaGetter.transformEffect((value: FieldValue.ArrayRemove<unknown>) =>
        Effect.map(FirestoreEncoder, (encoder) => encoder.arrayRemove(value.elements)),
      ),
    }),
  );

/** @internal */
export const ArrayOr = <S extends Schema.Top>(item: S): FirestoreSchema.ArrayOr<S> =>
  Schema.Union([Schema.Array(item), ArrayUnion(item), ArrayRemove(item)]);
