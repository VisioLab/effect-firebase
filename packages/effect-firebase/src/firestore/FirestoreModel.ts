/**
 * Document schemas with one shape per operation.
 *
 * A Firestore document is read in one shape and written in two others: the id
 * lives in the path rather than the data, a `createdAt` the server fills in is
 * read as a timestamp but written as a sentinel, and an update is a map of the
 * fields that change rather than a whole document. This module derives all
 * three shapes from one field declaration, over `VariantSchema` - the
 * machinery behind `effect/schema`'s `Model`, with the variants a document
 * database needs.
 *
 * - {@link Class} defines a document, and {@link Union} a document or field
 *   holding one of several shapes.
 * - {@link Timestamp}, {@link Number}, {@link Array}, {@link Record} and
 *   {@link Optional} declare fields whose writes take Firestore's sentinels.
 * - {@link Immutable}, {@link Field}, {@link FieldOnly} and {@link FieldExcept}
 *   control which variants a field appears in.
 *
 * @example Defining a document
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
 * User; // what a snapshot decodes into
 * User.create; // what `setDoc` writes
 * User.update; // what `updateDoc` writes, whatever the document holds
 * User.updateUnchecked; // what `updateDoc` writes where the caller knows what it holds
 * ```
 *
 * @see {@link Collection.make} for addressing documents of a model
 * @see {@link FirestoreSchema} for the schemas of Firestore's own values
 *
 * @stability unstable
 * @since 0.2.0
 */
import type { Schema, SchemaAST, Struct as Struct_, Types } from "effect";
import type { VariantSchema } from "effect/schema";
import type * as FirestoreSchema from "./FirestoreSchema.ts";
import * as firestoreModel from "./internal/firestoreModel.ts";
import type * as Patch from "./Patch.ts";

/**
 * The shapes a document is read and written in.
 *
 * **Details**
 *
 * - `read` is what a snapshot's data decodes into.
 * - `create` is what `setDoc` writes: a whole document.
 * - `update` is what `updateDoc` writes: the fields that change.
 *
 * `read` is the default variant, so a {@link Class} itself is the read shape
 * and the write shapes hang off it.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Variant = "read" | "create" | "update";

/**
 * Declares a field with a different schema per variant.
 *
 * **When to use**
 *
 * Use when a field is read and written in shapes no ready-made field covers.
 * Leave a variant out to keep the field out of that shape.
 *
 * @example A field written as a sentinel and read as a timestamp
 * ```ts
 * import { FirestoreModel, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * class Post extends FirestoreModel.Class<Post>("Post")({
 *   publishedAt: FirestoreModel.Field({
 *     read: FirestoreSchema.Timestamp,
 *     create: FirestoreSchema.ServerTimestamp,
 *   }),
 * }) {}
 * ```
 *
 * @see {@link FieldOnly} for the same schema in some variants
 * @see {@link FieldExcept} for the same schema in all but some variants
 * @see {@link Timestamp} for a timestamp the client or the server may set
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const Field = firestoreModel.Field;

/**
 * Declares a field with one schema that appears only in the named variants.
 *
 * **When to use**
 *
 * Use for a field only some shapes carry, such as one only ever read, or one
 * only ever written.
 *
 * @example A field only read
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class Account extends FirestoreModel.Class<Account>("Account")({
 *   plan: FirestoreModel.FieldOnly(["read"])(Schema.Literals(["free", "paid"])),
 * }) {}
 * ```
 *
 * @see {@link FieldExcept} for naming the variants to leave out instead
 * @see {@link Field} for a different schema per variant
 * @see {@link Immutable} for a field read and created, but never updated
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const FieldOnly = firestoreModel.FieldOnly;

/**
 * Declares a field with one schema that appears in every variant but the named
 * ones.
 *
 * **When to use**
 *
 * Use when a field belongs in most shapes and only a few leave it out.
 *
 * @see {@link FieldOnly} for naming the variants to keep instead
 * @see {@link Field} for a different schema per variant
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const FieldExcept = firestoreModel.FieldExcept;

/**
 * Declares a set of fields without building a class.
 *
 * **When to use**
 *
 * Use for a nested map inside a document, or for fields shared between several
 * documents. An update reaches into a struct field by field, unlike a plain
 * `Schema.Struct`, which is a value written whole.
 *
 * @example A nested address
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * const Address = FirestoreModel.Struct({ city: Schema.String, zip: Schema.String });
 *
 * class Customer extends FirestoreModel.Class<Customer>("Customer")({
 *   address: Address,
 * }) {}
 *
 * Customer.update.make({ address: { city: "Berlin" } }); // written at "address.city"
 * ```
 *
 * @see {@link Class} for a whole document
 * @see {@link Patch.replace} for writing a struct whole in an update
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const Struct = firestoreModel.Struct;

/**
 * Rewrites the schemas of a field, variant by variant.
 *
 * **When to use**
 *
 * Use to derive a field from another one, such as narrowing what one variant
 * takes while keeping the others.
 *
 * @see {@link Field} for declaring a field per variant directly
 *
 * @stability unstable
 * @category transforming
 * @since 0.2.0
 */
export const fieldEvolve = firestoreModel.fieldEvolve;

/**
 * Pulls one variant out of a struct as a plain schema.
 *
 * **When to use**
 *
 * Use to get a struct's `read` or `create` shape as an ordinary schema, for
 * example to validate data outside Firestore.
 *
 * **Details**
 *
 * The `update` variant it returns is the one the fields declare: it is neither
 * made partial nor flattened into paths. Use {@link Class.update} for the
 * update a document is written through.
 *
 * @see {@link fields} for the field declarations themselves
 *
 * @stability unstable
 * @category converting
 * @since 0.2.0
 */
