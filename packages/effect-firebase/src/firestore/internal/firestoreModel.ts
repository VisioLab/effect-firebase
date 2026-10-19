import { Predicate, Schema, SchemaAST, SchemaGetter } from "effect";
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

/** Whether a document cannot be read without the field. */
const isRequired = (field: unknown): boolean => {
  const read: Schema.Top | undefined = VariantSchema.isField(field)
    ? (field.schemas as any).read
    : (field as Schema.Top);
  return read !== undefined && read.ast.context?.isOptional !== true;
};

/**
 * How a set of fields is patched.
 *
 * - `checked` and `unchecked` are the modes an update is built in, and only
 *   tell apart where a group may be missing.
 * - `complete` is what a group that may be missing is patched in under
 *   `checked`, since the patch may be what creates it: every field it cannot
 *   be read without has to be there, at any depth.
 */
type Mode = FirestoreModel.UpdateMode | "complete";

// What Effect itself strips a default with, though it is left out of the
// typings.
const replaceContext = (SchemaAST as any).replaceContext as <A extends SchemaAST.AST>(
  ast: A,
  context: SchemaAST.Context,
) => A;

/**
 * Drops the default a field is constructed with. A patch leaves a key out to
 * keep what the document holds, so filling one in would overwrite it.
 */
const withoutConstructorDefault = (schema: Schema.Top): Schema.Top => {
  const context = schema.ast.context;
  if (context?.constructorDefault === undefined) {
    return schema;
  }
  return Schema.make(
    replaceContext(
      schema.ast,
      new SchemaAST.Context(context.isOptional, context.isMutable, undefined, context.annotations),
    ),
  );
};

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
 * Builds the patch a set of fields is updated through in `mode`, along with
 * where its groups sit, and gathers the schema of each path it can write at
 * into `paths`.
 *
 * Throws on a field name holding a dot, which a path would read as two.
 */
const build = (
  fields: VariantSchema.Struct.Fields,
  prefix: string,
  paths: Record<string, Schema.Top>,
  mode: Mode,
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
      // A group a document may go without may be created by the patch.
      const innerMode = group.optional && mode !== "unchecked" ? "complete" : mode;
      const inner = build(group.fields, `${path}.`, paths, innerMode);
      if (group.optional) {
        schemas[key] = Schema.optionalKey(firestoreSchema.DeleteFieldOr(inner.patch));
        paths[path] = Schema.optionalKey(firestoreSchema.DeleteField);
      } else {
        schemas[key] = mode === "complete" ? inner.patch : Schema.optionalKey(inner.patch);
      }
      groups[key] = inner.groups;
    } else {
      const update = updateSchema(field);
      const schema = update === undefined ? undefined : withoutConstructorDefault(update);
      if (schema !== undefined) {
        paths[path] = Schema.optionalKey(schema);
      }
      if (mode === "complete" && isRequired(field)) {
        // A field no update writes leaves the group unable to be created by
        // one, so the patch cannot be made at all and the group only removed.
        schemas[key] = schema ?? Schema.Never;
      } else if (schema !== undefined) {
        schemas[key] = Schema.optionalKey(schema);
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

const update = (
  fields: VariantSchema.Struct.Fields,
  mode: FirestoreModel.UpdateMode,
): Schema.Top => {
  const paths: Record<string, Schema.Top> = {};
  const { patch, groups } = build(fields, "", paths, mode);
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
      value: update(fields, "checked").annotate({
        id: `${identifier}.update`,
        title: `${identifier}.update`,
      }),
    });
    Object.defineProperty(Model, "updateUnchecked", {
      value: update(fields, "unchecked").annotate({
        id: `${identifier}.updateUnchecked`,
        title: `${identifier}.updateUnchecked`,
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

/** @internal */
export const Array = <S extends Schema.Top>(item: S): FirestoreModel.Array<S> =>
  Field({
    read: Schema.Array(item),
    create: Schema.Array(item),
    update: firestoreSchema.ArrayOr(item),
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
        firestoreSchema.DeleteFieldOr(build(VariantSchema.fields(self), "", {}, "unchecked").patch),
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
