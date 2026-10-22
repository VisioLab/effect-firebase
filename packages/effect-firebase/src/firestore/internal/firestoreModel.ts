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
import type * as FirestoreSchema from "../FirestoreSchema.ts";
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
export const RecordTypeId = "~@visiolab/effect-firebase/firestore/FirestoreModel/Record";

/**
 * Where an update goes one level down when flattening: at the keys of a struct,
 * or at every key of a Record, whatever it is. A key missing from both is a
 * value, written whole.
 */
interface Shape {
  readonly fields: { readonly [key: string]: Shape };
  readonly rest: { readonly value: Shape | undefined } | undefined;
}

/** The keys of a Record that only the data names, and what each of them holds. */
interface Rest<A> {
  readonly key: Schema.Top;
  readonly value: A;
}

/**
 * A path an update writes at, one segment per key: the name of a field, or the
 * schema of the key of a Record, which encodes whatever key sits there.
 */
type Path = ReadonlyArray<string | Schema.Top>;

/**
 * The schemas an update writes at: by path where it only goes through fields,
 * and by the pattern of the paths where it goes through a Record.
 */
interface Paths {
  readonly known: Record<string, Schema.Top>;
  readonly patterns: Map<string, Schema.Top>;
}

/** The reason a key is not one a path can name on its own, if it is not. */
const unaddressable = (key: string): string | undefined =>
  key === "" ? "must not be empty" : key.includes(".") ? 'must not contain "."' : undefined;

/** A key a path names on its own, which is a non-empty one holding no dot. */
const Segment = Schema.String.check(Schema.isPattern(/^[^.]+$/));

/** Where a path sits, with `*` for each key only the data names. */
const where = (path: Path): string =>
  path.map((segment) => (Schema.isSchema(segment) ? "*" : segment)).join(".");

/**
 * The parts of the template literal a path matches: the names of the fields
 * along it, joined by dots, and `key` for each key of a Record.
 */
const template = <A>(path: Path, key: (schema: Schema.Top, i: number) => A): Array<string | A> => {
  const parts: Array<string | A> = [];
  let literal = "";
  path.forEach((segment, i) => {
    if (i > 0) {
      literal += ".";
    }
    if (Schema.isSchema(segment)) {
      if (literal !== "") {
        parts.push(literal);
      }
      parts.push(key(segment, i));
      literal = "";
    } else {
      literal += segment;
    }
  });
  if (literal !== "") {
    parts.push(literal);
  }
  return parts;
};

/**
 * The key of a pattern of paths, as an update is written with it and as
 * Firestore holds it: each key of a Record is encoded by the Record's key
 * schema, and refused where its encoded form is one no path can name.
 */
const PathKey = (path: Path): Schema.Top => {
  const encoded = template(path, (key, i) =>
    Schema.String.check(
      Schema.makeFilter((segment: string) => {
        const reason = unaddressable(segment);
        return reason === undefined
          ? undefined
          : `Invalid Firestore field name "${segment}" in "${where(path.slice(0, i))}": it ${reason}`;
      }),
    ).pipe(Schema.decodeTo(key as Schema.Codec<unknown, string>)),
  );
  const decoded = template(path, (key) => (recordKeys(key).rest ? Segment : Schema.toType(key)));
  const parser = Schema.TemplateLiteralParser(encoded as any) as unknown as Schema.Codec<
    ReadonlyArray<unknown>,
    string
  >;
  return parser.pipe(
    Schema.decodeTo(Schema.TemplateLiteral(decoded as any) as Schema.Codec<string, string>, {
      decode: SchemaGetter.transform((parts) => parts.join("")),
      // A key a path names holds no dot, so splitting the path at each one
      // gives back its keys.
      encode: SchemaGetter.transform((key) => {
        const segments = key.split(".");
        return template(path, (_, i) => segments[i]);
      }),
    }),
  );
};

// Every key of a Record known up front sits at the same pattern, which is only
// added once. A pattern holds no optional key, since any path it matches may be
// left out anyway.
const addPath = (paths: Paths, path: Path, schema: Schema.Top): void => {
  if (path.every((segment) => typeof segment === "string")) {
    paths.known[path.join(".")] = Schema.optionalKey(schema);
  } else if (!paths.patterns.has(where(path))) {
    paths.patterns.set(
      where(path),
      Schema.Record(PathKey(path) as Schema.Record.Key, withoutOptionalKey(schema)),
    );
  }
};

const variantSchema = (
  field: unknown,
  variant: "read" | "create" | "update",
): Schema.Top | undefined =>
  VariantSchema.isStruct(field)
    ? (extract(field, variant) as Schema.Top)
    : VariantSchema.isField(field)
      ? (field.schemas as any)[variant]
      : (field as Schema.Top);

