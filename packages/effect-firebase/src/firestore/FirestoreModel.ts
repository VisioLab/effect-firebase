/**
 * Document schemas with one shape per operation.
 *
 * A document is read in one shape and written in two others. The id lives in
 * the path rather than in the data, a `createdAt` the server fills in is read
 * back as a timestamp but written as a sentinel, and an update is a map of the
 * fields that change rather than a whole document.
 *
 * Writing three schemas by hand means keeping three schemas in step. This
 * module takes one field declaration and derives all three from it, over
 * `VariantSchema` - the same machinery `effect/schema`'s `Model` is built on,
 * with the variants a database of documents needs rather than the ones a
 * database of rows does.
 *
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreModel, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   displayName: Schema.String,
 *   signupSource: FirestoreModel.Immutable(Schema.String),
 *   createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
 * }) {}
 *
 * User                 // what a snapshot decodes into
 * User.create          // what `set` writes
 * User.update          // what `update` writes, whatever the document holds
 * User.updateUnchecked // what `update` writes, where the caller knows what it holds
 * ```
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Schema, SchemaAST, Struct as Struct_ } from "effect";
import type { VariantSchema } from "effect/schema";
import type * as FirestoreSchema from "./FirestoreSchema.ts";
import * as firestoreModel from "./internal/firestoreModel.ts";
import type * as Patch from "./Patch.ts";

/**
 * The shapes a document is read and written in.
 *
 * - `read` is what `snapshot.data()` decodes into.
 * - `create` is what `set` writes, which is a whole document.
 * - `update` is what `update` writes, which is the fields that change.
 *
 * `read` is the default, so the schema itself is the one a document is read
 * through and the write shapes hang off it.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Variant = "read" | "create" | "update";

/**
 * Declares a field that is a different schema in different variants.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const Field = firestoreModel.Field;

/**
 * Declares a field that only appears in the named variants.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const FieldOnly = firestoreModel.FieldOnly;

/**
 * Declares a field that appears in every variant but the named ones.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const FieldExcept = firestoreModel.FieldExcept;

/**
 * Declares fields without building a class - a struct - for nesting inside a
 * document or sharing between several.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const Struct = firestoreModel.Struct;

/**
 * Rewrites the schemas of a field, variant by variant.
 *
 * @stability unstable
 * @category transforming
 * @since 0.2.0
 */
export const fieldEvolve = firestoreModel.fieldEvolve;

/**
 * Pulls one variant out of a struct as a plain schema.
 *
 * Note that the `update` variant this hands back is the one the fields declare,
 * which is to say it is neither made partial nor flattened into paths the way
 * {@link Class} makes it.
 *
 * @stability unstable
 * @category converting
 * @since 0.2.0
 */
export const extract = firestoreModel.extract;

/**
 * The field definitions a class or struct was built from.
 *
 * @stability unstable
 * @category getters
 * @since 0.2.0
 */
export const fields: <A extends VariantSchema.Struct<any>>(
  self: A,
) => A[typeof VariantSchema.TypeId] = firestoreModel.fields;

/**
 * Any document schema, whatever it holds.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Any = Schema.Top & {
  readonly fields: Schema.Struct.Fields;
  readonly create: Schema.Top;
  readonly update: Schema.Top;
  readonly updateUnchecked: Schema.Top;
};

const RecordTypeId = firestoreModel.RecordTypeId;

const UnionTypeId = firestoreModel.UnionTypeId;

/**
 * Anything a field is declared as: a schema, a field, a struct or a
 * {@link Record}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Value = VariantSchema.Field<any> | VariantSchema.Struct<any> | Schema.Top;

/** The schema a field is written through in `V`, or `never` where it is not. */
type VariantSchemaOf<F, V extends "create" | "update"> =
  F extends VariantSchema.Field<infer S>
    ? V extends keyof S
      ? S[V] extends Schema.Top
        ? S[V]
        : never
      : never
    : F extends Schema.Top
      ? F
      : never;

/** The schema a field is updated through, or `never` where it cannot be. */
type UpdateSchema<F> = VariantSchemaOf<F, "update">;

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (
  u: infer I,
) => void
  ? I
  : never;

/** The schema `S` is made from, where it is made an optional key. */
type WithoutOptionalKey<S extends Schema.Top> =
  S extends Schema.optionalKey<infer X extends Schema.Top> ? X : S;

/** The keys out of `K` that are known up front, which a Record holds every one of. */
type KnownKeys<K> = K extends PropertyKey
  ? {} extends { readonly [_ in K]: unknown }
    ? never
    : K
  : never;

/** Whether a Record keyed by `K` holds keys only the data names. */
type IsOpen<K extends Schema.Record.Key> = [Exclude<K["Type"], KnownKeys<K["Type"]>>] extends [
  never,
]
  ? false
  : true;

/** The schema `V` is declared as in `Variant`, or `never` where it has none. */
type ValueSchema<V, Variant extends "read" | "create"> =
  V extends VariantSchema.Struct<any>
    ? VariantSchema.Extract<Variant, V>
    : V extends VariantSchema.Field<infer S>
      ? Variant extends keyof S
        ? S[Variant] extends Schema.Top
          ? S[Variant]
          : never
        : never
      : V extends Schema.Top
        ? V
        : never;

/** A Record of `S` keyed by `K`, as a document holds it. */
type RecordSchema<K extends Schema.Record.Key, S extends Schema.Top> = Schema.$Record<
  K,
  IsOpen<K> extends true ? WithoutOptionalKey<S> : S
