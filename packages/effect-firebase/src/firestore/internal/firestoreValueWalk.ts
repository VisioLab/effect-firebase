/**
 * The one walk over Firestore Values that the guard and both SDK mappings
 * share: the path to each value, the scalars, arrays and maps, and how a
 * value outside the union is reported. What differs per SDK is only how each
 * kind of value in {@link kinds} becomes the SDK's own, and back.
 */
import { Result } from "effect";
import { FirestoreError } from "../Firestore.ts";
import type * as FirestoreValue from "../FirestoreValue.ts";
import * as collection from "./collection.ts";
import * as documentPath from "./documentPath.ts";
import * as fieldValue from "./fieldValue.ts";
import * as geoPoint from "./geoPoint.ts";
import * as timestamp from "./timestamp.ts";

/** @internal */
export type FieldPath = ReadonlyArray<string | number>;

/** @internal */
export const formatFieldPath = (path: FieldPath): string =>
  path.length === 0
    ? "the document"
    : `"${path
        .map((key, i) => (typeof key === "number" ? `[${key}]` : i === 0 ? key : `.${key}`))
        .join("")}"`;

/**
 * The kinds of Firestore Value other than scalars, arrays and maps, each with
 * the guard that recognises it. Adding a kind here makes every SDK's
 * {@link Writer} name it too.
 */
const kinds = {
  bytes: (u: unknown): u is Uint8Array => u instanceof Uint8Array,
  timestamp: timestamp.isTimestamp,
  geoPoint: geoPoint.isGeoPoint,
  documentPath: documentPath.isDocumentPath,
  serverTimestamp: fieldValue.isServerTimestamp,
  increment: fieldValue.isIncrement,
  deleteField: fieldValue.isDeleteField,
  arrayUnion: fieldValue.isArrayUnion,
  arrayRemove: fieldValue.isArrayRemove,
} as const;

type Guarded<F> = F extends ((u: unknown) => u is infer A) ? A : never;

/**
 * Each kind of Firestore Value that is not a scalar, array or map, by name.
 *
 * @internal
 */
export type Kinds = { readonly [K in keyof typeof kinds]: Guarded<(typeof kinds)[K]> };

const kindNames = Object.keys(kinds) as ReadonlyArray<keyof Kinds>;

const kindOf = (u: object): keyof Kinds | undefined => kindNames.find((kind) => kinds[kind](u));

/**
 * Walks the value a kind holds, such as an array union's elements: `key` is
 * where `child` sits within it.
 *
 * @internal
 */
export type Walk = (child: unknown, key: string | number) => unknown;

/**
 * How one SDK writes each kind of Firestore Value that is not a scalar, array
 * or map.
 *
 * @internal
 */
export type Writer = {
  readonly [K in keyof Kinds]: (value: Kinds[K], walk: Walk) => unknown;
};

/**
 * How one SDK's values read back as Firestore Values. It hands back
 * `undefined` for a value it leaves to the walk - a scalar, array or map -
 * and calls `fail` for one of its own it cannot read.
 *
 * @internal
 */
export type Reader = (
  value: object,
  context: {
    readonly walk: (child: unknown, key: string | number) => FirestoreValue.FirestoreValue;
    readonly fail: (kind: string) => never;
  },
) => FirestoreValue.FirestoreValue | undefined;

/** A map: a plain object whose keys are all strings. */
const isMap = (u: object): u is Record<string, unknown> => {
  const proto = Object.getPrototypeOf(u);
  return (
    (proto === Object.prototype || proto === null) && Object.getOwnPropertySymbols(u).length === 0
  );
};

const describe = (u: object): string => {
  const name = (u.constructor as { readonly name?: string } | undefined)?.name;
  return name === undefined ? "an object with no prototype" : `a ${name}`;
};

/** A value outside the Firestore Value union, at `path`. */
class Outside {
  readonly kind: string;
  readonly value: unknown;
  readonly path: FieldPath;
  constructor(kind: string, value: unknown, path: FieldPath) {
    this.kind = kind;
    this.value = value;
    this.path = path;
  }
}

const unhandled: unique symbol = Symbol("unhandled");

/**
 * Walks `value`, handing every object to `visit` first and then walking
 * arrays and maps itself. Throws {@link Outside} at the first value that is
 * none of these, or that contains itself.
 */
