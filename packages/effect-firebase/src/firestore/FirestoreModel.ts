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
 * User        // what a snapshot decodes into
 * User.create // what `set` writes
 * User.update // what `update` writes
 * ```
 *
 * @since 0.0.0
 */
import { Predicate, Schema, SchemaGetter, type Struct as Struct_ } from "effect";
import { VariantSchema } from "effect/schema";
import * as FieldValue from "./FieldValue.ts";
import * as FirestoreSchema from "./FirestoreSchema.ts";
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
 * @category models
 * @since 0.0.0
 */
export type Variant = "read" | "create" | "update";

const Variants = VariantSchema.make({
  variants: ["read", "create", "update"],
  defaultVariant: "read",
});

/**
 * Declares a field that is a different schema in different variants.
 *
 * @category constructors
 * @since 0.0.0
 */
export const Field = Variants.Field;

/**
 * Declares a field that only appears in the named variants.
 *
 * @category constructors
 * @since 0.0.0
 */
export const FieldOnly = Variants.FieldOnly;

/**
 * Declares a field that appears in every variant but the named ones.
 *
 * @category constructors
 * @since 0.0.0
 */
export const FieldExcept = Variants.FieldExcept;

/**
 * Groups fields without building a class, for nesting inside a document or
 * sharing between several.
 *
 * @category constructors
 * @since 0.0.0
 */
export const Struct = Variants.Struct;

/**
 * Rewrites the schemas of a field, variant by variant.
 *
 * @category transforming
 * @since 0.0.0
 */
export const fieldEvolve = Variants.fieldEvolve;

/**
 * Pulls one variant out of a field group as a plain schema.
 *
 * Note that the `update` variant this hands back is the one the fields declare,
 * which is to say it is neither made partial nor flattened into paths the way
 * {@link Class} makes it.
 *
 * @category converting
 * @since 0.0.0
 */
export const extract = Variants.extract;

/**
 * The field definitions a class or group was built from.
 *
 * @category getters
 * @since 0.0.0
 */
export const fields = <A extends VariantSchema.Struct<any>>(
  self: A,
): A[typeof VariantSchema.TypeId] => VariantSchema.fields(self);

/**
 * Any document schema, whatever it holds.
 *
 * @category models
 * @since 0.0.0
 */
export type Any = Schema.Top & {
  readonly fields: Schema.Struct.Fields;
  readonly create: Schema.Top;
  readonly update: Schema.Top;
};

const OptionalGroupTypeId = "~@visiolab/effect-firebase/firestore/FirestoreModel/OptionalGroup";

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

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (
  u: infer I,
) => void
  ? I
  : never;

/**
 * The fields of an update: every one that may change, each of them optional,
 * and each group a partial of its own.
 *
 * @category models
 * @since 0.0.0
 */
export type UpdateFields<Fields extends VariantSchema.Struct.Fields> = {
  readonly [
    K in keyof Fields as Fields[K] extends VariantSchema.Struct<any>
      ? K
      : [UpdateSchema<Fields[K]>] extends [never]
        ? never
        : K
  ]: Schema.optionalKey<
    Fields[K] extends VariantSchema.Struct<infer G>
      ? Schema.Struct<UpdateFields<G>>
      : UpdateSchema<Fields[K]>
  >;
};

/**
 * The fields an update is written as: one optional key per path it can write
 * at.
 *
 * A group has no key of its own, since it is only ever written field by field,
 * unless it is {@link Optional} - then its key takes the removal and nothing
 * else.
 *
 * @category models
 * @since 0.0.0
 */
export type UpdatePaths<
  Fields extends VariantSchema.Struct.Fields,
  Prefix extends string = "",
> = Struct_.Simplify<
  UnionToIntersection<
    {
      [K in keyof Fields & string]: Fields[K] extends VariantSchema.Struct<infer G>
        ? UpdatePaths<G, `${Prefix}${K}.`>
        : Fields[K] extends { readonly [OptionalGroupTypeId]: VariantSchema.Struct<infer G> }
          ? {
              readonly [_ in `${Prefix}${K}`]: Schema.optionalKey<FirestoreSchema.DeleteField>;
            } & UpdatePaths<G, `${Prefix}${K}.`>
          : [UpdateSchema<Fields[K]>] extends [never]
            ? {}
            : { readonly [_ in `${Prefix}${K}`]: Schema.optionalKey<UpdateSchema<Fields[K]>> };
    }[keyof Fields & string]
  > & {}
>;

/**
 * The `update` variant of a set of fields.
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
 * The patch it takes is {@link Update.to}, and the paths it writes are
 * {@link Update.from}.
 *
 * It is only ever written. A document is never read in this shape, so decoding
 * fails.
 *
 * @category models
 * @since 0.0.0
 */
export interface Update<Fields extends VariantSchema.Struct.Fields> extends Schema.decodeTo<
  Schema.toType<Schema.Struct<UpdateFields<Fields>>>,
  Schema.Struct<UpdatePaths<Fields> extends infer P extends Schema.Struct.Fields ? P : never>
> {}

/** Where the groups sit, which is where flattening goes one level down. */
interface Groups {
  readonly [key: string]: Groups;
}

const updateSchema = (field: unknown): Schema.Top | undefined =>
  VariantSchema.isField(field) ? (field.schemas as any).update : (field as Schema.Top);

/** The fields of the group a field reaches into, if it is one. */
const groupOf = (
  field: unknown,
): { readonly fields: VariantSchema.Struct.Fields; readonly optional: boolean } | undefined => {
  if (VariantSchema.isStruct(field)) {
    return { fields: VariantSchema.fields(field), optional: false };
  }
  if (Predicate.hasProperty(field, OptionalGroupTypeId)) {
    const group = field[OptionalGroupTypeId] as VariantSchema.Struct<any>;
    return { fields: VariantSchema.fields(group), optional: true };
  }
  return undefined;
};

/**
 * Builds the patch a set of fields is updated through, along with where its
 * groups sit, and gathers the schema of each path it can write at into
 * `paths`.
 *
 * Throws on a field name holding a dot, which a path would read as two.
 */
const build = (
  fields: VariantSchema.Struct.Fields,
  prefix: string,
  paths: Record<string, Schema.Top>,
): { readonly patch: Schema.Top; readonly groups: Groups } => {
  const schemas: Record<string, Schema.Top> = {};
  const groups: Record<string, Groups> = {};
  for (const key of Object.keys(fields)) {
    if (key.includes(".")) {
      throw new Error(`Invalid Firestore field name "${key}": it must not contain "."`);
    }
    const field = fields[key];
    const path = prefix + key;
    const group = groupOf(field);
    if (group !== undefined) {
      const inner = build(group.fields, `${path}.`, paths);
      if (group.optional) {
        schemas[key] = Schema.optionalKey(FirestoreSchema.DeleteFieldOr(inner.patch));
        paths[path] = Schema.optionalKey(FirestoreSchema.DeleteField);
      } else {
        schemas[key] = Schema.optionalKey(inner.patch);
      }
      groups[key] = inner.groups;
    } else {
      const schema = updateSchema(field);
      if (schema !== undefined) {
        schemas[key] = Schema.optionalKey(schema);
        paths[path] = Schema.optionalKey(schema);
      }
    }
  }
  return { patch: Schema.Struct(schemas), groups };
};

/**
 * Goes one level down where the schema says a group sits, unless the group is
 * being removed. It runs on the patch as the caller wrote it, before anything
 * is encoded, so the removal is still this library's to recognise.
 */
const flatten = (
  value: Record<string, unknown>,
  groups: Groups,
  prefix: string,
  out: Record<string, unknown>,
): Record<string, unknown> => {
  for (const key of Object.keys(value)) {
    const inner = value[key];
    if (Object.hasOwn(groups, key) && !FieldValue.isDeleteField(inner)) {
      flatten(inner as Record<string, unknown>, groups[key], `${prefix}${key}.`, out);
    } else {
      out[prefix + key] = inner;
    }
  }
  return out;
};

const update = (fields: VariantSchema.Struct.Fields): Schema.Top => {
  const paths: Record<string, Schema.Top> = {};
  const { patch, groups } = build(fields, "", paths);
  return Schema.Struct(paths).pipe(
    Schema.decodeTo(Schema.toType(patch), {
      decode: SchemaGetter.forbidden(() => "An update is only ever written, never read back"),
      encode: SchemaGetter.transform((value) =>
        flatten(value as Record<string, unknown>, groups, "", {}),
      ),
    }),
  );
};

/**
 * A document schema, together with the shapes it is written in.
 *
 * @category models
 * @since 0.0.0
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
  /** What `update` writes. */
  readonly update: Update<Fields>;
}

type MissingSelfGeneric =
  `Missing \`Self\` generic - use \`class Self extends Class<Self>("Self")({ ... })\``;