>;

/** Any field made {@link Optional}, whatever it holds. */
type AnyOptional = { readonly "~optionality": "optional"; readonly field: Value };

/** Whether a field was made {@link Optional}. */
type IsOptional<F> = F extends AnyOptional ? true : false;

/** What a field was made {@link Optional} of, or the field itself where it was not. */
type Unwrap<F> = F extends AnyOptional ? F["field"] : F;

/** The key and the value of a Record a field is, or `never` where it is none. */
type RecordOf<F> = RecordParts<Unwrap<F>>;

/** The key and the value a Record field carries, or `never` where it is none. */
type RecordParts<F> = F extends {
  readonly [RecordTypeId]: {
    readonly key: infer K extends Schema.Record.Key;
    readonly value: infer V extends Value;
  };
}
  ? { readonly key: K; readonly value: V }
  : never;

/** Whether `V` is something an update reaches into: a struct or a Record. */
type IsNode<V> =
  Unwrap<V> extends
    | VariantSchema.Struct<any>
    | { readonly [RecordTypeId]: any }
    | { readonly [UnionTypeId]: any }
    ? true
    : false;

/** Whether an update writes anything into a Record of `V`, at any depth. */
type IsWritable<V extends Value> = [RecordOf<V>] extends [never]
  ? [UnionOf<V>] extends [never]
    ? IsNode<V> extends true
      ? true
      : [UpdateSchema<V>] extends [never]
        ? false
        : true
    : IsUnionWritable<UnionOf<V>, IsOptional<V>>
  : IsWritable<RecordOf<V>["value"]>;

/**
 * The fields of a Record at the keys out of `Keys` known up front, as a struct
 * holds them: decoded for its patch, encoded for its paths.
 */
type KnownFields<Keys, V extends Value> = {
  readonly [_ in KnownKeys<Keys> & string]: V;
};

/** What a key of a Record only the data names takes, which may be missing. */
type EntryUpdate<V extends Value, Mode extends UpdateMode> =
  Unwrap<V> extends VariantSchema.Struct<infer G>
    ? StructTakes<G, true, Mode>
    : [UnionOf<V>] extends [never]
      ? EntryValueUpdate<V, Mode>
      : UnionTakes<UnionOf<V>, true>;

/** What a key of a Record only the data names takes, where it is no struct or union. */
type EntryValueUpdate<V extends Value, Mode extends UpdateMode> = [RecordOf<V>] extends [never]
  ? FirestoreSchema.DeleteFieldOr<WithoutOptionalKey<UpdateSchema<V>>>
  : RecordTakes<RecordOf<V>["key"], RecordOf<V>["value"], true, Mode>;

/** The patch of a Record: key by key. */
type RecordPatch<K extends Schema.Record.Key, V extends Value, Mode extends UpdateMode> =
  IsOpen<K> extends true
    ? Schema.$Record<Schema.toType<K>, EntryUpdate<V, Mode>>
    : Schema.Struct<UpdateFields<KnownFields<K["Type"], V>, Mode>>;

/**
 * What a Record takes in `Mode`. One keyed by keys only the data names is
 * patched even where it may be missing, since every key of it may be missing
 * as well.
 */
type RecordTakes<
  K extends Schema.Record.Key,
  V extends Value,
  Optional extends boolean,
  Mode extends UpdateMode,
> = Schema.Union<
  readonly [
    ...(Optional extends true
      ? Mode extends "unchecked"
        ? [RecordPatch<K, V, Mode>]
        : IsOpen<K> extends true
          ? [RecordPatch<K, V, Mode>]
          : []
      : [RecordPatch<K, V, Mode>]),
    ...(IsReplaceable<{ readonly _: V }> extends true
      ? [ReplaceSchema<RecordSchema<K, ValueSchema<V, "create">>>]
      : []),
    ...(Optional extends true ? [FirestoreSchema.DeleteField] : []),
  ]
>;

/** The schemas written anywhere at or below a key of a Record only the data names. */
type EntryPaths<V extends Value, Mode extends UpdateMode> = WithoutOptionalKey<
  Extract<
    UpdatePaths<{ readonly _: AsEntry<V> }, Mode>[keyof UpdatePaths<
      { readonly _: AsEntry<V> },
      Mode
    >],
    Schema.Top
  >
>;

/** `V` as a key of a Record only the data names, which may be missing. */
type AsEntry<V extends Value> =
  IsNode<V> extends true
    ? V extends AnyOptional
      ? V
      : Optional<V>
    : VariantSchema.Field<{
        readonly update: FirestoreSchema.DeleteFieldOr<WithoutOptionalKey<UpdateSchema<V>>>;
      }>;

/** The paths a Record at `Path` is written at. */
type RecordPaths<
  K extends Schema.Record.Key,
  V extends Value,
  Optional extends boolean,
  Mode extends UpdateMode,
  Path extends string,
> =
  IsWritable<V> extends false
    ? {}
    : (Optional extends true
        ? {
            readonly [_ in Path]: Schema.optionalKey<
              IsReplaceable<{ readonly _: V }> extends true
                ? FirestoreSchema.DeleteFieldOr<RecordSchema<K, ValueSchema<V, "create">>>
                : FirestoreSchema.DeleteField
            >;
          }
        : IsReplaceable<{ readonly _: V }> extends true
          ? { readonly [_ in Path]: Schema.optionalKey<RecordSchema<K, ValueSchema<V, "create">>> }
          : {}) &
        (IsOpen<K> extends true
          ? { readonly [_ in `${Path}.${string}`]: EntryPaths<V, Mode> }
          : UpdatePaths<KnownFields<K["Encoded"], V>, Mode, `${Path}.`>);