const walk = (
  value: unknown,
  visit: (
    u: object,
    walk: (child: unknown, key: string | number) => unknown,
    fail: (kind: string) => never,
  ) => unknown,
): unknown => {
  const path: Array<string | number> = [];
  const ancestors = new Set<object>();
  const within = (child: unknown, key: string | number): unknown => {
    path.push(key);
    try {
      return go(child);
    } finally {
      path.pop();
    }
  };
  const go = (u: unknown): unknown => {
    switch (typeof u) {
      case "boolean":
      case "number":
      case "string":
        return u;
      case "object":
        break;
      default:
        throw new Outside(`a value of type ${typeof u}`, u, [...path]);
    }
    if (u === null) return u;
    const fail = (kind: string): never => {
      throw new Outside(kind, u, [...path]);
    };
    if (ancestors.has(u)) return fail("a value that contains itself");
    ancestors.add(u);
    try {
      const out = visit(u, within, fail);
      if (out !== unhandled) return out;
      if (Array.isArray(u)) return u.map((e, i) => within(e, i));
      if (isMap(u)) {
        const map: Record<string, unknown> = {};
        for (const key of Object.keys(u)) map[key] = within(u[key], key);
        return map;
      }
      return fail(describe(u));
    } finally {
      ancestors.delete(u);
    }
  };
  return go(value);
};

const write = (value: unknown, writer: Writer): unknown =>
  walk(value, (u, within) => {
    const kind = kindOf(u);
    return kind === undefined ? unhandled : writer[kind](u as never, within);
  });

const keep = <A>(value: A): A => value;

/** Builds nothing: walking with it only checks a value is a Firestore Value. */
const checker: Writer = {
  bytes: keep,
  timestamp: keep,
  geoPoint: keep,
  documentPath: keep,
  serverTimestamp: keep,
  increment: keep,
  deleteField: keep,
  arrayUnion: (u, within) => u.elements.forEach(within),
  arrayRemove: (u, within) => u.elements.forEach(within),
};

/** @internal */
export const isFirestoreValue = (u: unknown): u is FirestoreValue.FirestoreValue => {
  try {
    write(u, checker);
    return true;
  } catch (e) {
    if (e instanceof Outside) return false;
    throw e;
  }
};

/**
 * Writes each typed reference within `u` as the path Firestore stores, so a
 * reference held where no schema says how to write it - under
 * `Schema.Unknown` - is still a Firestore Value. Anything else is left for
 * {@link isFirestoreValue} to judge.
 *
 * @internal
 */
export const withReferencesAsPaths = (u: unknown): unknown => {
  if (isFirestoreValue(u)) return u;
  try {
    return walk(u, (v, within) => {
      if (collection.isDocumentReference(v)) return documentPath.makeUnchecked(v.path);
      if (fieldValue.isArrayUnion(v)) return fieldValue.arrayUnion(...v.elements.map(within));
      if (fieldValue.isArrayRemove(v)) return fieldValue.arrayRemove(...v.elements.map(within));
      return kindOf(v) === undefined ? unhandled : v;
    });
  } catch (e) {
    if (e instanceof Outside) return u;
    throw e;
  }
};

/**
 * Turns a Firestore Value into an SDK's own value through `writer`. A value
 * outside the union is a defect, since `toCodecFirestore` only ever encodes
 * Firestore Values.
 *
 * @internal
 */
export const toSdk = (value: FirestoreValue.FirestoreValue, writer: Writer): unknown => {
  try {
    return write(value, writer);
  } catch (e) {
    if (!(e instanceof Outside)) throw e;
    throw new globalThis.Error(
      `Cannot write ${e.kind} at ${formatFieldPath(e.path)}, which is not a Firestore Value`,
      { cause: e.value },
    );
  }
};

/**
 * Turns what an SDK read into a Firestore Value through `reader`, failing on
 * a value outside the union, such as a vector, and naming the field that
 * holds it.
 *
 * @internal
 */
export const fromSdk = (
  value: unknown,
  reader: Reader,
): Result.Result<FirestoreValue.FirestoreValue, FirestoreError> => {
  try {
    return Result.succeed(
      walk(value, (u, within, fail) => {
        const out = reader(u, {
          walk: within as (child: unknown, key: string | number) => FirestoreValue.FirestoreValue,
          fail,
        });
        return out === undefined ? unhandled : out;
      }) as FirestoreValue.FirestoreValue,
    );
  } catch (e) {
    if (!(e instanceof Outside)) throw e;
    return Result.fail(
      new FirestoreError({
        message: `Firestore holds ${e.kind} at ${formatFieldPath(e.path)}, which is not a Firestore Value`,
        code: undefined,
        cause: e.value,
      }),
    );
  }
};

/**
 * Reads what an SDK holds for the document at `path` as Firestore Values
 * through `reader`, keeping `undefined` - a document that is not there - as
 * it is.
 *
 * @internal
 */
export const readDocument = (
  path: string,
  data: unknown,
  reader: Reader,
): Result.Result<FirestoreValue.FirestoreValue | undefined, FirestoreError> =>
  data === undefined
    ? Result.succeed(undefined)
    : Result.mapError(
        fromSdk(data, reader),
        (error) =>
          new FirestoreError({
            message: `Failed to read the document "${path}": ${error.message}`,
            code: undefined,
            cause: error.cause,
          }),
      );