/**
 * Defines a document schema.
 *
 * The class is the `read` variant, so it is what a snapshot decodes into and
 * what every other schema combinator takes. {@link Class.create} and
 * {@link Class.update} hang off it.
 *
 * @category constructors
 * @since 0.0.0
 */
export const Class =
  <Self = never>(identifier: string) =>
  <const Fields extends VariantSchema.Struct.Fields>(
    fields: Fields & VariantSchema.Struct.Validate<Fields, Variant>,
    annotations?: Schema.Annotations.Declaration<
      Self,
      readonly [Schema.Struct<VariantSchema.ExtractFields<"read", Fields, true>>]
    >,
  ): [Self] extends [never] ? MissingSelfGeneric : Class<Self, Fields> => {
    const Base = Variants.Class<Self>(identifier)(fields, annotations) as any;
    // `Variants.Class` defines each variant as a non-configurable property, so
    // the patch `update` is shadowed from a subclass rather than written over
    // it. A class built this way is extended by the caller anyway, which is
    // what `Self` is for, so this is one more link in a chain that already has
    // one.
    class Model extends Base {}
    Object.defineProperty(Model, "update", {
      value: update(fields).annotate({
        id: `${identifier}.update`,
        title: `${identifier}.update`,
      }),
    });
    return Model as any;
  };