/** The paths a struct at `Path` is written at. */
type StructPaths<
  Fields extends VariantSchema.Struct.Fields,
  Optional extends boolean,
  Mode extends UpdateMode,
  Path extends string,
> = (Optional extends true
  ? {
      readonly [_ in Path]: Schema.optionalKey<
        IsReplaceable<Fields> extends true
          ? FirestoreSchema.DeleteFieldOr<WholeStruct<Fields>>
          : FirestoreSchema.DeleteField
      >;
    }
  : IsReplaceable<Fields> extends true
    ? { readonly [_ in Path]: Schema.optionalKey<WholeStruct<Fields>> }
    : {}) &
  UpdatePaths<Fields, Mode, `${Path}.`>;

/**
 * Which patches an update takes.
 *
 * - `checked` takes only the patches that leave any document it may be
 *   written to readable. An {@link Optional} struct is written whole with
 *   {@link Patch.replace} or removed, and never patched: a patch written into
 *   a struct the document goes without would create it holding only what the
 *   patch carried.
 * - `unchecked` takes a patch into an {@link Optional} struct as well, which is
 *   only right where the struct is known to be there.
 *
 * They differ only in which patches they take, and only at an
 * {@link Optional} struct: a patch both take is written the same by both. What
 * a field takes, and the paths it is written at, are the same in both.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type UpdateMode = "checked" | "unchecked";

/** The fields of the struct a field reaches into, or `never` if it is none. */
type StructOf<F> = Unwrap<F> extends VariantSchema.Struct<infer G> ? G : never;

/**
 * Whether a struct may be written whole by an update: only where every field it
 * holds, at any depth, is written both by `set`, whose shape a replacement
 * takes, and by an update.
 */
type IsReplaceable<Fields extends VariantSchema.Struct.Fields> = false extends {
  [K in keyof Fields]: [UnionOf<Fields[K]>] extends [never]
    ? FieldIsReplaceable<Fields[K]>
    : AreReplaceable<UnionOf<Fields[K]>>;
}[keyof Fields]
  ? false
  : true;

/** Whether a field that is no union may be written whole by an update. */
type FieldIsReplaceable<F> = [RecordOf<F>] extends [never]
  ? [StructOf<F>] extends [never]
    ? [UpdateSchema<F>] extends [never]
      ? false
      : [VariantSchemaOf<F, "create">] extends [never]
        ? false
        : true
    : IsReplaceable<StructOf<F>>
  : IsWritable<RecordOf<F>["value"]> extends true
    ? IsReplaceable<{ readonly _: RecordOf<F>["value"] }>
    : false;

/** The shape a struct is written whole in, as `set` would write it. */
type WholeStruct<Fields extends VariantSchema.Struct.Fields> = VariantSchema.Extract<
  "create",
  VariantSchema.Struct<Fields>
>;

/**
 * The schema of a {@link Patch.replace} of a struct written whole as `S`. It is
 * made from what `S` is made from, so the constructor defaults of the struct
 * are filled in.
 */
interface ReplaceSchema<S extends Schema.Top> extends Schema.Bottom<
  Patch.Replace<S["Type"]>,
  Patch.Replace<S["Type"]>,
  never,
  never,
  SchemaAST.Declaration,
  ReplaceSchema<S>,
  Patch.Replace<S["~type.make.in"]>
> {}

/** What a struct takes in `Mode`, as a field of the struct it sits in. */
type StructUpdate<
  Fields extends VariantSchema.Struct.Fields,
  Optional extends boolean,
  Mode extends UpdateMode,
> = Schema.optionalKey<StructTakes<Fields, Optional, Mode>>;

/** What a struct takes in `Mode`. */
type StructTakes<
  Fields extends VariantSchema.Struct.Fields,
  Optional extends boolean,
  Mode extends UpdateMode,
> = Schema.Union<
  readonly [
    ...(Optional extends true
      ? Mode extends "unchecked"
        ? [Schema.Struct<UpdateFields<Fields, Mode>>]
        : []
      : [Schema.Struct<UpdateFields<Fields, Mode>>]),
    ...(IsReplaceable<Fields> extends true ? [ReplaceSchema<WholeStruct<Fields>>] : []),
    ...(Optional extends true ? [FirestoreSchema.DeleteField] : []),
  ]
>;

/**
 * The fields of an update in `Mode`: every one that may change, each of them
 * optional.
 *
 * A struct every document holds takes a patch of its own, and an
 * {@link Optional} struct takes the removal, and a patch only under
 * `unchecked` - see {@link UpdateMode}. Either takes {@link Patch.replace}
 * where an update writes every field it holds.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type UpdateFields<
  Fields extends VariantSchema.Struct.Fields,
  Mode extends UpdateMode = "checked",
> = {
  readonly [
    K in keyof Fields as FieldUpdate<Fields[K], Mode> extends never ? never : K
  ]: FieldUpdate<Fields[K], Mode>;
};

/** What a field takes in an update in `Mode`, or `never` where it takes nothing. */
type FieldUpdate<F, Mode extends UpdateMode> =
  Unwrap<F> extends VariantSchema.Struct<infer G>
    ? StructUpdate<G, IsOptional<F>, Mode>
    : [UnionOf<F>] extends [never]
      ? ValueUpdate<F, Mode>
      : UnionUpdate<UnionOf<F>, IsOptional<F>>;