const updateSchema = (field: unknown): Schema.Top | undefined =>
  VariantSchema.isStruct(field) ? undefined : variantSchema(field, "update");

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

/**
 * Drops the optional key a schema is made, for a value at a key only the data
 * names, which may be missing whatever it holds.
 */
const withoutOptionalKey = (schema: Schema.Top): Schema.Top => {
  const context = schema.ast.context;
  if (context?.isOptional !== true) {
    return schema;
  }
  return Schema.make(
    replaceContext(
      schema.ast,
      new SchemaAST.Context(
        false,
        context.isMutable,
        context.constructorDefault,
        context.annotations,
      ),
    ),
  );
};

/** The keys a Record key schema names up front, and whether the data names more. */
const recordKeys = (key: Schema.Top): { readonly known: Array<string>; readonly rest: boolean } => {
  const ast = Schema.Record(key as Schema.Record.Key, Schema.Unknown).ast;
  const known = ast.propertySignatures.map(({ name }) => {
    if (typeof name === "symbol") {
      throw new Error(`Invalid Firestore field name ${String(name)}: it must be a string`);
    }
    const segment = String(name);
    const reason = unaddressable(segment);
    if (reason !== undefined) {
      throw new Error(`Invalid Firestore field name "${segment}": it ${reason}`);
    }
    return segment;
  });
  const rest = ast.indexSignatures.length > 0;
  if (rest && known.length > 0) {
    throw new Error(
      `Invalid Record key: it names ${known.map((k) => `"${k}"`).join(", ")} besides keys only the data names, which an update cannot tell apart`,
    );
  }
  return { known, rest };
};

/**
 * What an update reaches into: a struct, or a Record. Either holds fields at
 * keys known up front, and a Record may hold more at keys only the data names.
 */
interface Node {
  readonly fields: VariantSchema.Struct.Fields;
  /**
   * The key schema of a Record keyed by literals, which a path names each of
   * its fields by, to encode it as part of the update.
   */
  readonly key: Schema.Top | undefined;
  readonly rest: Rest<unknown> | undefined;
  /** The whole node, as `set` writes it. */
  readonly create: () => Schema.Top;
  /** Whether a document may go without it. */
  readonly optional: boolean;
  /** Whether an update writes anything at all into it. */
  readonly writable: boolean;
}

const recordNode = (
  key: Schema.Top,
  value: unknown,
  create: () => Schema.Top,
  optional: boolean,
): Node => {
  const keys = recordKeys(key);
  return {
    fields: Object.fromEntries(keys.known.map((k) => [k, value])) as VariantSchema.Struct.Fields,
    key: keys.rest ? undefined : key,
    rest: keys.rest ? { key, value } : undefined,
    create,
    optional,
    // A value no update writes leaves nothing of the Record to write either.
    writable: nodeOf(value)?.writable ?? updateSchema(value) !== undefined,
  };
};

/** Whether a field was made {@link FirestoreModel.Optional}. */
const isOptional = (field: unknown): field is { readonly field: unknown } =>
  Predicate.hasProperty(field, "~optionality") && field["~optionality"] === "optional";

/** What a field reaches into, if it is a struct or a Record. */
const nodeOf = (field: unknown, optional = false): Node | undefined => {
  if (isOptional(field)) {
    return nodeOf(field.field, true);
  }
  if (Predicate.hasProperty(field, RecordTypeId)) {
    const { key, value } = field[RecordTypeId] as Rest<unknown>;
    return recordNode(key, value, () => variantSchema(field, "create")!, optional);
  }
  if (VariantSchema.isStruct(field)) {
    return {
      fields: VariantSchema.fields(field),
      key: undefined,
      rest: undefined,
      create: () => extract(field, "create") as Schema.Top,
      optional,
      writable: true,
    };
  }
  return undefined;
};

/**
 * Whether a set of fields may be written whole by an update: only where every
 * field it holds, at any depth, is written both by `set`, whose shape a
 * replacement takes, and by an update. Replacing one holding a field written
 * once would change it, and one holding a field `set` leaves out would drop it.
 */
const isReplaceable = (fields: VariantSchema.Struct.Fields): boolean =>
  Object.values(fields).every((field) => {
    const node = nodeOf(field);
    return node === undefined
      ? variantSchema(field, "create") !== undefined && updateSchema(field) !== undefined
      : isNodeReplaceable(node);
  });

const isNodeReplaceable = (node: Node): boolean =>
  isReplaceable(node.fields) &&
  (node.rest === undefined || isReplaceable({ _: node.rest.value } as VariantSchema.Struct.Fields));

