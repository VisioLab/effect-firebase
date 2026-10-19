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
 * import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
 * import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
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
import type * as Timestamp_ from "./Timestamp.ts";

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
 * Groups fields without building a class, for nesting inside a document or
 * sharing between several.
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
 * Pulls one variant out of a field group as a plain schema.
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
 * The field definitions a class or group was built from.
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

const OptionalGroupTypeId = firestoreModel.OptionalGroupTypeId;

const RecordTypeId = firestoreModel.RecordTypeId;

/**
 * Anything a field is declared as: a schema, a field, a group or a
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

/** The key and the value of a Record a field is, or `never` where it is none. */
type RecordOf<F> = F extends { readonly [OptionalGroupTypeId]: VariantSchema.Struct<any> }
  ? never
  : F extends { readonly [OptionalGroupTypeId]: infer R }
    ? RecordParts<R>
    : RecordParts<F>;

/** The key and the value a Record field carries, or `never` where it is none. */
type RecordParts<F> = F extends {
  readonly [RecordTypeId]: {
    readonly key: infer K extends Schema.Record.Key;
    readonly value: infer V extends Value;
  };
}
  ? { readonly key: K; readonly value: V }
  : never;

/** Whether `V` is something an update reaches into: a group or a Record. */
type IsNode<V> = V extends
  | VariantSchema.Struct<any>
  | { readonly [OptionalGroupTypeId]: any }
  | { readonly [RecordTypeId]: any }
  ? true
  : false;

/** Whether an update writes anything into a Record of `V`, at any depth. */
type IsWritable<V extends Value> = [RecordOf<V>] extends [never]
  ? IsNode<V> extends true
    ? true
    : [UpdateSchema<V>] extends [never]
      ? false
      : true
  : IsWritable<RecordOf<V>["value"]>;

/** The fields of a Record at the keys of `K` known up front, as a group holds them. */
type KnownFields<K extends Schema.Record.Key, V extends Value> = {
  readonly [_ in KnownKeys<K["Type"]> & string]: V;
};

/** What a key of a Record only the data names takes, which may be missing. */
type EntryUpdate<V extends Value, Mode extends UpdateMode> =
  V extends VariantSchema.Struct<infer G>
    ? GroupTakes<G, true, Mode>
    : V extends { readonly [OptionalGroupTypeId]: VariantSchema.Struct<infer G> }
      ? GroupTakes<G, true, Mode>
      : [RecordOf<V>] extends [never]
        ? FirestoreSchema.DeleteFieldOr<WithoutOptionalKey<UpdateSchema<V>>>
        : RecordTakes<RecordOf<V>["key"], RecordOf<V>["value"], true, Mode>;

/** The patch of a Record: key by key. */
type RecordPatch<K extends Schema.Record.Key, V extends Value, Mode extends UpdateMode> =
  IsOpen<K> extends true
    ? Schema.$Record<Schema.toType<K>, EntryUpdate<V, Mode>>
    : Schema.Struct<UpdateFields<KnownFields<K, V>, Mode>>;

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
type AsEntry<V extends Value> = V extends { readonly [OptionalGroupTypeId]: any }
  ? V
  : IsNode<V> extends true
    ? Optional<V>
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
          : UpdatePaths<KnownFields<K, V>, Mode, `${Path}.`>);

/**
 * Which patches an update takes.
 *
 * - `checked` takes only the patches that leave any document it may be
 *   written to readable. An {@link Optional} group is written whole with
 *   {@link Patch.replace} or removed, and never patched: a patch written into
 *   a group the document goes without would create it holding only what the
 *   patch carried.
 * - `unchecked` takes a patch into an {@link Optional} group as well, which is
 *   only right where the group is known to be there.
 *
 * They differ only in which patches they take, and only at an
 * {@link Optional} group: a patch both take is written the same by both. What
 * a field takes, and the paths it is written at, are the same in both.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type UpdateMode = "checked" | "unchecked";

/** The fields of the group a field reaches into, or `never` where it is none. */
type GroupOf<F> =
  F extends VariantSchema.Struct<infer G>
    ? G
    : F extends { readonly [OptionalGroupTypeId]: VariantSchema.Struct<infer G> }
      ? G
      : never;

