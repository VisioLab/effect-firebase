/**
 * The Admin SDK's side of Firestore Values: the two-way mapping between the
 * portable values `toCodecFirestore` encodes a model to and the values the
 * Admin SDK reads and writes.
 *
 * {@link AdminFirestore} applies it on every read and write. It is exported for
 * writes made through the raw SDK, so the library's models can be used for
 * those too:
 *
 * ```ts
 * const encoded = Schema.encodeSync(toCodecFirestore(Post))(post)
 * await firestore.doc("posts/hello").set(AdminFirestoreValue.toAdmin(encoded, firestore))
 * ```
 *
 * @stability unstable
 * @since 0.2.0
 */
import { Option, Predicate, Result } from "effect";
import * as Collection from "@visiolab/effect-firebase/firestore/Collection";
import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
import { FirestoreError } from "@visiolab/effect-firebase/firestore/Firestore";
import type { FirestoreValue } from "@visiolab/effect-firebase/firestore/FirestoreValue";
import * as GeoPoint from "@visiolab/effect-firebase/firestore/GeoPoint";
import * as Timestamp from "@visiolab/effect-firebase/firestore/Timestamp";
import * as Admin from "firebase-admin/firestore";

const isPlainObject = (u: object): u is Record<string, unknown> => {
  const proto = Object.getPrototypeOf(u);
  return proto === Object.prototype || proto === null;
};

const mapValues = (
  u: Record<string, unknown>,
  f: (value: unknown, key: string) => unknown,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(u)) out[key] = f(u[key], key);
  return out;
};

/**
 * Turns a Firestore Value into the value the Admin SDK writes into
 * `firestore`.
 *
 * A reference is built against `firestore`, so it points into that database.
 * Every other value is the same whichever database it is written to. The keys
 * of a map are kept as they are, so the dotted field paths of an update stay
 * field paths.
 *
 * A value that is already the Admin SDK's own is left as it is.
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const toAdmin = (value: FirestoreValue, firestore: Admin.Firestore): unknown => {
  const go = (u: unknown): unknown => {
    if (typeof u !== "object" || u === null || u instanceof Uint8Array) return u;
    if (Timestamp.isTimestamp(u)) return new Admin.Timestamp(u.seconds, u.nanoseconds);
    if (GeoPoint.isGeoPoint(u)) return new Admin.GeoPoint(u.latitude, u.longitude);
    if (Collection.isDocumentReference(u)) return firestore.doc(u.path);
    if (FieldValue.isServerTimestamp(u)) return Admin.FieldValue.serverTimestamp();
    if (FieldValue.isIncrement(u)) return Admin.FieldValue.increment(u.by);
    if (FieldValue.isDeleteField(u)) return Admin.FieldValue.delete();
    if (FieldValue.isArrayUnion(u)) return Admin.FieldValue.arrayUnion(...u.elements.map(go));
    if (FieldValue.isArrayRemove(u)) return Admin.FieldValue.arrayRemove(...u.elements.map(go));
    if (Array.isArray(u)) return u.map(go);
    if (isPlainObject(u)) return mapValues(u, go);
    // Not a Firestore Value, so nothing the library encodes reaches here. What
    // does - an SDK value handed through `Schema.Any` - is the SDK's to judge.
    return u;
  };
  return go(value);
};

/** The sentinels' names, as the Admin SDK keeps them. */
interface AdminSentinel {
  readonly methodName?: string;
  readonly operand?: number;
  readonly elements?: ReadonlyArray<unknown>;
}

const describe = (u: object): string => u.constructor?.name ?? "an object with no prototype";

const formatPath = (path: ReadonlyArray<string | number>): string =>
  path.length === 0
    ? "the document"
    : `"${path
        .map((key, i) => (typeof key === "number" ? `[${key}]` : i === 0 ? key : `.${key}`))
        .join("")}"`;

/**
 * Turns a value the Admin SDK read into a Firestore Value.
 *
 * Its `Timestamp`, `GeoPoint` and bytes become their portable forms, and its
 * sentinels the portable sentinels. It fails on a value outside the Firestore
 * Value union, such as a vector, naming the field that holds it.
 *
 * A `DocumentReference` becomes the portable reference at its path, built
 * with `Collection.fromPathUntyped`, since what was read does not name the
 * collection it was defined through. `FirestoreSchema.DocumentReference`
 * turns it into a reference into the collection it names.
 *
 * @stability unstable
 * @category conversions
 * @since 0.2.0
 */
export const fromAdmin = (value: unknown): Result.Result<FirestoreValue, FirestoreError> => {
  const path: Array<string | number> = [];
  let failure: FirestoreError | undefined;
  const fail = (u: unknown, kind: string): undefined => {
    failure = new FirestoreError({
      message: `Firestore holds ${kind} at ${formatPath(path)}, which is not a Firestore Value`,
      code: undefined,
      cause: u,
    });
    return undefined;
  };
  const within = <A>(key: string | number, f: () => A): A => {
    path.push(key);
    try {
      return f();
    } finally {
      path.pop();
    }
  };
  const go = (u: unknown): unknown => {
    if (failure !== undefined) return undefined;
    switch (typeof u) {
      case "boolean":
      case "number":
      case "string":
        return u;
      case "object":
        break;
      default:
        return fail(u, `a value of type ${typeof u}`);
    }
    if (u === null) return u;
    if (u instanceof Uint8Array) {
      // The Admin SDK reads bytes as a Node `Buffer`.
      return u.constructor === Uint8Array ? u : new Uint8Array(u.buffer, u.byteOffset, u.length);
    }
    if (u instanceof Admin.Timestamp) return Timestamp.makeUnsafe(u.seconds, u.nanoseconds);
    if (u instanceof Admin.GeoPoint) return GeoPoint.makeUnsafe(u.latitude, u.longitude);
    if (u instanceof Admin.DocumentReference) {
      const ref = Collection.fromPathUntyped(u.path);
      return Option.isSome(ref) ? ref.value : fail(u, `a reference to "${u.path}"`);
    }
    if (u instanceof Admin.FieldValue) {
      const sentinel = u as AdminSentinel;
      switch (sentinel.methodName) {
        case "FieldValue.serverTimestamp":
          return FieldValue.serverTimestamp;
        case "FieldValue.delete":
          return FieldValue.deleteField;
        case "FieldValue.increment":
          if (Predicate.isNumber(sentinel.operand)) return FieldValue.increment(sentinel.operand);
          break;
        case "FieldValue.arrayUnion":
          if (Array.isArray(sentinel.elements))
            return FieldValue.arrayUnion(
              ...sentinel.elements.map((e, i) => within(i, () => go(e))),
            );
          break;
        case "FieldValue.arrayRemove":
          if (Array.isArray(sentinel.elements))
            return FieldValue.arrayRemove(
              ...sentinel.elements.map((e, i) => within(i, () => go(e))),
            );
          break;
      }
      return fail(u, `the sentinel ${sentinel.methodName ?? describe(u)}`);
    }
    if (Array.isArray(u)) return u.map((e, i) => within(i, () => go(e)));
    if (isPlainObject(u)) return mapValues(u, (v, key) => within(key, () => go(v)));
    return fail(u, `a ${describe(u)}`);
  };
  const out = go(value);
  return failure === undefined ? Result.succeed(out as FirestoreValue) : Result.fail(failure);
};