export const extract = firestoreModel.extract;

/**
 * Returns the field declarations a {@link Class} or {@link Struct} was built
 * from.
 *
 * **When to use**
 *
 * Use to build a new struct or class from the fields of an existing one.
 *
 * @see {@link extract} for one variant of a struct as a plain schema
 *
 * @stability unstable
 * @category getters
 * @since 0.2.0
 */
export const fields: <A extends VariantSchema.Struct<any>>(
  self: A,
) => A[typeof VariantSchema.TypeId] = firestoreModel.fields;

/**
 * Any document schema: a {@link Class}, or a {@link Union} of classes.
 *
 * **Details**
 *
 * Unlike Effect's `Model.Any`, it asks for no `fields`: nothing that takes it
 * reads them, and a union has none.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Any = Schema.Top & {
  readonly create: Schema.Top;
  readonly update: Schema.Top;
  readonly updateUnchecked: Schema.Top;
};

const RecordTypeId = firestoreModel.RecordTypeId;

const UnionTypeId = firestoreModel.UnionTypeId;

/**
 * Anything a field may be declared as: a schema, a field, a struct or a
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
      : UnionTakes<UnionOf<V>, true, Mode>;

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
 * Which patches an update takes: `"checked"` or `"unchecked"`.
 *
 * **When to use**
 *
 * Use `"checked"`, the default, unless the caller knows what the document
 * holds. Use `"unchecked"` to patch an {@link Optional} struct or union, or a
 * key only some members of a {@link Union} hold, after an earlier read, in a
 * transaction, or with a query that only matches such documents.
 *
 * **Details**
 *
 * Firestore applies an update to whatever the document holds without checking
 * it, and a patch does not say which member of a union the document holds.
 *
 * - `checked` takes only patches that leave any document readable. An
 *   {@link Optional} struct is written whole with {@link Patch.replace} or
 *   removed, never patched: a patch written into a missing struct would create
 *   it holding only the patch. A {@link Union} is patched only at its Shared
 *   Fields, the fields every member holds, with a value every member takes and
 *   stores the same way. An {@link Optional} union is not patched at all.
 * - `unchecked` also patches an {@link Optional} struct or union, and a key
 *   only some members of a union hold. That key is checked by the same rule as
 *   a Shared Field, over just the members that hold it: each must take the
 *   value and store it the same way.
 *
 * A patch is checked against every member of a union rather than the first it
 * matches, since a patch one member takes could leave a document holding
 * another unreadable - by exceeding its maximum length, say, or storing a
 * `Date` as a timestamp where it holds a string.
 *
 * The modes differ only in which patches they take. A patch both take is
 * written the same way, at the same paths.
 *
 * @see {@link Class.update} for the checked update of a document
 * @see {@link Class.updateUnchecked} for the unchecked one
 * @see {@link Firestore.UpdateOptions} for choosing the mode of `updateDoc`
 * @see {@link Firestore.With.updateDoc} for writing an update
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
 * The fields of an update in `Mode`: every field that may change, each one
 * optional.
 *
 * **Details**
 *
 * A struct every document holds takes a patch of its own. An {@link Optional}
 * struct takes the removal, and a patch only under `unchecked` - see
 * {@link UpdateMode}. Either takes {@link Patch.replace} where an update writes
 * every field it holds.
 *
 * @see {@link UpdatePaths} for the paths these fields are written at
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
      : UnionFieldUpdate<UnionOf<F>, IsOptional<F>, Mode>;

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
 * The fields an update is encoded as: one optional key per path it can write
 * to, such as `"address.city"`.
 *
 * **Details**
 *
 * A struct's own key takes the struct written whole, where an update writes
 * every field it holds, and the removal, where it is {@link Optional}. A
 * struct that takes neither has no key of its own and is only written field by
 * field.
 *
 * The paths are the same in either {@link UpdateMode}.
 *
 * @see {@link UpdateFields} for the nested patch these paths are encoded from
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
  Types.UnionToIntersection<
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
 * **Details**
 *
 * It takes a nested partial - the fields that change, with a struct carrying
 * only its own fields that change - and encodes each one at its path, so
 * `{ address: { city } }` becomes `{ "address.city": city }`. That makes an
 * update a merge: Firestore replaces a map it is handed as a value, but a path
 * counts as the top level and leaves the rest of the map alone. It also lets a
 * sentinel sit at any depth, which matters for removal: Firestore only takes
 * `deleteField` at the top level of an update.
 *
 * - A {@link Struct} or class is reached into. Handed {@link Patch.replace},
 *   it is written whole at its path, as `setDoc` would write it, and one made
 *   {@link Optional} may also be removed.
 * - Any other schema, a plain `Schema.Struct` included, is a value and is
 *   written whole. The patch decides which, not the key - see `Patch`.
 * - A {@link Union} is replaced with one of its members, removed where it is
 *   {@link Optional}, and patched at its Shared Fields, each at its path.
 * - A struct holding a field that `setDoc` or an update leaves out -
 *   {@link Immutable}, or a read-only field - is never replaced, since that
 *   would change or drop the field. It is patched where every document holds
 *   it, and a checked update only removes it where it is {@link Optional}.
 *
 * Under `checked`, a patch into an {@link Optional} struct or union is refused,
 * by the type and by the encoding, since written into a missing struct it
 * creates one holding only the patch. Under `unchecked` it is taken - see
 * {@link UpdateMode}.
 *
 * A patch of a union's Shared Field is checked against every member: its type
 * is what every member's update takes there, so the literal the members are
 * told apart by is never shared, and its value is encoded through every member,
 * each of which must store it as the same Firestore Value. Otherwise it fails
 * with a schema issue. A sentinel is taken where every member takes it.
 *
 * The patch it takes is `Update.to`, and the paths it writes are `Update.from`.
 * It is only ever written: decoding fails, since a document is never read in
 * this shape.
 *
 * @see {@link UpdateFields} for the patch it takes
 * @see {@link UpdatePaths} for the paths it writes
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
 * Type-level representation of {@link Class}: a document schema together with
 * the shapes it is written in.
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
  /** The shape a snapshot decodes into, which is the class itself. */
  readonly read: VariantSchema.Extract<"read", VariantSchema.Struct<Fields>>;
  /**
   * The shape `setDoc` and `addDoc` write: a whole document, taking the
   * sentinels and constructor defaults its fields declare.
   */
  readonly create: VariantSchema.Extract<"create", VariantSchema.Struct<Fields>>;
  /**
   * The shape `updateDoc` writes, taking only patches that leave any document
   * readable.
   *
   * **When to use**
   *
   * Use for every update unless the caller knows what the document holds.
   *
   * **Details**
   *
   * An {@link Optional} struct is replaced with {@link Patch.replace} or
   * removed, never patched, and a {@link Union} is only patched at its Shared
   * Fields.
   *
   * @see {@link Class.updateUnchecked} for patching where the caller knows the
   * document holds the target
   */
  readonly update: Update<Fields, "checked">;
  /**
   * The shape `updateDoc` writes with `mode: "unchecked"`, also taking a patch
   * into an {@link Optional} struct, and into a key only some members of a
   * {@link Union} hold.
   *
   * **When to use**
   *
   * Use when the caller knows the struct is there, or which member of the
   * union the document holds - from an earlier read, a transaction, or a
   * query that only matches such documents.
   *
   * **Details**
   *
   * It takes every patch {@link Class.update} takes, and writes it the same
   * way. Where the caller is wrong, Firestore writes the patch anyway and the
   * document no longer reads.
   *
   * @see {@link Class.update} for the checked update
   * @see {@link UpdateMode} for exactly what each mode takes
   */
  readonly updateUnchecked: Update<Fields, "unchecked">;
}