/** What a field that is no struct or union takes in an update in `Mode`. */
type ValueUpdate<F, Mode extends UpdateMode> = [RecordOf<F>] extends [never]
  ? [UpdateSchema<F>] extends [never]
    ? never
    : Schema.optionalKey<UpdateSchema<F>>
  : RecordUpdate<RecordOf<F>, IsOptional<F>, Mode>;

/**
 * The services the key of each Record an update writes into takes to encode,
 * which an update encodes every key it writes at with.
 */
type KeyServices<Fields extends VariantSchema.Struct.Fields> = {
  [K in keyof Fields]: FieldKeyServices<Fields[K]>;
}[keyof Fields];

/** The services the keys of the Records a field holds take to encode. */
type FieldKeyServices<F> =
  Unwrap<F> extends VariantSchema.Struct<infer G>
    ? KeyServices<G>
    : [RecordOf<F>] extends [never]
      ? never
      : IsWritable<RecordOf<F>["value"]> extends true
        ? RecordOf<F>["key"]["EncodingServices"] | FieldKeyServices<RecordOf<F>["value"]>
        : never;

/** What a Record takes as a field of the struct it sits in. */
type RecordUpdate<
  P extends { readonly key: Schema.Record.Key; readonly value: Value },
  Optional extends boolean,
  Mode extends UpdateMode,
> =
  IsWritable<P["value"]> extends true
    ? Schema.optionalKey<RecordTakes<P["key"], P["value"], Optional, Mode>>
    : never;

/**
 * The fields an update is written as: one optional key per path it can write
 * at.
 *
 * A struct's own key takes the struct written whole, where an update writes
 * every field it holds, and the removal, where it is {@link Optional}. Where
 * it takes neither, it has no key of its own, and is only written field by
 * field.
 *
 * The paths are the same in either {@link UpdateMode}, which only tells apart
 * the patches an update takes, not where it writes them.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type UpdatePaths<
  Fields extends VariantSchema.Struct.Fields,
  Mode extends UpdateMode = "checked",
  Prefix extends string = "",
> = Struct_.Simplify<
  UnionToIntersection<
    {
      [K in keyof Fields & string]: Unwrap<Fields[K]> extends VariantSchema.Struct<infer G>
        ? StructPaths<G, IsOptional<Fields[K]>, Mode, `${Prefix}${K}`>
        : [UnionOf<Fields[K]>] extends [never]
          ? ValuePaths<Fields[K], Mode, `${Prefix}${K}`>
          : UnionPaths<UnionOf<Fields[K]>, IsOptional<Fields[K]>, `${Prefix}${K}`>;
    }[keyof Fields & string]
  > & {}
>;

/** The paths a field that is no struct or union is written at. */
type ValuePaths<F, Mode extends UpdateMode, Path extends string> = [RecordOf<F>] extends [never]
  ? [UpdateSchema<F>] extends [never]
    ? {}
    : { readonly [_ in Path]: Schema.optionalKey<UpdateSchema<F>> }
  : RecordPaths<RecordOf<F>["key"], RecordOf<F>["value"], IsOptional<F>, Mode, Path>;

/**
 * The `update` variant of a set of fields, taking the patches `Mode` allows.
 *
 * It is handed a nested partial - the fields that change, a struct carrying
 * only those of its own that do - and writes each of them at its path, so
 * `{ address: { city } }` becomes `{ "address.city": city }`. That is what
 * makes it a merge rather than a replacement: Firestore merges an update at
 * the top level only, and replaces a map it is handed as a value, but a path
 * counts as the top level and leaves the rest of the map as it is. It is also
 * what lets a sentinel sit at any depth, since Firestore takes one only at the
 * top level of an update, and removal is the one that minds.
 *
 * A struct - {@link Struct}, or a class - is what it reaches into. Handed
 * {@link Patch.replace} instead, it is written whole, at its path, as `set`
 * would write it, and one made {@link Optional} may be removed whole besides.
 * Any other schema, a plain `Schema.Struct` included, is a value, written
 * whole. The patch says which it is, not the key - see the `Patch` module. A
 * {@link Union} is written whole as well, replaced with one of its members or
 * removed where it is {@link Optional}.
 *
 * Firestore applies an update to whatever the document holds, without checking
 * it against anything, so a patch that is right for one document may leave
 * another unreadable: written into a struct the document goes without, it
 * creates the struct holding only what the patch carried. Under `checked`, an
 * {@link Optional} struct is replaced or removed and never patched, and a patch
 * is refused by the type and by the encoding. Under `unchecked` it may be
 * patched too - see {@link UpdateMode}.
 *
 * A struct holding a field that `set` or an update leaves out -
 * {@link Immutable}, or a field only ever read - is never replaced, since that
 * would change or drop the field. It is patched where every document holds it,
 * and only removed by a checked update where it is {@link Optional}.
 *
 * The patch it takes is {@link Update.to}, and the paths it writes are
 * {@link Update.from}.
 *
 * It is only ever written. A document is never read in this shape, so decoding
 * fails.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Update<
  // Declared rather than measured, which recursing through every struct for
  // replaceability makes too deep for the compiler.
  in out Fields extends VariantSchema.Struct.Fields,
  in out Mode extends UpdateMode = "checked",
> extends Schema.decodeTo<
  Schema.toType<Schema.Struct<UpdateFields<Fields, Mode>>>,
  Schema.Struct<UpdatePaths<Fields, Mode> extends infer P extends Schema.Struct.Fields ? P : never>,
  never,
  KeyServices<Fields>
> {}

/**
 * A document schema, together with the shapes it is written in.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Class<
  Self,
  Fields extends VariantSchema.Struct.Fields,
> extends VariantSchema.Class<
  Self,
  Fields,
  Schema.Struct<VariantSchema.ExtractFields<"read", Fields, true>>
> {
  /** What a snapshot decodes into, which is what the class itself is. */
  readonly read: VariantSchema.Extract<"read", VariantSchema.Struct<Fields>>;
  /** What `set` writes. */
  readonly create: VariantSchema.Extract<"create", VariantSchema.Struct<Fields>>;
  /**
   * What `update` writes, taking only the patches that leave any document it
   * may be written to readable: an {@link Optional} struct is replaced with
   * {@link Patch.replace} or removed, never patched.
   */
  readonly update: Update<Fields, "checked">;
  /**
   * What `update` writes, taking a patch into an {@link Optional} struct as
   * well. Every patch {@link Class.update} takes, it takes too, and writes the
   * same.
   *
   * Such a patch is only right where the struct is there, which the caller
   * vouches for - with an earlier read, a query that only matches documents
   * holding it, or a transaction. Where it is missing, Firestore creates it
   * holding the patch alone, and the document no longer reads.
   */
  readonly updateUnchecked: Update<Fields, "unchecked">;
}