/**
 * Whether a group may be written whole by an update: only where every field it
 * holds, at any depth, is written both by `set`, whose shape a replacement
 * takes, and by an update.
 */
type IsReplaceable<Fields extends VariantSchema.Struct.Fields> = false extends {
  [K in keyof Fields]: [RecordOf<Fields[K]>] extends [never]
    ? [GroupOf<Fields[K]>] extends [never]
      ? [UpdateSchema<Fields[K]>] extends [never]
        ? false
        : [VariantSchemaOf<Fields[K], "create">] extends [never]
          ? false
          : true
      : IsReplaceable<GroupOf<Fields[K]>>
    : IsWritable<RecordOf<Fields[K]>["value"]> extends true
      ? IsReplaceable<{ readonly _: RecordOf<Fields[K]>["value"] }>
      : false;
}[keyof Fields]
  ? false
  : true;

/** The shape a group is written whole in, as `set` would write it. */
type WholeGroup<Fields extends VariantSchema.Struct.Fields> = VariantSchema.Extract<
  "create",
  VariantSchema.Struct<Fields>
>;

/**
 * The schema of a {@link Patch.replace} of a group written whole as `S`. It is
 * made from what `S` is made from, so the constructor defaults of the group
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

/** What a group takes in `Mode`, as a field of the group it sits in. */
type GroupUpdate<
  Fields extends VariantSchema.Struct.Fields,
  Optional extends boolean,
  Mode extends UpdateMode,
> = Schema.optionalKey<GroupTakes<Fields, Optional, Mode>>;

/** What a group takes in `Mode`. */
type GroupTakes<
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
    ...(IsReplaceable<Fields> extends true ? [ReplaceSchema<WholeGroup<Fields>>] : []),
    ...(Optional extends true ? [FirestoreSchema.DeleteField] : []),
  ]
>;

/**
 * The fields of an update in `Mode`: every one that may change, each of them
 * optional.
 *
 * A group every document holds takes a patch of its own, and an
 * {@link Optional} group takes the removal, and a patch only under
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
  F extends VariantSchema.Struct<infer G>
    ? GroupUpdate<G, false, Mode>
    : F extends { readonly [OptionalGroupTypeId]: infer N }
      ? N extends VariantSchema.Struct<infer G>
        ? GroupUpdate<G, true, Mode>
        : RecordUpdate<RecordParts<N>, true, Mode>
      : F extends { readonly [RecordTypeId]: any }
        ? RecordUpdate<RecordParts<F>, false, Mode>
        : [UpdateSchema<F>] extends [never]
          ? never
          : Schema.optionalKey<UpdateSchema<F>>;

/** What a Record takes as a field of the group it sits in. */
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
 * A group's own key takes the group written whole, where an update writes
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
      [K in keyof Fields & string]: Fields[K] extends VariantSchema.Struct<infer G>
        ? (IsReplaceable<G> extends true
            ? { readonly [_ in `${Prefix}${K}`]: Schema.optionalKey<WholeGroup<G>> }
            : {}) &
            UpdatePaths<G, Mode, `${Prefix}${K}.`>
        : Fields[K] extends { readonly [OptionalGroupTypeId]: VariantSchema.Struct<infer G> }
          ? {
              readonly [_ in `${Prefix}${K}`]: Schema.optionalKey<
                IsReplaceable<G> extends true
                  ? FirestoreSchema.DeleteFieldOr<WholeGroup<G>>
                  : FirestoreSchema.DeleteField
              >;
            } & UpdatePaths<G, Mode, `${Prefix}${K}.`>
          : [RecordOf<Fields[K]>] extends [never]
            ? [UpdateSchema<Fields[K]>] extends [never]
              ? {}
              : { readonly [_ in `${Prefix}${K}`]: Schema.optionalKey<UpdateSchema<Fields[K]>> }
            : RecordPaths<
                RecordOf<Fields[K]>["key"],
                RecordOf<Fields[K]>["value"],
                Fields[K] extends { readonly [OptionalGroupTypeId]: any } ? true : false,
                Mode,
                `${Prefix}${K}`
              >;
    }[keyof Fields & string]
  > & {}
