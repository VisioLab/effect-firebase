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
 * The minimal shape of a Firestore geopoint, whoever built it.
 *
 * Both the Admin SDK and the web SDK hand back a `GeoPoint` carrying these two
 * fields, so this is the shape a document arrives in whichever one read it.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface GeoPointLike {
  /** Degrees north of the equator, between -90 and 90. */
  readonly latitude: number;
  /** Degrees east of the prime meridian, between -180 and 180. */
  readonly longitude: number;
}

/**
 * A place on the globe, held the way Firestore holds it.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface GeoPoint extends GeoPointLike, Equal.Equal, Inspectable.Inspectable {
  readonly [TypeId]: typeof TypeId;
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
 * Whether `u` is shaped like a Firestore geopoint and holds a place Firestore
 * can store.
 *
 * This is what makes a geopoint readable without depending on an SDK: an SDK's
 * own `GeoPoint` passes, because it carries the same two fields.
 *
 * @stability unstable
 * @category guards
 * @since 0.2.0
 */
export const isGeoPointLike: (u: unknown) => u is GeoPointLike = geoPoint.isGeoPointLike;

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

/**
 * Takes over a geopoint read through an SDK, leaving one of ours alone.
 *
 * Throws when either field is out of range.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const fromGeoPointLikeUnsafe: (like: GeoPointLike) => GeoPoint =
  geoPoint.fromGeoPointLikeUnsafe;