type MissingSelfGeneric =
  `Missing \`Self\` generic - use \`class Self extends Class<Self>("Self")({ ... })\``;

/**
 * Defines a document schema.
 *
 * The class is the `read` variant, so it is what a snapshot decodes into and
 * what every other schema combinator takes. {@link Class.create},
 * {@link Class.update} and {@link Class.updateUnchecked} hang off it.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const Class: <Self = never>(
  identifier: string,
) => <const Fields extends VariantSchema.Struct.Fields>(
  fields: Fields & VariantSchema.Struct.Validate<Fields, Variant>,
  annotations?: Schema.Annotations.Declaration<
    Self,
    readonly [Schema.Struct<VariantSchema.ExtractFields<"read", Fields, true>>]
  >,
) => [Self] extends [never] ? MissingSelfGeneric : Class<Self, Fields> = firestoreModel.Class;

/** What a union is replaced with: the `create` shape of each member it may be replaced with. */
type ReplaceableCreates<Members extends ReadonlyArray<VariantSchema.Struct<any>>> =
  Members extends readonly [
    infer Head extends VariantSchema.Struct<any>,
    ...infer Tail extends ReadonlyArray<VariantSchema.Struct<any>>,
  ]
    ? IsReplaceable<Head[typeof VariantSchema.TypeId]> extends true
      ? [VariantSchema.Extract<"create", Head>, ...ReplaceableCreates<Tail>]
      : ReplaceableCreates<Tail>
    : [];

/** Whether every member of a union may be written whole by an update. */
type AreReplaceable<Members extends ReadonlyArray<VariantSchema.Struct<any>>> = false extends {
  [K in keyof Members]: IsReplaceable<Members[K][typeof VariantSchema.TypeId]>;
}[number]
  ? false
  : true;

/** The union of the `create` shapes of `Members`. */
type UnionCreate<Members extends ReadonlyArray<VariantSchema.Struct<any>>> = Schema.Union<{
  readonly [K in keyof Members]: VariantSchema.Extract<"create", Members[K]>;
}>;

/**
 * What a union takes in an update: a replacement with any member it may be
 * replaced with, and the removal where it is {@link Optional}. It is the same
 * in either {@link UpdateMode}.
 */
type UnionTakes<
  Members extends ReadonlyArray<VariantSchema.Struct<any>>,
  Optional extends boolean,
> = Schema.Union<
  readonly [
    ...(ReplaceableCreates<Members> extends readonly [] | readonly [never]
      ? []
      : [ReplaceSchema<Schema.Union<ReplaceableCreates<Members>>>]),
    ...(Optional extends true ? [FirestoreSchema.DeleteField] : []),
  ]
>;

/** Whether an update writes anything at all into a union. */
type IsUnionWritable<
  Members extends ReadonlyArray<VariantSchema.Struct<any>>,
  Optional extends boolean,
> = Optional extends true ? true : ReplaceableCreates<Members> extends readonly [] ? false : true;

/** What a union takes as a field of the struct it sits in, or `never` where it takes nothing. */
type UnionUpdate<
  Members extends ReadonlyArray<VariantSchema.Struct<any>>,
  Optional extends boolean,
> =
  IsUnionWritable<Members, Optional> extends true
    ? Schema.optionalKey<UnionTakes<Members, Optional>>
    : never;

/** The path a union at `Path` is written at, whole. */
type UnionPaths<
  Members extends ReadonlyArray<VariantSchema.Struct<any>>,
  Optional extends boolean,
  Path extends string,
> =
  IsUnionWritable<Members, Optional> extends false
    ? {}
    : {
        readonly [_ in Path]: Schema.optionalKey<
          ReplaceableCreates<Members> extends readonly []
            ? FirestoreSchema.DeleteField
            : Optional extends true
              ? FirestoreSchema.DeleteFieldOr<Schema.Union<ReplaceableCreates<Members>>>
              : Schema.Union<ReplaceableCreates<Members>>
        >;
      };