type MissingSelfGeneric =
  `Missing \`Self\` generic - use \`class Self extends Class<Self>("Self")({ ... })\``;

/**
 * Defines a document schema: one field declaration, with the shapes a document
 * is read, created and updated in derived from it.
 *
 * **When to use**
 *
 * Use to define what the documents of a collection hold. Hand the class to
 * {@link Collection.make}, and every read and write of that collection goes
 * through it.
 *
 * **Details**
 *
 * The class is the `read` variant: what a snapshot decodes into, and what
 * schema combinators take. The write shapes hang off it:
 *
 * - {@link Class.create} is what `setDoc` and `addDoc` write, a whole document,
 *   taking the sentinels and constructor defaults its fields declare.
 * - {@link Class.update} is what `updateDoc` writes, a nested partial encoded at
 *   field paths, taking only patches that leave any document readable.
 * - {@link Class.updateUnchecked} also takes patches that are only right where
 *   the caller knows what the document holds - see {@link UpdateMode}.
 *
 * The document's id is not a field: it lives in the path.
 *
 * @example Defining a document and its writes
 * ```ts
 * import { Schema } from "effect";
 * import {
 *   FieldValue,
 *   FirestoreModel,
 *   FirestoreSchema,
 * } from "@visiolab/effect-firebase/firestore";
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   displayName: Schema.String,
 *   signupSource: FirestoreModel.Immutable(Schema.String),
 *   createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
 *   visits: FirestoreModel.Number(Schema.Int),
 *   nickname: FirestoreModel.Optional(Schema.String),
 * }) {}
 *
 * User.create.make({
 *   displayName: "Ada",
 *   signupSource: "web",
 *   createdAt: FieldValue.serverTimestamp,
 *   visits: 0,
 * });
 *
 * User.update.make({ visits: FieldValue.increment(1), nickname: FieldValue.deleteField });
 * ```
 *
 * @see {@link Union} for a document that holds one of several shapes
 * @see {@link Struct} for a nested map, or fields shared between documents
 * @see {@link Collection.make} for the collection a document lives in
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

/** The fields each of `Members` holds. */
type MemberFields<Members extends ReadonlyArray<VariantSchema.Struct<any>>> = {
  readonly [I in keyof Members]: Members[I][typeof VariantSchema.TypeId];
};

/** Whether every one of `Fs` holds a field at `K`. */
type HoldAll<
  Fs extends ReadonlyArray<VariantSchema.Struct.Fields>,
  K extends PropertyKey,
> = false extends { [I in keyof Fs]: K extends keyof Fs[I] ? true : false }[number] ? false : true;

/** The keys any of `Fs` holds. */
type AllKeys<Fs extends ReadonlyArray<VariantSchema.Struct.Fields>> = {
  [I in keyof Fs]: keyof Fs[I];
}[number] &
  string;

/** Those of `Fs` that hold a field at `K`. */
type HoldingMembers<
  Fs extends ReadonlyArray<VariantSchema.Struct.Fields>,
  K extends PropertyKey,
