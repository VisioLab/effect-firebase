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
import type { Schema, Struct as Struct_ } from "effect";
import type { VariantSchema } from "effect/schema";
import type * as FirestoreSchema from "./FirestoreSchema.ts";
import * as firestoreModel from "./internal/firestoreModel.ts";
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

/** The schema a field is updated through, or `never` where it cannot be. */
type UpdateSchema<F> =
  F extends VariantSchema.Field<infer S>
    ? "update" extends keyof S
      ? S["update"] extends Schema.Top
        ? S["update"]
        : never
      : never
    : F extends Schema.Top
      ? F
      : never;

/** Whether a document cannot be read without the field. */
type IsRequired<F> =
  F extends VariantSchema.Field<infer S>
    ? "read" extends keyof S
      ? S["read"] extends { readonly "~type.optionality": "required" }
        ? true
        : false
      : false
    : F extends { readonly "~type.optionality": "required" }
      ? true
      : false;

/**
 * Drops the default a field is constructed with, which a patch never fills
 * in.
 */
type WithoutConstructorDefault<S> =
  S extends Schema.withConstructorDefault<infer Inner> ? Inner : S;

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (
  u: infer I,
) => void
  ? I
  : never;

/**
 * Which patches an update takes.
 *
 * - `checked` takes only the patches that leave any document it may be
 *   written to readable: one into an {@link Optional} group either removes it
 *   or carries every field the group cannot go without, so that it holds
 *   whether the patch creates the group or overwrites it. That goes for every
 *   group inside it too.
 * - `unchecked` takes any partial patch into an {@link Optional} group as
 *   well, which is only right where the group is known to be there.
 *
 * The two only tell apart at an {@link Optional} group. What a field takes,
 * and the paths it is written at, are the same in both.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type UpdateMode = "checked" | "unchecked";

/**
 * The mode a set of fields is patched in. `complete` is what an
 * {@link Optional} group is patched in under `checked`, since the patch may
 * be what creates it.
 */
type PatchMode = UpdateMode | "complete";

type OptionalGroupFields<F> = F extends {
  readonly [OptionalGroupTypeId]: VariantSchema.Struct<infer G>;
}
  ? G
  : never;

type PatchFields<Fields extends VariantSchema.Struct.Fields, Mode extends PatchMode> = {
  readonly [
    K in keyof Fields as Fields[K] extends VariantSchema.Struct<any>
      ? K
      : [OptionalGroupFields<Fields[K]>] extends [never]
        ? [UpdateSchema<Fields[K]>] extends [never]
          ? Mode extends "complete"
            ? IsRequired<Fields[K]> extends true
              ? K
              : never
            : never
          : K
        : K
  ]: Fields[K] extends VariantSchema.Struct<infer G>
    ? Mode extends "complete"
      ? Schema.Struct<PatchFields<G, Mode>>
      : Schema.optionalKey<Schema.Struct<PatchFields<G, Mode>>>
    : [OptionalGroupFields<Fields[K]>] extends [never]
      ? Mode extends "complete"
        ? IsRequired<Fields[K]> extends true
          ? [UpdateSchema<Fields[K]>] extends [never]
            ? Schema.Never
            : WithoutConstructorDefault<UpdateSchema<Fields[K]>>
          : Schema.optionalKey<UpdateSchema<Fields[K]>>
        : Schema.optionalKey<UpdateSchema<Fields[K]>>
      : Schema.optionalKey<
          FirestoreSchema.DeleteFieldOr<
            Schema.Struct<
              PatchFields<
                OptionalGroupFields<Fields[K]>,
                Mode extends "unchecked" ? "unchecked" : "complete"
              >
            >
          >
        >;
};

/**
 * The fields of an update in `Mode`: every one that may change, each of them
 * optional, and each group a patch of its own.
 *
 * A group every document holds takes a partial patch. An {@link Optional}
 * group takes a removal, or a patch that is partial under `unchecked` and
 * carries every field it cannot go without under `checked` - see
 * {@link UpdateMode}.
 *
 * @stability unstable
 * @category models
 * @since 0.2.0
 */
