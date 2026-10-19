import {
  Effect,
  Predicate,
  Schema,
  SchemaAST,
  SchemaGetter,
  SchemaIssue,
  SchemaParser,
} from "effect";
import { VariantSchema } from "effect/schema";
import type * as FirestoreModel from "../FirestoreModel.ts";
import type * as Timestamp_ from "../Timestamp.ts";
import * as fieldValue from "./fieldValue.ts";
import * as firestoreSchema from "./firestoreSchema.ts";
import * as patch from "./patch.ts";

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

const variantSchema = (field: unknown, variant: "create" | "update"): Schema.Top | undefined =>
  VariantSchema.isField(field) ? (field.schemas as any)[variant] : (field as Schema.Top);

const updateSchema = (field: unknown): Schema.Top | undefined => variantSchema(field, "update");

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

/** A group a field reaches into, and whether a document may go without it. */
interface Group {
  readonly struct: VariantSchema.Struct<any>;
  readonly optional: boolean;
}

/** The group a field reaches into, if it is one. */
const groupOf = (field: unknown): Group | undefined => {
  if (VariantSchema.isStruct(field)) {
    return { struct: field, optional: false };
  }
  if (Predicate.hasProperty(field, OptionalGroupTypeId)) {
    return { struct: field[OptionalGroupTypeId] as VariantSchema.Struct<any>, optional: true };
  }
  return undefined;
};

/**
 * Whether a group may be written whole by an update: only where every field it
 * holds, at any depth, is written both by `set`, whose shape a replacement
 * takes, and by an update. Replacing one holding a field written once would
 * change it, and one holding a field `set` leaves out would drop it.
 */
const isReplaceable = (fields: VariantSchema.Struct.Fields): boolean =>
  Object.values(fields).every((field) => {
    const group = groupOf(field);
    return group === undefined
      ? variantSchema(field, "create") !== undefined && updateSchema(field) !== undefined
      : isReplaceable(VariantSchema.fields(group.struct));
  });

/**
 * The replacement of a group, holding the group as `create` makes it - with
 * its constructor defaults filled in, since a default left out of a group
 * written whole would be a field dropped.
 */
const ReplaceSchema = (create: Schema.Top): Schema.Top =>
  Schema.declareConstructor<any, any>()(
    [create],
    ([create]) =>
      (input, ast, options) =>
        patch.isReplace(input)
          ? create.makeEffect(input.value, options).pipe(
              Effect.mapBothEager({
                onSuccess: patch.replace,
                onFailure: (issue) => new SchemaIssue.Pointer(["value"], issue),
              }),
            )
          : Effect.fail(new SchemaIssue.InvalidType(ast, input, options)),
    { expected: "a group written whole" },
  );

/**
 * The patch of a group, refusing the markers a struct would otherwise take
 * for a patch of nothing, since it keeps only the keys it knows.
 */
const GroupPatchSchema = (fields: Schema.Top): Schema.Top =>
  Schema.declareConstructor<any, any>()(
    [fields],
    ([fields]) =>
      (input, ast, options) =>
        patch.isReplace(input) || fieldValue.isDeleteField(input)
          ? Effect.fail(new SchemaIssue.InvalidType(ast, input, options))
          : SchemaParser.decodeUnknownEffect(fields)(input, options),
    { expected: "a patch of a group" },
  );

/**
 * Builds the patch a set of fields is updated through in `mode`, along with
 * where its groups sit, and gathers the schema of each path it can write at
 * into `paths`.
 *
 * A group takes a patch, written at its paths, unless it may be missing and
 * the patch is checked, since the patch would create it holding only what it
 * carried. It takes a replacement wherever it is replaceable, and a removal
 * where it may be missing.
 *
 * Throws on a field name holding a dot, which a path would read as two.
 */
const build = (
  fields: VariantSchema.Struct.Fields,
  prefix: string,
  paths: Record<string, Schema.Top>,
  mode: FirestoreModel.UpdateMode,
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
      const built = buildGroup(group, path, paths, mode);
      schemas[key] = built.schema;
      groups[key] = built.groups;
    } else {
      const update = updateSchema(field);
      if (update !== undefined) {
        const schema = withoutConstructorDefault(update);
        schemas[key] = Schema.optionalKey(schema);
        paths[path] = Schema.optionalKey(schema);
      }
    }
  }
  return { patch: Schema.Struct(schemas), groups };
};

/**
 * Builds what a group at `path` takes in `mode`, gathering the paths it writes
 * at into `paths`, the way {@link build} does for a set of fields.
 */
const buildGroup = (
  { struct, optional }: Group,
  path: string,
  paths: Record<string, Schema.Top>,
  mode: FirestoreModel.UpdateMode,
): { readonly schema: Schema.Top; readonly groups: Groups } => {
  const fields = VariantSchema.fields(struct);
  const inner = build(fields, `${path}.`, paths, mode);
  const create = isReplaceable(fields) ? (extract(struct, "create") as Schema.Top) : undefined;
  const takes: Array<Schema.Top> = [];
  if (!optional || mode === "unchecked") {
    takes.push(GroupPatchSchema(inner.patch));
  }
  if (create !== undefined) {
    takes.push(ReplaceSchema(create));
  }
  if (optional) {
    takes.push(firestoreSchema.DeleteField);
  }
  const written = optional
    ? create === undefined
      ? firestoreSchema.DeleteField
      : firestoreSchema.DeleteFieldOr(create)
    : create;
  if (written !== undefined) {
    paths[path] = Schema.optionalKey(written);
  }
  return {
    schema: Schema.optionalKey(takes.length === 1 ? takes[0] : Schema.Union(takes)),
    groups: inner.groups,
  };
};

/**
 * Goes one level down where the schema says a group sits, unless the group is
 * being removed or replaced. It runs on the patch as the caller wrote it,
 * before anything is encoded, so the removal and the replacement are still
 * this library's to recognise.
 *
 * A replacement is written whole, as the group it holds.
 */
const flatten = (
  value: Record<string, unknown>,
  groups: Groups,
  prefix: string,
  out: Record<string, unknown>,
): Record<string, unknown> => {
  for (const key of Object.keys(value)) {
    const inner = value[key];
    if (!Object.hasOwn(groups, key) || fieldValue.isDeleteField(inner)) {
      out[prefix + key] = inner;
    } else if (patch.isReplace(inner)) {
      out[prefix + key] = inner.value;
    } else {
      flatten(inner as Record<string, unknown>, groups[key], `${prefix}${key}.`, out);
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
      // What the group takes as a field of its own, which is what `extract`
      // hands back: the patches an unchecked update takes.
      update: buildGroup({ struct: self, optional: true }, "", {}, "unchecked").schema,
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
