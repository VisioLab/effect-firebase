import { Equal, Hash, Inspectable, Option, Predicate } from "effect";
import type * as GeoPoint from "../GeoPoint.ts";

/** @internal */
export const TypeId = "~@visiolab/effect-firebase/firestore/GeoPoint";

/** Kept apart from the guards below, which narrow a `number` to `never`. */
const inLatitudeRange = (n: number): boolean => Number.isFinite(n) && n >= -90 && n <= 90;

const inLongitudeRange = (n: number): boolean => Number.isFinite(n) && n >= -180 && n <= 180;

/** @internal */
export const isGeoPoint = (u: unknown): u is GeoPoint.GeoPoint =>
  Predicate.hasProperty(u, TypeId) && u[TypeId] === TypeId && isGeoPointLike(u);

/** @internal */
export const isGeoPointLike = (u: unknown): u is GeoPoint.GeoPointLike =>
  Predicate.hasProperty(u, "latitude") &&
  Predicate.hasProperty(u, "longitude") &&
  Predicate.isNumber(u.latitude) &&
  Predicate.isNumber(u.longitude) &&
  inLatitudeRange(u.latitude) &&
  inLongitudeRange(u.longitude);

const Proto: Omit<GeoPoint.GeoPoint, keyof GeoPoint.GeoPointLike> = {
  ...Inspectable.BaseProto,
  [TypeId]: TypeId,
  toJSON(this: GeoPoint.GeoPoint) {
    return { _id: "GeoPoint", latitude: this.latitude, longitude: this.longitude };
  },
  [Equal.symbol](this: GeoPoint.GeoPoint, that: unknown): boolean {
    return isGeoPoint(that) && this.latitude === that.latitude && this.longitude === that.longitude;
  },
  [Hash.symbol](this: GeoPoint.GeoPoint): number {
    return Hash.combine(Hash.number(this.latitude), Hash.number(this.longitude));
  },
};

const makeUnchecked = (latitude: number, longitude: number): GeoPoint.GeoPoint =>
  Object.assign(Object.create(Proto) as typeof Proto, { latitude, longitude });

/** @internal */
export const makeUnsafe = (latitude: number, longitude: number): GeoPoint.GeoPoint => {
  if (!inLatitudeRange(latitude)) {
    throw new Error(
      `Invalid Firestore geopoint: latitude must be a number between -90 and 90, got ${latitude}`,
    );
  }
  if (!inLongitudeRange(longitude)) {
    throw new Error(
      `Invalid Firestore geopoint: longitude must be a number between -180 and 180, got ${longitude}`,
    );
  }
  return makeUnchecked(latitude, longitude);
};

/** @internal */
export const make = (latitude: number, longitude: number): Option.Option<GeoPoint.GeoPoint> =>
  inLatitudeRange(latitude) && inLongitudeRange(longitude)
    ? Option.some(makeUnchecked(latitude, longitude))
    : Option.none();

/** @internal */
export const fromGeoPointLikeUnsafe = (like: GeoPoint.GeoPointLike): GeoPoint.GeoPoint =>
  isGeoPoint(like) ? like : makeUnsafe(like.latitude, like.longitude);