/** The members of the union a field is, or `never` where it is none. */
type UnionOf<F> =
  Unwrap<F> extends {
    readonly [UnionTypeId]: infer Members extends ReadonlyArray<VariantSchema.Struct<any>>;
  }
    ? Members
    : never;

/** The schemas a union field is, variant by variant. */
type UnionSchemas<Members extends ReadonlyArray<VariantSchema.Struct<any>>> =
  IsUnionWritable<Members, false> extends true
    ? {
        readonly read: VariantSchema.Union<Members, "read">;
        readonly create: UnionCreate<Members>;
        readonly update: UnionUpdate<Members, false>;
      }
    : {
        readonly read: VariantSchema.Union<Members, "read">;
        readonly create: UnionCreate<Members>;
      };

/**
 * Type-level representation of {@link Union}.
 *
 * It is the union of its members as they are read, and carries the members it
 * was made of, which is what a field holding it is written through.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Union<in out Members extends ReadonlyArray<VariantSchema.Struct<any>>>
  extends VariantSchema.Union<Members, "read">, VariantSchema.Field<UnionSchemas<Members>> {
  /** Each member as it is read. */
  readonly read: Schema.Union<{
    readonly [K in keyof Members]: VariantSchema.Extract<"read", Members[K]>;
  }>;
  /** What `set` writes: any member, as `set` writes it. */
  readonly create: UnionCreate<Members>;
  readonly [UnionTypeId]: Members;
}