> = Fs extends readonly [
  infer Head extends VariantSchema.Struct.Fields,
  ...infer Tail extends ReadonlyArray<VariantSchema.Struct.Fields>,
]
  ? K extends keyof Head
    ? [Head, ...HoldingMembers<Tail, K>]
    : HoldingMembers<Tail, K>
  : [];

/** The field each of `Fs` holds at `K`. */
type FieldsAt<Fs extends ReadonlyArray<VariantSchema.Struct.Fields>, K extends PropertyKey> = {
  readonly [I in keyof Fs]: Fs[I][K & keyof Fs[I]];
};

/** Whether every one of `Vs` is a struct, {@link Optional} or not. */
type AllStructs<Vs extends ReadonlyArray<unknown>> = false extends {
  [I in keyof Vs]: [StructOf<Vs[I]>] extends [never] ? false : true;
}[number]
  ? false
  : true;

/** Whether every one of `Vs` is a value: no struct, Record or union. */
type AllValues<Vs extends ReadonlyArray<unknown>> = true extends {
  [I in keyof Vs]: IsNode<Vs[I]>;
}[number]
  ? false
  : true;

/** Whether every one of `Vs` is {@link Optional}, or none, or some. */
type Optionality<Vs extends ReadonlyArray<unknown>> = {
  [I in keyof Vs]: IsOptional<Vs[I]>;
}[number] extends infer O
  ? [O] extends [true]
    ? "all"
    : [O] extends [false]
      ? "none"
      : "some"
  : never;

/** The fields of the struct each of `Vs` is. */
type StructsOf<Vs extends ReadonlyArray<unknown>> = {
  readonly [I in keyof Vs]: StructOf<Vs[I]>;
} extends infer Fs extends ReadonlyArray<VariantSchema.Struct.Fields>
  ? Fs
  : never;

/** The values out of `A` and `B` that the other takes too. */
type Meet<A, B> = (A extends B ? A : never) | (B extends A ? B : never);

/** The values every one of `Ts` takes. */
type MeetAll<Ts extends ReadonlyArray<unknown>> = Ts extends readonly [infer H, ...infer T]
  ? T extends readonly []
    ? H
    : Meet<H, MeetAll<T>>
  : never;

/** What each of `Vs` takes in an update. */
type UpdateTypes<Vs extends ReadonlyArray<unknown>> = {
  readonly [I in keyof Vs]: UpdateSchema<Vs[I]>["Type"];
};

/**
 * The schema a Shared Field that is a value is patched through: it takes what
 * every member takes, and encodes as the first member does, which is how every
 * member would.
 */
interface SharedSchema<T, E> extends Schema.Bottom<
  T,
  E,
  never,
  never,
  SchemaAST.AST,
  SharedSchema<T, E>,
  T
> {}

/** Whether every one of `Vs` is a {@link Union}, {@link Optional} or not. */
type AllUnions<Vs extends ReadonlyArray<unknown>> = false extends {
  [I in keyof Vs]: [UnionOf<Vs[I]>] extends [never] ? false : true;
}[number]
  ? false
  : true;

/** The fields of every member of each of the unions `Vs`, in one list. */
type UnionsMemberFields<Vs extends ReadonlyArray<unknown>> = Vs extends readonly [
  infer Head,
  ...infer Tail,
]
  ? [...MemberFields<UnionOf<Head>>, ...UnionsMemberFields<Tail>]
  : [];

/** What each of the unions `Vs` is replaced with, or `never` where one is replaced with nothing. */
type UnionsCreates<Vs extends ReadonlyArray<unknown>> = true extends {
  [I in keyof Vs]: ReplaceableCreates<UnionOf<Vs[I]>> extends readonly [] ? true : false;
}[number]
  ? never
  : { readonly [I in keyof Vs]: Schema.Union<ReplaceableCreates<UnionOf<Vs[I]>>> };

/**
 * The schema the unions the members of a union hold at one key are replaced
 * through: it takes what every one of them takes, made by every one.
 */
interface SharedReplaceSchema<T, MakeIn> extends Schema.Bottom<
  Patch.Replace<T>,
  Patch.Replace<T>,
  never,
  never,
  SchemaAST.Declaration,
  SharedReplaceSchema<T, MakeIn>,
  Patch.Replace<MakeIn>
> {}

/** The value each of `Ss` holds, and what each is made from. */
type CreateTypes<Ss extends ReadonlyArray<Schema.Top>> = {
  readonly [I in keyof Ss]: Ss[I]["Type"];
};
type CreateMakeIns<Ss extends ReadonlyArray<Schema.Top>> = {
  readonly [I in keyof Ss]: Ss[I]["~type.make.in"];
};

/**
 * The replacement of the unions `Vs` takes, or `never` where there is none:
 * one every one of them is replaced with.
 */
type SharedReplacement<Vs extends ReadonlyArray<unknown>> =
  UnionsCreates<Vs> extends infer Ss extends ReadonlyArray<Schema.Top>
    ? [MeetAll<CreateTypes<Ss>>] extends [never]
      ? never
      : SharedReplaceSchema<MeetAll<CreateTypes<Ss>>, MeetAll<CreateMakeIns<Ss>>>
    : never;

/** The schema the unions `Vs` are written whole at their path through, or `never`. */
type SharedWhole<Vs extends ReadonlyArray<unknown>> =
  UnionsCreates<Vs> extends infer Ss extends ReadonlyArray<Schema.Top>
    ? [MeetAll<CreateTypes<Ss>>] extends [never]
      ? never
      : SharedSchema<MeetAll<CreateTypes<Ss>>, Ss[0]["Encoded"]>
    : never;

