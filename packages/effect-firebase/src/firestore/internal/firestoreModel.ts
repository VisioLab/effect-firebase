import { Predicate, Schema, SchemaGetter } from "effect";
import { VariantSchema } from "effect/schema";
import type * as FirestoreModel from "../FirestoreModel.ts";
import type * as Timestamp_ from "../Timestamp.ts";
import * as fieldValue from "./fieldValue.ts";
import * as firestoreSchema from "./firestoreSchema.ts";

const Variants = VariantSchema.make({
  variants: ["read", "create", "update"],
  defaultVariant: "read",
});

/** @internal */
export const Field = Variants.Field;

/** @internal */
export const FieldOnly = Variants.FieldOnly;

/** @internal */
export const FieldExcept = Variants.FieldExcept;

/** @internal */
export const Struct = Variants.Struct;

/** @internal */
export const fieldEvolve = Variants.fieldEvolve;

/** @internal */
export const extract = Variants.extract;

/** @internal */
export const Union = Variants.Union;

/** @internal */
export const fields = <A extends VariantSchema.Struct<any>>(
  self: A,
): A[typeof VariantSchema.TypeId] => VariantSchema.fields(self);

/** @internal */
export const OptionalGroupTypeId =
  "~@visiolab/effect-firebase/firestore/FirestoreModel/OptionalGroup";

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
        schemas[key] = Schema.optionalKey(firestoreSchema.DeleteFieldOr(inner.patch));
        paths[path] = Schema.optionalKey(firestoreSchema.DeleteField);
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
    if (Object.hasOwn(groups, key) && !fieldValue.isDeleteField(inner)) {
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

/** @internal */
export const Class =
  (identifier: string) =>
  (
    fields: VariantSchema.Struct.Fields,
    annotations?: Schema.Annotations.Declaration<any, any>,
  ): any => {
    const Base = Variants.Class<any>(identifier)(fields as any, annotations) as any;
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
    return Model;
  };

/** @internal */
export const Immutable = <S extends Schema.Top>(schema: S): FirestoreModel.Immutable<S> =>
  Field({ read: schema, create: schema });

/** @internal */
export const Timestamp = <
  S extends Schema.Codec<unknown, Timestamp_.TimestampLike, unknown, unknown>,
>(
  schema: S,
): FirestoreModel.Timestamp<S> =>
  Field({
    read: schema,
    create: firestoreSchema.ServerTimestampOr(schema),
    update: firestoreSchema.ServerTimestampOr(schema),
  });

/** @internal */
export const Number = <S extends Schema.Codec<unknown, number, unknown, unknown>>(
  schema: S,
): FirestoreModel.Number<S> =>
  Field({
    read: schema,
    create: firestoreSchema.IncrementOr(schema),
    update: firestoreSchema.IncrementOr(schema),
  });

const optionalField = fieldEvolve({
  read: Schema.optionalKey,
  create: Schema.optionalKey,
  update: (schema: Schema.Top) => Schema.optionalKey(firestoreSchema.DeleteFieldOr(schema)),
} as any) as (self: unknown) => unknown;

const optionalGroup = (self: VariantSchema.Struct<any>): unknown =>
  Object.assign(
    Field({
      read: Schema.optionalKey(extract(self, "read") as Schema.Top),
      create: Schema.optionalKey(extract(self, "create") as Schema.Top),
      update: Schema.optionalKey(
        firestoreSchema.DeleteFieldOr(build(VariantSchema.fields(self), "", {}).patch),
      ),
    }),
    { [OptionalGroupTypeId]: self },
  );

/** @internal */
export const Optional = <
  F extends VariantSchema.Field<any> | VariantSchema.Struct<any> | Schema.Top,
>(
  self: F,
): FirestoreModel.Optional<F> =>
  (VariantSchema.isStruct(self) ? optionalGroup(self) : optionalField(self)) as any;