/**
 * A field holding one of several structs or classes, its members.
 *
 * It stays Effect's own union: there is no tag or discriminator of this
 * library's. A snapshot decodes into whichever member matches, so a literal
 * field the members tell apart by narrows it, and data matching no member
 * fails with a schema issue. A `create` takes any member in the shape `set`
 * writes it, with the sentinels and constructor defaults its fields take.
 *
 * A value that fits several members, on `create` or in a replacement, is taken
 * as the first of them in the order they were declared, as `Schema.Union` does.
 *
 * An update writes it whole: {@link Patch.replace} with any member, in the
 * shape `set` writes it, and {@link FieldValue.deleteField} where it is
 * {@link Optional}. Both {@link UpdateMode}s take the same. A member holding a
 * field that `set` or an update leaves out - {@link Immutable}, or a field only
 * ever read - is never replaced, the same as a struct is not, since that would
 * change or drop the field.
 *
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel, FirestoreSchema, Patch } from "@visiolab/effect-firebase/firestore";
 *
 * const Pending = FirestoreModel.Struct({ status: Schema.Literal("pending") });
 * const Done = FirestoreModel.Struct({
 *   status: Schema.Literal("done"),
 *   completedAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
 * });
 *
 * class Job extends FirestoreModel.Class<Job>("Job")({
 *   state: FirestoreModel.Union([Pending, Done]),
 * }) {}
 *
 * Job.update.make({
 *   state: Patch.replace({ status: "done", completedAt: FieldValue.serverTimestamp }),
 * });
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const Union: <const Members extends ReadonlyArray<VariantSchema.Struct<any>>>(
  members: Members,
) => Union<Members> = firestoreModel.Union;

/**
 * Type-level representation of {@link Immutable}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Immutable<S extends Schema.Top> extends VariantSchema.Field<{
  readonly read: S;
  readonly create: S;
}> {}

/**
 * A field written once, when the document is created.
 *
 * It is read back and it is set by `set`, and it is absent from `update`, so
 * the field cannot be changed by one.
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Immutable: <S extends Schema.Top>(schema: S) => Immutable<S> =
  firestoreModel.Immutable;

/**
 * Type-level representation of {@link Timestamp}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Timestamp<S extends FirestoreSchema.TimeSchema> extends VariantSchema.Field<{
  readonly read: S;
  readonly create: FirestoreSchema.ServerTimestampOr<S>;
  readonly update: FirestoreSchema.ServerTimestampOr<S>;
}> {}

/**
 * A timestamp field: stamped by this client, or left to the server.
 *
 * Both writes take either, and the read takes `schema` alone, since the
 * sentinel is gone by the time a document comes back. Leaving it open costs a
 * call site that never uses it nothing, and spares it from redeclaring the
 * field the day it does.
 *
 * What the instant is held as is `schema`'s to say:
 * {@link FirestoreSchema.Timestamp} where the digits finer than a millisecond
 * are to survive a round trip, `Schema.DateTimeUtc` or `Schema.Date` where one
 * of those is the easier value to hold onto. Firestore stores each of them as a
 * timestamp.
 *
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreModel, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * class Session extends FirestoreModel.Class<Session>("Session")({
 *   createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
 *   seenAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
 * }) {}
 * ```
 *
 * Where the server is to decide, a call site hands it
 * {@link FieldValue.serverTimestamp}. Where it never may, name the schema
 * directly, which goes into every variant as it stands.
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Timestamp: <S extends FirestoreSchema.TimeSchema>(schema: S) => Timestamp<S> =
  firestoreModel.Timestamp;

/**
 * Type-level representation of {@link Number}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Number<
  S extends Schema.Codec<unknown, number, unknown, unknown>,
> extends VariantSchema.Field<{
  readonly read: S;
  readonly create: FirestoreSchema.IncrementOr<S>;
  readonly update: FirestoreSchema.IncrementOr<S>;
}> {}

/**
 * A number field: set outright, or moved by the server.
 *
 * Both writes take either, and the read takes `schema` alone, since a document
 * holds the sum the server wrote rather than the request to add. A move is what
 * keeps a total right when two clients write at once, which reading the number
 * and writing the sum back does not.
 *
 * What the number may be is `schema`'s to say, and the writes say it too: hand
 * it `Schema.Int` and the field is counted in whole steps, `Schema.Finite` and
 * it adds up fractions, either of them checked further and the check holds on
 * the way in and the way out. A move of its own is not checked against it,
 * since the sum is the server's to work out and only the next read sees it.
 *
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class Account extends FirestoreModel.Class<Account>("Account")({
 *   visits: FirestoreModel.Number(Schema.Int),
 *   balance: FirestoreModel.Number(Schema.Finite),
 * }) {}
 * ```
 *
 * Where the server is to move it, a call site hands it
 * {@link FieldValue.increment} or {@link FieldValue.decrement}. Where it never
 * may, name the schema directly, which goes into every variant as it stands.
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Number: <S extends Schema.Codec<unknown, number, unknown, unknown>>(
  schema: S,
) => Number<S> = firestoreModel.Number;

/**
 * Type-level representation of {@link Array}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Array<S extends Schema.Top> extends VariantSchema.Field<{
  readonly read: Schema.$Array<S>;
  readonly create: Schema.$Array<S>;
  readonly update: FirestoreSchema.ArrayOr<S>;
}> {}

/**
 * An array field: written whole, or grown and shrunk by the server.
 *
 * An update takes the array, {@link FieldValue.arrayUnion} or
 * {@link FieldValue.arrayRemove}, and the read takes the array alone, since a
 * document holds what the server made of the request. Growing or shrinking is
 * what keeps an element another client added at the same time, which reading
 * the array and writing it back does not.
 *
 * A create takes the array alone. Growing an array that is not there yet writes
 * the elements as they are, which the array already says, and shrinking one
 * writes it empty, which is not what anyone asking for it meant.
 *
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class Article extends FirestoreModel.Class<Article>("Article")({
 *   tags: FirestoreModel.Array(Schema.String),
 * }) {}
 *
 * Article.update.make({ tags: FieldValue.arrayUnion("news") });
 * ```
 *
 * The elements are matched by value, all the way down, so taking a map out of
 * the array means handing over every key it holds as it holds it - see
 * {@link FieldValue.ArrayRemove}. `item` is what each element is held as: not an
 * array, which Firestore does not nest, and not a field, since an element is
 * written whole wherever the array is. It goes through the sentinels too, so an
 * element is encoded the same whichever way the array is written.
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Array: <S extends Schema.Top>(item: S) => Array<S> = firestoreModel.Array;

/**
 * Type-level representation of {@link Record}.
 *
 * It carries the key and the value it was made of, which is what an update
 * reaches into.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Record<
  // Declared rather than measured, which recursing through the value makes
  // too deep for the compiler.
  in out K extends Schema.Record.Key,
  in out V extends Value,
> extends VariantSchema.Field<
  IsWritable<V> extends true
    ? {
        readonly read: RecordSchema<K, ValueSchema<V, "read">>;
        readonly create: RecordSchema<K, ValueSchema<V, "create">>;
        readonly update: Schema.optionalKey<RecordTakes<K, V, false, "unchecked">>;
      }
    : {
        readonly read: RecordSchema<K, ValueSchema<V, "read">>;
        readonly create: RecordSchema<K, ValueSchema<V, "create">>;
      }
> {
  readonly [RecordTypeId]: { readonly key: K; readonly value: V };
}

/**
 * A map field whose keys come from the data: a counter per option, a map per
 * member, a lookup table. An update writes it key by key.
 *
 * The read and the create hold it as `Schema.Record(key, value)`, with each
 * value in the form `value` is read or created in, so a create takes the
 * sentinels `value` takes. An update takes a patch of it, writing each key it
 * carries at its own path, in the form `value` is updated in: a
 * {@link Number} takes {@link FieldValue.increment}, an {@link Array}
 * {@link FieldValue.arrayUnion}, a {@link Timestamp}
 * {@link FieldValue.serverTimestamp}. That is what lets two clients each write
 * a key of the same map without either reading it first.
 *
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class Poll extends FirestoreModel.Class<Poll>("Poll")({
 *   votes: FirestoreModel.Record(Schema.String, FirestoreModel.Number(Schema.Int)),
 *   aliases: FirestoreModel.Record(Schema.String, Schema.String),
 * }) {}
 *
 * Poll.update.make({
 *   votes: { pizza: FieldValue.increment(1) }, // "votes.pizza"
 *   aliases: { old: FieldValue.deleteField }, // "aliases.old"
 * });
 * ```
 *
 * Where `key` is a string, refined or not, any key may be missing from a
 * document, so each takes {@link FieldValue.deleteField} to remove it, and a
 * value that is a struct or a Record itself is treated as one a document may go
 * without - written whole with {@link Patch.replace} or removed, and only
 * patched by {@link Class.updateUnchecked}, the way an {@link Optional} struct
 * is. The Record itself is patched even where it may be missing, since a patch
 * only ever writes keys it may hold or not.
 *
 * Where `key` is a union of literals, the Record holds every one of them, and
 * an update treats it as a struct with a field per key: no key is removed
 * unless `value` is {@link Optional}, and the encoded update names each path.
 *
 * Either way it takes {@link Patch.replace} to be written whole, unless
 * `value` holds a field that `set` or an update leaves out.
 *
 * The path of a key is the key as `key` encodes it, as part of the update, so
 * a service `key` takes to encode is one the update takes. A key no path can
 * name - empty, or holding a `.`, as written or encoded - fails the update
 * when it is encoded, or, where it is a literal written that way, throws when
 * the Record is declared. A value made
 * {@link Optional} takes the removal it would take anyway, and a value no
 * update writes, such as {@link Immutable}, leaves the whole Record out of the
 * update.
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Record: <K extends Schema.Record.Key, V extends Value>(
  key: K,
  value: V,
) => Record<K, V> = firestoreModel.Record;

/** Any {@link Record}, whatever it holds. */
type AnyRecord = VariantSchema.Field<any> & { readonly [RecordTypeId]: any };