/**
 * What the unions `Vs` the members of a union hold at one key take, by the
 * rule a union field is written by, held to every one of them: a replacement
 * every one takes, the removal where every one is {@link Optional}, and a
 * patch at the Shared Fields of all their members, unless one is
 * {@link Optional} and the update checked. `never` where they take none.
 */
type SharedUnionTakes<Vs extends ReadonlyArray<unknown>, Mode extends UpdateMode> = [
  ...([SharedPatch<UnionsMemberFields<Vs>, Mode>] extends [never]
    ? []
    : Optionality<Vs> extends "none"
      ? [SharedPatch<UnionsMemberFields<Vs>, Mode>]
      : Mode extends "unchecked"
        ? [SharedPatch<UnionsMemberFields<Vs>, Mode>]
        : []),
  ...([SharedReplacement<Vs>] extends [never] ? [] : [SharedReplacement<Vs>]),
  ...(Optionality<Vs> extends "all" ? [FirestoreSchema.DeleteField] : []),
] extends infer Takes extends ReadonlyArray<Schema.Top>
  ? Takes extends readonly []
    ? never
    : Schema.Union<Takes>
  : never;

/** The path the unions `Vs` at `Path` are written whole or removed at. */
type SharedUnionPath<Vs extends ReadonlyArray<unknown>, Path extends string> =
  Optionality<Vs> extends "all"
    ? {
        readonly [_ in Path]: Schema.optionalKey<
          [SharedWhole<Vs>] extends [never]
            ? FirestoreSchema.DeleteField
            : FirestoreSchema.DeleteFieldOr<SharedWhole<Vs>>
        >;
      }
    : [SharedWhole<Vs>] extends [never]
      ? {}
      : { readonly [_ in Path]: Schema.optionalKey<SharedWhole<Vs>> };

/**
 * What the fields `Vs` the members of a union hold at one key take, where it
 * is a Shared Field, or `never` where it is none: a value, at what every
 * member takes there, or a struct, patched at its own Shared Fields, or removed
 * where every member may go without it, or a union - see
 * {@link SharedUnionTakes}.
 */
type SharedTakes<Vs extends ReadonlyArray<unknown>, Mode extends UpdateMode> =
  AllStructs<Vs> extends true
    ? Optionality<Vs> extends "none"
      ? SharedPatch<StructsOf<Vs>, Mode>
      : Optionality<Vs> extends "all"
        ? FirestoreSchema.DeleteField
        : never
    : AllUnions<Vs> extends true
      ? SharedUnionTakes<Vs, Mode>
      : AllValues<Vs> extends true
        ? [MeetAll<UpdateTypes<Vs>>] extends [never]
          ? never
          : SharedSchema<MeetAll<UpdateTypes<Vs>>, UpdateSchema<Vs[0]>["Encoded"]>
        : never;

/**
 * The keys members holding the fields `Fs` are patched at in `Mode`, as a
 * patch holds them: their Shared Fields, and under `unchecked` a key only some
 * of them hold as well, by the same rule over just those.
 */
type SharedUpdateFields<
  Fs extends ReadonlyArray<VariantSchema.Struct.Fields>,
  Mode extends UpdateMode,
> = {
  readonly [
    K in AllKeys<Fs> as Mode extends "unchecked"
      ? [SharedTakes<FieldsAt<HoldingMembers<Fs, K>, K>, Mode>] extends [never]
        ? never
        : K
      : HoldAll<Fs, K> extends true
        ? [SharedTakes<FieldsAt<Fs, K>, Mode>] extends [never]
          ? never
          : K
        : never
  ]: Schema.optionalKey<SharedTakes<FieldsAt<HoldingMembers<Fs, K>, K>, Mode>>;
};

/** The patch of members holding `Fs` in `Mode`, or `never` where it takes no key. */
type SharedPatch<
  Fs extends ReadonlyArray<VariantSchema.Struct.Fields>,
  Mode extends UpdateMode,
> = keyof SharedUpdateFields<Fs, Mode> extends never
  ? never
  : Schema.Struct<SharedUpdateFields<Fs, Mode>>;

/** Whether a union is patched at any key in `Mode`. */
type HasSharedFields<
  Members extends ReadonlyArray<VariantSchema.Struct<any>>,
  Mode extends UpdateMode,
> = [SharedPatch<MemberFields<Members>, Mode>] extends [never] ? false : true;

/**
 * The paths the keys of members holding `Fs` are written at: every key an
 * `unchecked` update patches, in either mode.
 */
type SharedPaths<
  Fs extends ReadonlyArray<VariantSchema.Struct.Fields>,
  Prefix extends string,
> = Types.UnionToIntersection<
  {
    [K in keyof SharedUpdateFields<Fs, "unchecked"> & string]: SharedFieldPaths<
      FieldsAt<HoldingMembers<Fs, K>, K>,
      `${Prefix}${K}`
    >;
  }[keyof SharedUpdateFields<Fs, "unchecked"> & string]
> & {};