>;

/**
 * The `update` variant of a set of fields, taking the patches `Mode` allows.
 *
 * It is handed a nested partial - the fields that change, a group carrying
 * only those of its own that do - and writes each of them at its path, so
 * `{ address: { city } }` becomes `{ "address.city": city }`. That is what
 * makes it a merge rather than a replacement: Firestore merges an update at
 * the top level only, and replaces a map it is handed as a value, but a path
 * counts as the top level and leaves the rest of the map as it is. It is also
 * what lets a sentinel sit at any depth, since Firestore takes one only at the
 * top level of an update, and removal is the one that minds.
 *
 * A group - {@link Struct}, or a class - is what it reaches into. Handed
 * {@link Patch.replace} instead, it is written whole, at its path, as `set`
 * would write it, and one made {@link Optional} may be removed whole besides.
 * Any other schema, a plain `Schema.Struct` included, is a value, written
 * whole. The patch says which it is, not the key - see the `Patch` module.
 *
 * Firestore applies an update to whatever the document holds, without checking
 * it against anything, so a patch that is right for one document may leave
 * another unreadable: written into a group the document goes without, it
 * creates the group holding only what the patch carried. Under `checked`, an
 * {@link Optional} group is replaced or removed and never patched, and a patch
 * is refused by the type and by the encoding. Under `unchecked` it may be
 * patched too - see {@link UpdateMode}.
 *
 * A group holding a field that `set` or an update leaves out - {@link Immutable},
 * or a field only ever read - is never replaced, since that would change or
 * drop the field. It is patched where every document holds it, and only removed by a
 * checked update where it is {@link Optional}.
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
  // Declared rather than measured, which recursing through every group for
  // replaceability makes too deep for the compiler.
  in out Fields extends VariantSchema.Struct.Fields,
  in out Mode extends UpdateMode = "checked",
> extends Schema.decodeTo<
  Schema.toType<Schema.Struct<UpdateFields<Fields, Mode>>>,
  Schema.Struct<UpdatePaths<Fields, Mode> extends infer P extends Schema.Struct.Fields ? P : never>
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
   * may be written to readable: an {@link Optional} group is replaced with
   * {@link Patch.replace} or removed, never patched.
   */
  readonly update: Update<Fields, "checked">;
  /**
   * What `update` writes, taking a patch into an {@link Optional} group as
   * well. Every patch {@link Class.update} takes, it takes too, and writes the
   * same.
   *
   * Such a patch is only right where the group is there, which the caller
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

/**
 * A union of document schemas, in every variant.
 *
 * @stability unstable
 * @category constructors
 * @since 0.2.0
 */
export const Union = firestoreModel.Union;

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
export interface Timestamp<
  S extends Schema.Codec<unknown, Timestamp_.TimestampLike, unknown, unknown>,