export type UpdateFields<
  Fields extends VariantSchema.Struct.Fields,
  Mode extends UpdateMode = "checked",
> = PatchFields<Fields, Mode>;

/**
 * The fields an update is written as: one optional key per path it can write
 * at.
 *
 * A group has no key of its own, since it is only ever written field by field,
 * unless it is {@link Optional} - then its key takes the removal and nothing
 * else.
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
        ? UpdatePaths<G, Mode, `${Prefix}${K}.`>
        : Fields[K] extends { readonly [OptionalGroupTypeId]: VariantSchema.Struct<infer G> }
          ? {
              readonly [_ in `${Prefix}${K}`]: Schema.optionalKey<FirestoreSchema.DeleteField>;
            } & UpdatePaths<G, Mode, `${Prefix}${K}.`>
          : [UpdateSchema<Fields[K]>] extends [never]
            ? {}
            : { readonly [_ in `${Prefix}${K}`]: Schema.optionalKey<UpdateSchema<Fields[K]>> };
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
 * A group - {@link Struct}, or a class - is what it reaches into, and one made
 * {@link Optional} may be removed whole besides. Any other schema, a plain
 * `Schema.Struct` included, is a value, written whole.
 *
 * Firestore applies an update to whatever the document holds, without checking
 * it against anything, so a patch that is right for one document may leave
 * another unreadable: written into a group the document goes without, it
 * creates the group holding only what the patch carried. Under `checked`, a
 * patch into an {@link Optional} group has to carry every field the group
 * cannot go without, at any depth, and a patch that does not is refused by
 * the type and by the encoding. Under `unchecked` it may be partial - see
 * {@link UpdateMode}.
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
  Fields extends VariantSchema.Struct.Fields,
  Mode extends UpdateMode = "checked",
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
   * may be written to readable.
   */
  readonly update: Update<Fields, "checked">;
  /**
   * What `update` writes, taking a partial patch into an {@link Optional}
   * group as well.
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
  readonly update: Schema.optionalKey<
    FirestoreSchema.DeleteFieldOr<
      Schema.Struct<UpdateFields<G[typeof VariantSchema.TypeId], "unchecked">>
    >
  >;
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
export type Optional<F extends VariantSchema.Field<any> | VariantSchema.Struct<any> | Schema.Top> =
  F extends VariantSchema.Struct<any>
    ? OptionalGroup<F>
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
 * It takes a schema, a field or a group, so it makes any of the others
 * optional too:
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
 * A group made optional is still reached into by an update, field by field,
 * and takes the removal of the whole map besides. Inside a group, an optional
 * field is removed the same way as at the top, since an update writes a group
 * at its paths - see {@link Update}.
 *
 * Since a document may go without the group, a patch into it may be what
 * creates it, so {@link Class.update} takes one only where it carries every
 * field the group cannot go without:
 *
 * ```ts
 * import { Schema } from "effect";
 * import * as FieldValue from "@visiolab/effect-firebase/firestore/FieldValue";
 * import * as FirestoreModel from "@visiolab/effect-firebase/firestore/FirestoreModel";
 *
 * const Address = FirestoreModel.Struct({ city: Schema.String, zip: Schema.String });
 *
 * class Customer extends FirestoreModel.Class<Customer>("Customer")({
 *   address: FirestoreModel.Optional(Address),
 * }) {}
 *
 * Customer.update.make({ address: { city: "Berlin", zip: "10115" } }); // created or overwritten whole
 * Customer.update.make({ address: FieldValue.deleteField });           // removed
 * Customer.updateUnchecked.make({ address: { city: "Berlin" } });      // the caller knows it is there
 * ```
 *
 * Either way it is written at its paths, so where the group is there, the
 * fields it may go without and the patch leaves out are kept. A group holding
 * a field no update writes - {@link Immutable}, say - can only be removed by
 * {@link Class.update}, since no patch could create it whole.
 *
 * @stability unstable
 * @category schemas
 * @since 0.2.0
 */
export const Optional: <
  F extends VariantSchema.Field<any> | VariantSchema.Struct<any> | Schema.Top,
>(
  self: F,
) => Optional<F> = firestoreModel.Optional;