/** The paths a Shared Field at `Path`, held as `Vs`, is written at. */
type SharedFieldPaths<Vs extends ReadonlyArray<unknown>, Path extends string> =
  AllStructs<Vs> extends true
    ? Optionality<Vs> extends "none"
      ? SharedPaths<StructsOf<Vs>, `${Path}.`>
      : { readonly [_ in Path]: Schema.optionalKey<FirestoreSchema.DeleteField> }
    : AllUnions<Vs> extends true
      ? SharedUnionPath<Vs, Path> & SharedPaths<UnionsMemberFields<Vs>, `${Path}.`>
      : { readonly [_ in Path]: Schema.optionalKey<SharedTakes<Vs, "unchecked">> };

/**
 * What a union takes in an update in `Mode`: a replacement with any member it
 * may be replaced with, the removal where it is {@link Optional}, and a patch
 * of its Shared Fields, unless it is {@link Optional} and the update checked.
 */
type UnionTakes<
  Members extends ReadonlyArray<VariantSchema.Struct<any>>,
  Optional extends boolean,
  Mode extends UpdateMode,
> = Schema.Union<
  readonly [
    ...(HasSharedFields<Members, Mode> extends true
      ? Optional extends true
        ? Mode extends "unchecked"
          ? [SharedPatch<MemberFields<Members>, Mode>]
          : []
        : [SharedPatch<MemberFields<Members>, Mode>]
      : []),
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
> = Optional extends true
  ? true
  : ReplaceableCreates<Members> extends readonly []
    ? HasSharedFields<Members, "unchecked">
    : true;

/** What a union takes as a field of the struct it sits in, or `never` where it takes nothing. */
type UnionFieldUpdate<
  Members extends ReadonlyArray<VariantSchema.Struct<any>>,
  Optional extends boolean,
  Mode extends UpdateMode,
> =
  IsUnionWritable<Members, Optional> extends true
    ? Schema.optionalKey<UnionTakes<Members, Optional, Mode>>
    : never;

/**
 * The paths a union at `Path` is written at: its own, whole, and that of each
 * of its Shared Fields.
 */
type UnionPaths<
  Members extends ReadonlyArray<VariantSchema.Struct<any>>,
  Optional extends boolean,
  Path extends string,
> = (Optional extends true
  ? {
      readonly [_ in Path]: Schema.optionalKey<
        ReplaceableCreates<Members> extends readonly []
          ? FirestoreSchema.DeleteField
          : FirestoreSchema.DeleteFieldOr<Schema.Union<ReplaceableCreates<Members>>>
      >;
    }
  : ReplaceableCreates<Members> extends readonly []
    ? {}
    : { readonly [_ in Path]: Schema.optionalKey<Schema.Union<ReplaceableCreates<Members>>> }) &
  SharedPaths<MemberFields<Members>, `${Path}.`>;

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
        readonly update: UnionFieldUpdate<Members, false, "unchecked">;
      }
    : {
        readonly read: VariantSchema.Union<Members, "read">;
        readonly create: UnionCreate<Members>;
      };

/**
 * Type-level representation of {@link Union}.
 *
 * It is the union of its members as they are read, and carries the members it
 * was made of, which a field holding it is written through.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface Union<in out Members extends ReadonlyArray<VariantSchema.Struct<any>>>
  extends VariantSchema.Union<Members, "read">, VariantSchema.Field<UnionSchemas<Members>> {
  /** The shape a snapshot decodes into: any member, as it is read. */
  readonly read: Schema.Union<{
    readonly [K in keyof Members]: VariantSchema.Extract<"read", Members[K]>;
  }>;
  /** The shape `setDoc` writes: any member, in its `create` shape. */
  readonly create: UnionCreate<Members>;
  /**
   * The shape `updateDoc` writes to a document that is the union: a patch of
   * its Shared Fields alone.
   *
   * A document is never written whole by an update: it changes member through
   * `setDoc`.
   *
   * @see {@link Union.updateUnchecked} for patching a key only some members
   * hold
   */
  readonly update: UnionUpdate<Members, "checked">;
  /**
   * The shape `updateDoc` writes to a document that is the union with
   * `mode: "unchecked"`, also taking a patch of a key only some members hold.
   *
   * **When to use**
   *
   * Use when the caller knows which member the document holds.
   *
   * @see {@link Union.update} for the checked update
   * @see {@link Class.updateUnchecked} for the same rule on a class
   */
  readonly updateUnchecked: UnionUpdate<Members, "unchecked">;
  readonly [UnionTypeId]: Members;
}

/** The patch of a document that is a union, or an empty one where it takes no key. */
type UnionDocumentPatch<
  Members extends ReadonlyArray<VariantSchema.Struct<any>>,
  Mode extends UpdateMode,
> = [SharedPatch<MemberFields<Members>, Mode>] extends [never]
  ? Schema.Struct<{}>
  : SharedPatch<MemberFields<Members>, Mode>;