/**
 * The replacement of a struct, holding the struct as `create` makes it - with
 * its constructor defaults filled in, since a default left out of a struct
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
    { expected: "a struct written whole" },
  );

/**
 * The patch of a struct, refusing the markers a `Schema.Struct` would
 * otherwise take for a patch of nothing, since it keeps only the keys it knows.
 */
const StructPatchSchema = (fields: Schema.Top): Schema.Top =>
  Schema.declareConstructor<any, any>()(
    [fields],
    ([fields]) =>
      (input, ast, options) =>
        patch.isReplace(input) || fieldValue.isDeleteField(input)
          ? Effect.fail(new SchemaIssue.InvalidType(ast, input, options))
          : SchemaParser.decodeUnknownEffect(fields)(input, options),
    { expected: "a patch of a struct" },
  );

/**
 * Builds the patch a set of fields is updated through in `mode`, along with
 * where its structs and Records sit, and gathers the schema of each path it can
 * write at into `paths`.
 *
 * A struct takes a patch, written at its paths, unless it may be missing and
 * the patch is checked, since the patch would create it holding only what it
 * carried. It takes a replacement wherever it is replaceable, and a removal
 * where it may be missing. A Record is a struct whose keys may come from the
 * data - see {@link buildNode}.
 *
 * Where `recordKey` is given, the fields are the keys of a Record keyed by
 * literals, and each sits on its path as that key schema encodes it.
 *
 * Throws on a field name holding a dot, which a path would read as two.
 */
const build = (
  fields: VariantSchema.Struct.Fields,
  path: Path,
  paths: Paths,
  mode: FirestoreModel.UpdateMode,
  recordKey?: Schema.Top,
): { readonly patch: Schema.Top; readonly shape: Shape } => {
  const schemas: Record<string, Schema.Top> = {};
  const shapes: Record<string, Shape> = {};
  for (const key of Object.keys(fields)) {
    if (key.includes(".")) {
      throw new Error(`Invalid Firestore field name "${key}": it must not contain "."`);
    }
    const field = fields[key];
    const at = [...path, recordKey ?? key];
    const node = nodeOf(field);
    if (node !== undefined) {
      if (node.writable) {
        const built = buildNode(node, at, paths, mode);
        schemas[key] = Schema.optionalKey(built.schema);
        shapes[key] = built.shape;
      }
    } else {
      const update = updateSchema(field);
      if (update !== undefined) {
        const schema = withoutConstructorDefault(update);
        schemas[key] = Schema.optionalKey(schema);
        addPath(paths, at, schema);
      }
    }
  }
  return { patch: Schema.Struct(schemas), shape: { fields: shapes, rest: undefined } };
};

/**
 * Builds what a struct or a Record at `path` takes in `mode`, gathering the
 * paths it writes at into `paths`, the way {@link build} does for a set of
 * fields.
 *
 * A Record whose keys come from the data is patched key by key, each key
 * written at its own path. Any such key may be missing, so each takes the
 * removal, and a value that is itself a struct or a Record is treated as one a
 * document may go without. That also makes a patch safe where the Record
 * itself may be missing: every key it writes is one the Record may hold or not.
 */
const buildNode = (
  node: Node,
  path: Path,
  paths: Paths,
  mode: FirestoreModel.UpdateMode,
): { readonly schema: Schema.Top; readonly shape: Shape } => {
  const inner =
    node.rest === undefined
      ? build(node.fields, path, paths, mode, node.key)
      : buildRest(node.rest, path, paths, mode);
  const create = isNodeReplaceable(node) ? node.create() : undefined;
  const takes: Array<Schema.Top> = [];
  if (!node.optional || mode === "unchecked" || node.rest !== undefined) {
    takes.push(StructPatchSchema(inner.patch));
  }
  if (create !== undefined) {
    takes.push(ReplaceSchema(create));
  }
  if (node.optional) {
    takes.push(firestoreSchema.DeleteField);
  }
  const written = node.optional
    ? create === undefined
      ? firestoreSchema.DeleteField
      : firestoreSchema.DeleteFieldOr(create)
    : create;
  if (written !== undefined) {
    addPath(paths, path, written);
  }
  return {
    schema: takes.length === 1 ? takes[0] : Schema.Union(takes),
    shape: inner.shape,
  };
};

/** Builds the patch of a Record at the keys only the data names. */
const buildRest = (
  rest: Rest<unknown>,
  path: Path,
  paths: Paths,
  mode: FirestoreModel.UpdateMode,
): { readonly patch: Schema.Top; readonly shape: Shape } => {
  const entryPath = [...path, rest.key];
  const node = nodeOf(rest.value, true);
  let entry: Schema.Top;
  let shape: Shape | undefined;
  if (node !== undefined) {
    const built = buildNode({ ...node, optional: true }, entryPath, paths, mode);
    entry = built.schema;
    shape = built.shape;
  } else {
    entry = firestoreSchema.DeleteFieldOr(
      withoutConstructorDefault(withoutOptionalKey(updateSchema(rest.value)!)),
    );
    addPath(paths, entryPath, entry);
  }
  return {
    patch: Schema.Record(Schema.toType(rest.key) as Schema.Record.Key, entry),
    shape: { fields: {}, rest: { value: shape } },
  };
};