/** The variants of `F` made {@link Optional}. */
type OptionalSchemas<F extends Value> =
  F extends VariantSchema.Struct<any>
    ? {
        readonly read: Schema.optionalKey<VariantSchema.Extract<"read", F>>;
        readonly create: Schema.optionalKey<VariantSchema.Extract<"create", F>>;
        readonly update: StructUpdate<F[typeof VariantSchema.TypeId], true, "unchecked">;
      }
    : F extends Union<infer Members>
      ? {
          readonly read: Schema.optionalKey<VariantSchema.Union<Members, "read">>;
          readonly create: Schema.optionalKey<UnionCreate<Members>>;
          readonly update: UnionUpdate<Members, true>;
        }
      : F extends AnyRecord
        ? IsWritable<RecordOf<F>["value"]> extends true
          ? {
              readonly read: Schema.optionalKey<F["schemas"]["read"]>;
              readonly create: Schema.optionalKey<F["schemas"]["create"]>;
              readonly update: Schema.optionalKey<
                RecordTakes<RecordOf<F>["key"], RecordOf<F>["value"], true, "unchecked">
              >;
            }
          : {
              readonly read: Schema.optionalKey<F["schemas"]["read"]>;
              readonly create: Schema.optionalKey<F["schemas"]["create"]>;
            }
        : F extends Schema.Top
          ? {
              readonly read: Schema.optionalKey<F>;
              readonly create: Schema.optionalKey<F>;
              readonly update: Schema.optionalKey<FirestoreSchema.DeleteFieldOr<F>>;
            }
          : F extends VariantSchema.Field<infer S>
            ? {
                readonly [K in keyof S]: S[K] extends Schema.Top
                  ? K extends "update"
                    ? Schema.optionalKey<FirestoreSchema.DeleteFieldOr<S[K]>>
                    : Schema.optionalKey<S[K]>
                  : never;
              }
            : never;

/**
 * Type-level representation of {@link Optional}.
 *
 * It carries the field it was made of as `field`, which is what an update
 * reaches into where that is a struct or a {@link Record}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Optional<in out F extends Value> extends VariantSchema.Field<OptionalSchemas<F>> {
  readonly "~optionality": "optional";
  readonly field: F;
}

/**
 * A field a document may go without, and an update may take away.
 *
 * The read and the create hold it as an optional key, since a field that is
 * not there is left out rather than stored as nothing. The update takes
 * {@link FieldValue.deleteField} besides, because leaving a field out of an
 * update leaves it as it is, and removing it has to be asked for.
 *
 * It takes a schema, a field, a struct or a {@link Record}, so it makes any of
 * the others optional too:
 *
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreModel, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * const Address = FirestoreModel.Struct({
 *   city: Schema.String,
 * });
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   nickname: FirestoreModel.Optional(Schema.String),
 *   lastSeenAt: FirestoreModel.Optional(FirestoreModel.Timestamp(FirestoreSchema.Timestamp)),
 *   address: FirestoreModel.Optional(Address),
 * }) {}
 * ```
 *
 * A field with no `update` variant - {@link Immutable}, say - is made optional
 * where it is read and created, and stays out of the update as before.
 *
 * A field made optional already is handed back as it is, so making it optional
 * twice is the same as once.
 *
 * Inside a struct, an optional field is removed the same way as at the top,
 * since an update writes a struct at its paths - see {@link Update}.
 *
 * A struct made optional is the one place where what the document holds
 * decides what a patch does: where the struct is missing, a patch written into
 * it creates it holding only the patch, and the document no longer reads. So
 * {@link Class.update} writes it whole or removes it, and only
 * {@link Class.updateUnchecked} patches it, for a caller who knows it is
 * there:
 *
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel, Patch } from "@visiolab/effect-firebase/firestore";
 *
 * const Address = FirestoreModel.Struct({ city: Schema.String, zip: Schema.String });
 *
 * class Customer extends FirestoreModel.Class<Customer>("Customer")({
 *   address: FirestoreModel.Optional(Address),
 * }) {}
 *
 * Customer.update.make({ address: Patch.replace({ city: "Berlin", zip: "10115" }) }); // written whole
 * Customer.update.make({ address: FieldValue.deleteField }); // removed
 * Customer.updateUnchecked.make({ address: { city: "Berlin" } }); // the caller knows it is there
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Optional: <F extends Value>(self: F) => F extends AnyOptional ? F : Optional<F> =
  firestoreModel.Optional;