/**
 * The update of a document that is a {@link Union}, taking the patches `Mode`
 * allows.
 *
 * **Details**
 *
 * It takes a patch of the Shared Fields, and under `unchecked` of a key only
 * some members hold, by the rule a union field is patched by - see
 * {@link Update}. Each is written at its path.
 *
 * It takes no replacement or removal of the document: a document changes
 * member, such as to a new discriminator or version, through `setDoc`.
 *
 * @see {@link Union.update} and {@link Union.updateUnchecked}, which are this
 * in each mode
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface UnionUpdate<
  in out Members extends ReadonlyArray<VariantSchema.Struct<any>>,
  in out Mode extends UpdateMode = "checked",
> extends Schema.decodeTo<
  Schema.toType<UnionDocumentPatch<Members, Mode>>,
  Schema.Struct<
    Struct_.Simplify<SharedPaths<MemberFields<Members>, "">> extends infer P extends
      Schema.Struct.Fields
      ? P
      : never
  >
> {}

/**
 * Declares a document or field that holds one of several structs or classes.
 *
 * **When to use**
 *
 * Use when documents of one collection, or one field, come in several shapes,
 * such as the states of a job or the versions of a document, told apart by a
 * literal field.
 *
 * **Details**
 *
 * It is Effect's own union, with no tag of this library's. A snapshot decodes
 * into the first member that matches, so a literal field narrows it, and data
 * matching no member fails with a schema issue. A `create` takes any member
 * in the shape `setDoc` writes it. A value that fits several members, on
 * `create` or in a replacement, is taken as the first in declaration order, as
 * `Schema.Union` does.
 *
 * As a field, an update may:
 *
 * - Replace it with {@link Patch.replace} and any member, in its `create`
 *   shape. A member holding a field that `setDoc` or an update leaves out -
 *   {@link Immutable}, or a read-only field - is never replaced, as with a
 *   struct.
 * - Remove it with {@link FieldValue.deleteField}, where it is
 *   {@link Optional}.
 * - Patch its Shared Fields: keys every member holds, with a value every member
 *   takes and stores the same way, so the patch is right whichever member the
 *   document holds. A struct every member holds at a key is patched at its own
 *   Shared Fields. A union every member holds at a key is written by this same
 *   rule, across all of those unions. A Record is never shared.
 * - Under `unchecked`, also patch a key only some members hold, such as
 *   `completedAt` on a job the caller knows is done. The value is checked
 *   against just those members and written at its path. An {@link Optional}
 *   union is only patched under `unchecked`.
 *
 * As a whole document, `setDoc` writes any member and changing member takes a
 * whole `setDoc`. An update patches it by the same rule - see
 * {@link UnionUpdate}.
 *
 * @example A field holding one of several states
 * ```ts
 * import { Schema } from "effect";
 * import {
 *   FieldValue,
 *   FirestoreModel,
 *   FirestoreSchema,
 *   Patch,
 * } from "@visiolab/effect-firebase/firestore";
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
 * // Where the job is known to be done: written at "state.completedAt".
 * Job.updateUnchecked.make({ state: { completedAt: FieldValue.serverTimestamp } });
 * ```
 *
 * @see {@link Class} for a document with a single shape
 * @see {@link UpdateMode} for what `checked` and `unchecked` patch
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
 * Declares a field written once, when the document is created.
 *
 * **When to use**
 *
 * Use for a field that must never change after creation, such as a sign-up
 * source or an owner id.
 *
 * **Details**
 *
 * It is read, and written by `setDoc`, but left out of `update`, so no update
 * can change it. A struct or union member holding it is never replaced by an
 * update, since that would rewrite it.
 *
 * @see {@link FieldOnly} for keeping a field to other variants
 * @see {@link Optional} for a field that may be missing
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
 * Declares a timestamp field that the client or the server may set.
 *
 * **When to use**
 *
 * Use for a timestamp a write may leave to the server, such as `createdAt` or
 * `updatedAt`. Where the server must never set it, use the schema itself as
 * the field.
 *
 * **Details**
 *
 * `setDoc` and `updateDoc` take either a value of `schema` or
 * {@link FieldValue.serverTimestamp}. A read takes `schema` alone, since the
 * sentinel is resolved by the time a document comes back.
 *
 * `schema` decides what the instant is held as:
 * {@link FirestoreSchema.Timestamp} where precision finer than a millisecond
 * must survive a round trip, or `Schema.DateTimeUtc` or `Schema.Date` where one
 * of those is easier to work with. Firestore stores each as a timestamp.
 *
 * @example Timestamps held two ways
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * class Session extends FirestoreModel.Class<Session>("Session")({
 *   createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
 *   seenAt: FirestoreModel.Timestamp(Schema.DateTimeUtc),
 * }) {}
 *
 * Session.update.make({ seenAt: FieldValue.serverTimestamp });
 * ```
 *
 * @see {@link FirestoreSchema.Timestamp} for the schema that keeps full precision
 * @see {@link FirestoreSchema.ServerTimestampOr} for the write schema this
 * declares
 * @see {@link FieldValue.serverTimestamp} for the sentinel a write hands it
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
 * Declares a number field that a write may set or have the server increment.
 *
 * **When to use**
 *
 * Use for counters and totals more than one client may change at once: an
 * increment keeps the total right, where reading the number and writing the
 * sum back loses concurrent writes. Where it must never be incremented, use
 * the schema itself as the field.
 *
 * **Details**
 *
 * `setDoc` and `updateDoc` take either a value of `schema` or
 * {@link FieldValue.increment} / {@link FieldValue.decrement}. A read takes
 * `schema` alone, since the document holds the sum the server computed.
 *
 * `schema` decides what the number may be, on both reads and writes: hand it
 * `Schema.Int` for whole steps, or `Schema.Finite` for fractions. An increment
 * is not checked against it, since the server computes the sum and only the
 * next read sees it.
 *
 * @example A counter and a balance
 * ```ts
 * import { Schema } from "effect";
 * import { FieldValue, FirestoreModel } from "@visiolab/effect-firebase/firestore";
 *
 * class Account extends FirestoreModel.Class<Account>("Account")({
 *   visits: FirestoreModel.Number(Schema.Int),
 *   balance: FirestoreModel.Number(Schema.Finite),
 * }) {}
 *
 * Account.update.make({ visits: FieldValue.increment(1) });
 * ```
 *
 * @see {@link FieldValue.increment} for the sentinel a write hands it
 * @see {@link FirestoreSchema.IncrementOr} for the write schema this declares
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
 * Declares an array field that an update may write whole, or have the server
 * add elements to or remove elements from.
 *
 * **When to use**
 *
 * Use for an array more than one client may change at once, such as a list of
 * tags: {@link FieldValue.arrayUnion} and {@link FieldValue.arrayRemove} keep
 * an element another client added at the same time, where reading the array
 * and writing it back does not.
 *
 * **Details**
 *
 * An update takes the array, `arrayUnion` or `arrayRemove`. A read takes the
 * array alone. `setDoc` takes the array alone too: adding to a missing array
 * writes the elements as they are, and removing from one writes it empty,
 * which is not what was meant.
 *
 * Elements are matched by value, all the way down, so removing a map from the
 * array means handing over every key it holds - see
 * {@link FieldValue.ArrayRemove}. `item` is what each element is held as. It
 * cannot be an array, which Firestore does not nest, or a field, since an
 * element is always written whole.
 *
 * @example Adding a tag
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
 * @see {@link FieldValue.arrayUnion} and {@link FieldValue.arrayRemove} for the
 * sentinels an update hands it
 * @see {@link FirestoreSchema.ArrayOr} for the update schema this declares
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Array: <S extends Schema.Top>(item: S) => Array<S> = firestoreModel.Array;

/**
 * Type-level representation of {@link Record}.
 *
 * It carries the key and value it was made of, which an update reaches into.
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
 * Declares a map field whose keys come from the data, which an update writes
 * key by key.
 *
 * **When to use**
 *
 * Use for a map keyed by data rather than by a fixed set of fields: a counter
 * per option, an entry per member, a lookup table. Writing key by key lets two
 * clients each change a key of the same map without reading it first.
 *
 * **Details**
 *
 * A read and `setDoc` hold it as `Schema.Record(key, value)`, with each value
 * in its read or create shape, so `setDoc` takes the sentinels `value` takes.
 * An update takes a patch, writing each key it carries at its own path, in the
 * update shape of `value`: a {@link Number} takes
 * {@link FieldValue.increment}, an {@link Array} {@link FieldValue.arrayUnion},
 * a {@link Timestamp} {@link FieldValue.serverTimestamp}.
 *
 * - Where `key` is a string, refined or not, any key may be missing, so each
 *   takes {@link FieldValue.deleteField}. A value that is itself a struct or
 *   Record is treated like an {@link Optional} struct: written whole with
 *   {@link Patch.replace} or removed, and only patched by
 *   {@link Class.updateUnchecked}.
 * - Where `key` is a union of literals, the Record holds every key, and an
 *   update treats it as a struct with a field per key: no key is removed
 *   unless `value` is {@link Optional}.
 *
 * Either way, it takes {@link Patch.replace} to be written whole, unless
 * `value` holds a field `setDoc` or an update leaves out.
 *
 * A key's path is the key as `key` encodes it, so the update requires any
 * service `key` needs to encode. A key no path can name - empty, or containing
 * a `.` - fails the update when it is encoded, or throws when the Record is
 * declared if it is a literal. A value no update writes, such as
 * {@link Immutable}, leaves the whole Record out of the update.
 *
 * @example Patching keys of a map
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
 * @see {@link Struct} for a map with a fixed set of fields
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
          readonly update: UnionFieldUpdate<Members, true, "unchecked">;
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
 * It carries the field it was made of as `field`, which an update reaches into
 * where that is a struct or a {@link Record}.
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
 * Declares a field a document may go without, and an update may remove.
 *
 * **When to use**
 *
 * Use for a field that may be missing from a document. Wrap any schema, field,
 * struct, union or {@link Record} in it.
 *
 * **Details**
 *
 * A read and `setDoc` hold it as an optional key: a missing field is left out
 * rather than stored as `null`. An update also takes
 * {@link FieldValue.deleteField}, since leaving a field out of an update leaves
 * it as it is. Inside a struct, an optional field is removed the same way, at
 * its path.
 *
 * A field with no `update` variant, such as {@link Immutable}, becomes optional
 * where it is read and created, and stays out of the update. Making a field
 * optional twice is the same as once.
 *
 * An optional struct is where the stored document decides what a patch does: a
 * patch written into a missing struct creates it holding only the patch, and
 * the document no longer reads. So {@link Class.update} writes it whole with
 * {@link Patch.replace} or removes it, and only {@link Class.updateUnchecked}
 * patches it, for a caller who knows it is there.
 *
 * @example Optional fields
 * ```ts
 * import { Schema } from "effect";
 * import { FirestoreModel, FirestoreSchema } from "@visiolab/effect-firebase/firestore";
 *
 * const Address = FirestoreModel.Struct({ city: Schema.String });
 *
 * class User extends FirestoreModel.Class<User>("User")({
 *   nickname: FirestoreModel.Optional(Schema.String),
 *   lastSeenAt: FirestoreModel.Optional(FirestoreModel.Timestamp(FirestoreSchema.Timestamp)),
 *   address: FirestoreModel.Optional(Address),
 * }) {}
 * ```
 *
 * @example Updating an optional struct
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
 * @see {@link FieldValue.deleteField} for removing it in an update
 * @see {@link UpdateMode} for when an optional struct may be patched
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Optional: <F extends Value>(self: F) => F extends AnyOptional ? F : Optional<F> =
  firestoreModel.Optional;
