/**
 * The Admin SDK's implementation of {@link FirestoreEncoder.FirestoreEncoder}.
 *
 * @stability unstable
 * @since 0.2.0
 */
import { Effect, Layer } from "effect";
import { FirestoreEncoder } from "@visiolab/effect-firebase/firestore/FirestoreEncoder";
import { FieldValue, GeoPoint, getFirestore, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import * as App from "../App.ts";

/**
 * Builds the values the Admin SDK writes into `firestore`.
 *
 * A reference is built against `firestore`, so it points into that database.
 * Every other value is the same whichever database it is written to.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make = (firestore: Firestore): FirestoreEncoder =>
  FirestoreEncoder.of({
    timestamp: ({ seconds, nanoseconds }) => new Timestamp(seconds, nanoseconds),
    geoPoint: ({ latitude, longitude }) => new GeoPoint(latitude, longitude),
    documentReference: (ref) => firestore.doc(ref.path),
    serverTimestamp: () => FieldValue.serverTimestamp(),
    increment: (by) => FieldValue.increment(by),
    deleteField: () => FieldValue.delete(),
    arrayUnion: (elements) => FieldValue.arrayUnion(...elements),
    arrayRemove: (elements) => FieldValue.arrayRemove(...elements),
  });

/**
 * A layer providing {@link make} for the default database of the
 * {@link App.App} in context.
 *
 * Building it cannot fail: `getFirestore` only throws on an app that was
 * already deleted, which is a wiring mistake and surfaces as a defect. To write
 * into a named database, build the encoder from that one instead:
 *
 * ```ts
 * Layer.succeed(FirestoreEncoder)(make(getFirestore(app, "my-database")));
 * ```
 *
 * @stability unstable
 * @category layers
 * @since 0.2.0
 */
export const layer: Layer.Layer<FirestoreEncoder, never, App.App> = Layer.effect(
  FirestoreEncoder,
  Effect.gen(function* () {
    const app = yield* App.App;
    // `getFirestore` memoizes the instance on the app itself, and deleting the
    // app terminates it, so there is nothing to release here.
    return make(getFirestore(app));
  }),
);