/**
 * Goes one level down where the shape says a struct or a Record sits, unless it
 * is being removed or replaced. It runs on the patch as the caller wrote it,
 * before anything is encoded, so the removal and the replacement are still
 * this library's to recognise.
 *
 * A replacement is written whole, as the struct it holds. A key of a Record
 * fails where no path could name it; the paths it builds are encoded by the
 * schema of each, keys and all.
 */
const flatten = (
  value: Record<string, unknown>,
  shape: Shape,
  prefix: string,
  out: Record<string, unknown>,
  options: SchemaAST.ParseOptions,
): Effect.Effect<Record<string, unknown>, SchemaIssue.Issue> =>
  Effect.gen(function* () {
    for (const key of Object.keys(value)) {
      const inner = value[key];
      let child: Shape | undefined;
      if (shape.rest !== undefined) {
        const reason = unaddressable(key);
        if (reason !== undefined) {
          return yield* Effect.fail(
            new SchemaIssue.InvalidValue(
              {
                message: `Invalid Firestore field name "${key}" in "${prefix.slice(0, -1)}": it ${reason}`,
              },
              key,
              options,
            ),
          );
        }
        child = shape.rest.value;
      } else if (Object.hasOwn(shape.fields, key)) {
        child = shape.fields[key];
      }
      if (child === undefined || fieldValue.isDeleteField(inner)) {
        out[prefix + key] = inner;
      } else if (patch.isReplace(inner)) {
        out[prefix + key] = inner.value;
      } else {
        yield* flatten(inner as Record<string, unknown>, child, `${prefix}${key}.`, out, options);
      }
    }
    return out;
  });

const update = (
  fields: VariantSchema.Struct.Fields,
  mode: FirestoreModel.UpdateMode,
): Schema.Top => {
  const paths: Paths = { known: {}, patterns: new Map() };
  const { patch, shape } = build(fields, [], paths, mode);
  const known = Schema.Struct(paths.known);
  const patterns = [...paths.patterns.values()];
  return (patterns.length === 0 ? known : Schema.StructWithRest(known, patterns as any)).pipe(
    Schema.decodeTo(Schema.toType(patch), {
      decode: SchemaGetter.forbidden(() => "An update is only ever written, never read back"),
      encode: SchemaGetter.transformEffect((value, options) =>
        flatten(value as Record<string, unknown>, shape, "", {}, options),
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
export const Timestamp = <S extends FirestoreSchema.TimeSchema>(
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

/**
 * What a struct or a Record takes as a field of its own, which is what
 * `extract` hands back: the patches an unchecked update takes.
 */
const nodeUpdate = (node: Node): Schema.Top =>
  Schema.optionalKey(buildNode(node, [], { known: {}, patterns: new Map() }, "unchecked").schema);

/** @internal */
export const Record = <K extends Schema.Record.Key, V extends FirestoreModel.Value>(
  key: K,
  value: V,
): FirestoreModel.Record<K, V> => {
  const { rest } = recordKeys(key);
  const of = (variant: "read" | "create"): Schema.Top | undefined => {
    const schema = variantSchema(value, variant);
    // A key only the data names may be missing anyway, and Effect takes no
    // optional key at one.
    return schema && Schema.Record(key, rest ? withoutOptionalKey(schema) : schema);
  };
  const read = of("read");
  const create = of("create");
  const node = recordNode(key, value, () => create!, false);
  return Object.assign(
    Field({
      ...(read && { read }),
      ...(create && { create }),
      ...(node.writable && { update: nodeUpdate(node) }),
    }),
    { [RecordTypeId]: { key, value } },
  ) as any;
};

const optionalNode = (self: unknown, node: Node): unknown =>
  Field({
    read: Schema.optionalKey(variantSchema(self, "read")!),
    create: Schema.optionalKey(node.create()),
    ...(node.writable && { update: nodeUpdate(node) }),
  });

/** @internal */
export const Optional = (self: FirestoreModel.Value): any => {
  // Made optional already, which a second time leaves as it is.
  if (isOptional(self)) {
    return self;
  }
  const node = nodeOf(self, true);
  return Object.assign(
    (node === undefined ? optionalField(self) : optionalNode(self, node)) as object,
    {
      "~optionality": "optional",
      field: self,
    },
  );
};