> extends VariantSchema.Field<{
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
 * are to survive a round trip, {@link FirestoreSchema.DateTimeUtcFromTimestamp}
 * where a `DateTime.Utc` is the easier value to hold onto.
 *
 * ```ts
 * import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
 * import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
 *
 * class Session extends FirestoreModel.Class<Session>("Session")({
 *   createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp),
 *   seenAt: FirestoreModel.Timestamp(FirestoreSchema.DateTimeUtcFromTimestamp),
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
export const Timestamp: <
  S extends Schema.Codec<unknown, Timestamp_.TimestampLike, unknown, unknown>,
>(
  schema: S,
) => Timestamp<S> = firestoreModel.Timestamp;

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
 * import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
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
 * import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
 * import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
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
 * import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
 * import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
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
 * value that is a group or a Record itself is treated as one a document may go
 * without - written whole with {@link Patch.replace} or removed, and only
 * patched by {@link Class.updateUnchecked}, the way an {@link Optional} group
 * is. The Record itself is patched even where it may be missing, since a patch
 * only ever writes keys it may hold or not.
 *
 * Where `key` is a union of literals, the Record holds every one of them, and
 * an update treats it as a group with a field per key: no key is removed
 * unless `value` is {@link Optional}, and the encoded update names each path.
 *
 * Either way it takes {@link Patch.replace} to be written whole, unless
 * `value` holds a field that `set` or an update leaves out.
 *
 * The path of a key is the key as `key` encodes it. A key no path can name -
 * empty, or holding a `.` - fails the update when it is encoded, or, where it
 * is a literal, throws when the Record is declared. A value made
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

/**
 * Type-level representation of {@link Optional}, made of a {@link Record}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface OptionalRecord<in out R extends AnyRecord> extends VariantSchema.Field<
  IsWritable<RecordOf<R>["value"]> extends true
    ? {
        readonly read: Schema.optionalKey<R["schemas"]["read"]>;
        readonly create: Schema.optionalKey<R["schemas"]["create"]>;
        readonly update: Schema.optionalKey<
          RecordTakes<RecordOf<R>["key"], RecordOf<R>["value"], true, "unchecked">
        >;
      }
    : {
        readonly read: Schema.optionalKey<R["schemas"]["read"]>;
        readonly create: Schema.optionalKey<R["schemas"]["create"]>;
      }
> {
  readonly [OptionalGroupTypeId]: R;
}

/**
 * Type-level representation of {@link Optional}, made of a group.
 *
 * It carries the group it was made of, which is what an update reaches into.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export interface OptionalGroup<G extends VariantSchema.Struct<any>> extends VariantSchema.Field<{
  readonly read: Schema.optionalKey<VariantSchema.Extract<"read", G>>;
  readonly create: Schema.optionalKey<VariantSchema.Extract<"create", G>>;
  readonly update: GroupUpdate<G[typeof VariantSchema.TypeId], true, "unchecked">;
}> {
  readonly [OptionalGroupTypeId]: G;
}

/**
 * Type-level representation of {@link Optional}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type Optional<F extends Value> =
  F extends VariantSchema.Struct<any>
    ? OptionalGroup<F>
    : F extends AnyRecord
      ? OptionalRecord<F>
      : F extends Schema.Top
        ? VariantSchema.Field<{
            readonly read: Schema.optionalKey<F>;
            readonly create: Schema.optionalKey<F>;
            readonly update: Schema.optionalKey<FirestoreSchema.DeleteFieldOr<F>>;
          }>
        : F extends VariantSchema.Field<infer S>
          ? VariantSchema.Field<{
              readonly [K in keyof S]: S[K] extends Schema.Top
                ? K extends "update"
                  ? Schema.optionalKey<FirestoreSchema.DeleteFieldOr<S[K]>>
                  : Schema.optionalKey<S[K]>
                : never;
            }>
          : never;

/**
 * A field a document may go without, and an update may take away.
 *
 * The read and the create hold it as an optional key, since a field that is
 * not there is left out rather than stored as nothing. The update takes
 * {@link FieldValue.deleteField} besides, because leaving a field out of an
 * update leaves it as it is, and removing it has to be asked for.
 *
 * It takes a schema, a field, a group or a {@link Record}, so it makes any of
 * the others optional too:
 *
 * ```ts
 * import { Schema } from "effect";
 * import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
 * import * as FirestoreSchema from "@visiolab/effect-firebase/firestore/FirestoreSchema";
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
 * Inside a group, an optional field is removed the same way as at the top,
 * since an update writes a group at its paths - see {@link Update}.
 *
 * A group made optional is the one place where what the document holds
 * decides what a patch does: where the group is missing, a patch written into
 * it creates it holding only the patch, and the document no longer reads. So
 * {@link Class.update} writes it whole or removes it, and only
 * {@link Class.updateUnchecked} patches it, for a caller who knows it is
 * there:
 *
 * ```ts
 * import { Schema } from "effect";
 * import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
 * import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
 * import * as Patch from "@visiolab/effect-firebase/firestore/Patch";
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
export const Optional: <F extends Value>(self: F) => Optional<F> = firestoreModel.Optional;
