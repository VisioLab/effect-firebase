/**
 * Firestore geopoints.
 *
 * Firestore stores a place on the globe as a latitude and a longitude, and
 * hands it back as a `GeoPoint` belonging to whichever SDK read it. This module
 * owns that value without depending on an SDK, so a document schema stays
 * portable between them.
 *
 * The codec that reads and writes it lives in `Firestore/FirestoreSchema`,
 * which keeps this module free of the schema machinery.
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Equal, Inspectable, Option } from "effect";
import * as geoPoint from "./internal/geoPoint.ts";

const TypeId = geoPoint.TypeId;

/**
 * A place on the globe, held the way Firestore holds it.
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
 * Whether `u` is a {@link GeoPoint} this module built.
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
 * @see {@link make} for the same check without the throw.
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
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const make: (latitude: number, longitude: number) => Option.Option<GeoPoint> = geoPoint.make;
