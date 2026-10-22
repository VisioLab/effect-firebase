/**
 * Apart from the other Firestore schemas, so that deriving `toCodecFirestore`,
 * which writes instants as timestamps, need not import the schemas that
 * derive it in turn.
 */
import { Effect, Equal, Schema, SchemaGetter, SchemaIssue } from "effect";
import type * as FirestoreSchema from "../FirestoreSchema.ts";
import type * as Timestamp_ from "../Timestamp.ts";
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
