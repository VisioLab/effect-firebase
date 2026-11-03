/**
 * Firestore geopoints, independent of either SDK.
 *
 * Firestore stores a place on the globe as a latitude and a longitude, and
 * each SDK reads it back as its own `GeoPoint` class. This module owns a
 * portable version of that value, so a document schema works the same under
 * the Admin SDK and the client SDK.
 *
 * @see {@link FirestoreSchema.GeoPoint} for storing a `GeoPoint` in a document
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Equal, Inspectable, Option } from "effect";
import * as geoPoint from "./internal/geoPoint.ts";

const TypeId = geoPoint.TypeId;

/**
 * A place on the globe, stored the way Firestore stores it.
 *
 * Two geopoints are equal when their latitudes and longitudes are.
 *
 * @see {@link FirestoreSchema.GeoPoint} for the schema of this value
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface GeoPoint extends Equal.Equal, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
  /** Degrees north of the equator, between -90 and 90. */
  readonly latitude: number;
  /** Degrees east of the prime meridian, between -180 and 180. */
  readonly longitude: number;
}

/**
 * Checks whether `u` is a {@link GeoPoint} built by this module.
 *
 * An SDK's own `GeoPoint` is not one.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isGeoPoint: (u: unknown) => u is GeoPoint = geoPoint.isGeoPoint;

/**
 * Builds a geopoint from a latitude and a longitude, throwing when either is
 * out of range.
 *
 * **When to use**
 *
 * Use for coordinates known to be valid, such as constants. Use {@link make}
 * for coordinates you have not checked.
 *
 * **Details**
 *
 * Throws unless `latitude` is a number from -90 to 90 and `longitude` a number
 * from -180 to 180.
 *
 * @example Building a geopoint
 * ```ts
 * import { GeoPoint } from "@visiolab/effect-firebase/firestore";
 *
 * const berlin = GeoPoint.makeUnsafe(52.52, 13.405);
 * ```
 *
 * @see {@link make} for the same check returning an `Option`
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const makeUnsafe: (latitude: number, longitude: number) => GeoPoint = geoPoint.makeUnsafe;

/**
 * Builds a geopoint from a latitude and a longitude, or `None` when either is
 * out of range.
 *
 * **When to use**
 *
 * Use when the coordinates come from outside the program and may be invalid.
 *
 * **Details**
 *
 * Returns `None` unless `latitude` is a number from -90 to 90 and `longitude`
 * a number from -180 to 180.
 *
 * @example Building a geopoint from untrusted input
 * ```ts
 * import { GeoPoint } from "@visiolab/effect-firebase/firestore";
 *
 * GeoPoint.make(52.52, 13.405); // Option.some(...)
 * GeoPoint.make(91, 0); // Option.none()
 * ```
 *
 * @see {@link makeUnsafe} for the same check throwing instead
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: (latitude: number, longitude: number) => Option.Option<GeoPoint> = geoPoint.make;