/**
 * A union of document schemas, in every variant.
 *
 * @category constructors
 * @since 0.0.0
 */
export const Union = Variants.Union;

/**
 * Type-level representation of {@link Immutable}.
 *
 * @category models
 * @since 0.0.0
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
 * @category schemas
 * @since 0.0.0
 */
export const Immutable = <S extends Schema.Top>(schema: S): Immutable<S> =>
  Field({ read: schema, create: schema });

/**
 * Type-level representation of {@link Timestamp}.
 *
 * @category models
 * @since 0.0.0
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
 * createdAt: FirestoreModel.Timestamp(FirestoreSchema.Timestamp)
 * seenAt: FirestoreModel.Timestamp(FirestoreSchema.DateTimeUtcFromTimestamp)
 * ```
 *
 * Where the server is to decide, a call site hands it
 * {@link FieldValue.serverTimestamp}. Where it never may, name the schema
 * directly, which goes into every variant as it stands.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Timestamp = <
  S extends Schema.Codec<unknown, Timestamp_.TimestampLike, unknown, unknown>,
>(
  schema: S,
): Timestamp<S> =>
  Field({
    read: schema,
    create: FirestoreSchema.ServerTimestampOr(schema),
    update: FirestoreSchema.ServerTimestampOr(schema),
  });

/**
 * Type-level representation of {@link Number}.
 *
 * @category models
 * @since 0.0.0
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
 * visits: FirestoreModel.Number(Schema.Int)
 * balance: FirestoreModel.Number(Schema.Finite)
 * ```
 *
 * Where the server is to move it, a call site hands it
 * {@link FieldValue.increment} or {@link FieldValue.decrement}. Where it never
 * may, name the schema directly, which goes into every variant as it stands.
 *
 * @category schemas
 * @since 0.0.0
 */
export const Number = <S extends Schema.Codec<unknown, number, unknown, unknown>>(
  schema: S,
): Number<S> =>
  Field({
    read: schema,
    create: FirestoreSchema.IncrementOr(schema),
    update: FirestoreSchema.IncrementOr(schema),
  });

/**
 * Type-level representation of {@link Optional}, made of a group.
 *
 * It carries the group it was made of, which is what an update reaches into.
 *
 * @category models
 * @since 0.0.0
 */
export interface OptionalGroup<G extends VariantSchema.Struct<any>> extends VariantSchema.Field<{
  readonly read: Schema.optionalKey<VariantSchema.Extract<"read", G>>;
  readonly create: Schema.optionalKey<VariantSchema.Extract<"create", G>>;
  readonly update: Schema.optionalKey<
    FirestoreSchema.DeleteFieldOr<Schema.Struct<UpdateFields<G[typeof VariantSchema.TypeId]>>>
  >;
}> {
  readonly [OptionalGroupTypeId]: G;
}

/**
 * Type-level representation of {@link Optional}.
 *
 * @category models
 * @since 0.0.0
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

const optionalField = fieldEvolve({
  read: Schema.optionalKey,
  create: Schema.optionalKey,
  update: (schema: Schema.Top) => Schema.optionalKey(FirestoreSchema.DeleteFieldOr(schema)),
} as any) as (self: unknown) => unknown;

const optionalGroup = (self: VariantSchema.Struct<any>): unknown =>
  Object.assign(
    Field({
      read: Schema.optionalKey(extract(self, "read") as Schema.Top),
      create: Schema.optionalKey(extract(self, "create") as Schema.Top),
      update: Schema.optionalKey(
        FirestoreSchema.DeleteFieldOr(build(VariantSchema.fields(self), "", {}).patch),
      ),
    }),
    { [OptionalGroupTypeId]: self },
  );

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
 * nickname: FirestoreModel.Optional(Schema.String)
 * lastSeenAt: FirestoreModel.Optional(FirestoreModel.Timestamp(FirestoreSchema.Timestamp))
 * address: FirestoreModel.Optional(Address)
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
 * @category schemas
 * @since 0.0.0
 */
export const Optional = <
  F extends VariantSchema.Field<any> | VariantSchema.Struct<any> | Schema.Top,
>(
  self: F,
): Optional<F> => (VariantSchema.isStruct(self) ? optionalGroup(self) : optionalField(self)) as any;
