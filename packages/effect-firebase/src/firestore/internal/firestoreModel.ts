import {
  Effect,
  Predicate,
  Schema,
  SchemaAST,
  SchemaGetter,
  SchemaIssue,
  Result,
  SchemaParser,
} from "effect";
import { VariantSchema } from "effect/schema";
import type * as FirestoreModel from "../FirestoreModel.ts";
import type * as FirestoreSchema from "../FirestoreSchema.ts";
import * as fieldValue from "./fieldValue.ts";
import * as firestoreSchema from "./firestoreSchema.ts";
import * as firestoreValue from "./firestoreValue.ts";
import * as firestoreValueWalk from "./firestoreValueWalk.ts";
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
export const UnionTypeId = "~@visiolab/effect-firebase/firestore/FirestoreModel/Union";

// What `VariantSchema` tells a field by, which a union carries to be extracted
// variant by variant inside a struct, as a field is.
const FieldTypeId = "~effect/schema/VariantSchema/Field";

type Members = ReadonlyArray<VariantSchema.Struct<any>>;

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
   * The members of a union, which has no fields of its own to reach into: it
   * is written whole.
   */
  readonly members?: Members | undefined;
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
  if (Predicate.hasProperty(field, UnionTypeId)) {
    return unionNode(field[UnionTypeId] as Members, optional);
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
  node.members !== undefined
    ? node.members.every(isMemberReplaceable)
    : isReplaceable(node.fields) &&
      (node.rest === undefined ||
        isReplaceable({ _: node.rest.value } as VariantSchema.Struct.Fields));

const isMemberReplaceable = (member: VariantSchema.Struct<any>): boolean =>
  isReplaceable(fields(member));

/** The union of what `set` writes each of `members` as. */
const unionCreate = (members: Members): Schema.Top =>
  Schema.Union(members.map((member) => extract(member, "create") as Schema.Top));

const unionNode = (members: Members, optional: boolean): Node => ({
  fields: {},
  members,
  key: undefined,
  rest: undefined,
  create: () => unionCreate(members),
  optional,
  writable:
    optional ||
    members.some(isMemberReplaceable) ||
    buildShared(members.map(fields), [], { known: {}, patterns: new Map() }, "unchecked").keys
      .length > 0,
});

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
  if (node.members !== undefined) {
    return buildUnion(node, node.members, path, paths, mode);
  }
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

/**
 * Builds what a union at `path` takes in `mode`, gathering the paths it writes
 * at into `paths`. A union is replaced with any member it may be replaced
 * with, removed where it may be missing, and patched at its Shared Fields -
 * and, unchecked, at a key only some members hold - see {@link buildShared}.
 * The patch is refused where it may be missing and the patch is checked, as it
 * is for a struct. One that takes none of these in `mode` takes nothing.
 */
const buildUnion = (
  node: Node,
  members: Members,
  path: Path,
  paths: Paths,
  mode: FirestoreModel.UpdateMode,
): { readonly schema: Schema.Top; readonly shape: Shape } => {
  const replaceable = members.filter(isMemberReplaceable);
  const create = replaceable.length === 0 ? undefined : unionCreate(replaceable);
  const shared = buildShared(members.map(fields), path, paths, mode);
  const takes: Array<Schema.Top> = [];
  if (shared.keys.length > 0 && (!node.optional || mode === "unchecked")) {
    takes.push(shared.patch);
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
    shape: shared.shape,
  };
};

/** What a field was made {@link FirestoreModel.Optional} of, or the field itself. */
const unwrap = (field: unknown): unknown => (isOptional(field) ? field.field : field);

/** The types a type is a union of, or the type itself. */
const constituents = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.AST> =>
  SchemaAST.isUnion(ast) ? ast.types.flatMap(constituents) : [ast];

/** What a declaration is told apart by, where it says. */
const declarationId = (ast: SchemaAST.Declaration): unknown =>
  (ast.annotations?.representation as { readonly id?: unknown } | undefined)?.id;

/** The type of a literal a keyword is the type of. */
const keywordOf = (literal: unknown): string =>
  typeof literal === "string"
    ? "String"
    : typeof literal === "number"
      ? "Number"
      : typeof literal === "boolean"
        ? "Boolean"
        : "BigInt";

/**
 * Whether every value of `a` is one of `b`, the way TypeScript tells whether
 * one type extends another, as far as the schemas say. Where they do not say -
 * a declaration with nothing to tell it apart by, a suspended schema - it is
 * taken to be, so the encoding decides.
 */
const isSubtype = (a: SchemaAST.AST, b: SchemaAST.AST): boolean => {
  if (SchemaAST.isUnion(a)) {
    return a.types.every((type) => isSubtype(type, b));
  }
  if (SchemaAST.isUnion(b)) {
    return b.types.some((type) => isSubtype(a, type));
  }
  if (SchemaAST.isAny(b) || SchemaAST.isUnknown(b) || SchemaAST.isNever(a) || SchemaAST.isAny(a)) {
    return true;
  }
  if (SchemaAST.isSuspend(a) || SchemaAST.isSuspend(b)) {
    return true;
  }
  if (SchemaAST.isLiteral(a)) {
    return SchemaAST.isLiteral(b)
      ? a.literal === b.literal
      : SchemaAST.isEnum(b)
        ? b.enums.some(([, value]) => value === a.literal)
        : SchemaAST.isTemplateLiteral(b)
          ? typeof a.literal === "string"
          : b._tag === keywordOf(a.literal);
  }
  if (SchemaAST.isEnum(a)) {
    return a.enums.every(([, value]) => isSubtype(new SchemaAST.Literal(value), b));
  }
  if (SchemaAST.isTemplateLiteral(a)) {
    return SchemaAST.isString(b) || SchemaAST.isTemplateLiteral(b);
  }
  if (SchemaAST.isUniqueSymbol(a)) {
    return SchemaAST.isSymbol(b) || (SchemaAST.isUniqueSymbol(b) && a.symbol === b.symbol);
  }
  if (SchemaAST.isUndefined(a) && SchemaAST.isVoid(b)) {
    return true;
  }
  if (SchemaAST.isObjectKeyword(b)) {
    return (
      SchemaAST.isObjectKeyword(a) ||
      SchemaAST.isObjects(a) ||
      SchemaAST.isArrays(a) ||
      SchemaAST.isDeclaration(a)
    );
  }
  if (SchemaAST.isDeclaration(a)) {
    if (SchemaAST.isDeclaration(b)) {
      const [ida, idb] = [declarationId(a), declarationId(b)];
      return (
        a === b ||
        ida === undefined ||
        idb === undefined ||
        (ida === idb &&
          a.typeParameters.length === b.typeParameters.length &&
          a.typeParameters.every((p, i) => isSubtype(p, b.typeParameters[i])))
      );
    }
    // An instance may well have every property a struct asks for.
    return SchemaAST.isObjects(b);
  }
  if (SchemaAST.isObjects(a)) {
    if (SchemaAST.isDeclaration(b)) {
      return declarationId(b) === undefined;
    }
    if (!SchemaAST.isObjects(b)) {
      return false;
    }
    const own = new Map(a.propertySignatures.map((p) => [p.name, p.type]));
    return (
      b.propertySignatures.every((p) => {
        const type = own.get(p.name);
        return type === undefined
          ? SchemaAST.isOptional(p.type)
          : (SchemaAST.isOptional(p.type) || !SchemaAST.isOptional(type)) &&
              isSubtype(type, p.type);
      }) &&
      b.indexSignatures.every((index) =>
        [...a.propertySignatures, ...a.indexSignatures].every((p) => isSubtype(p.type, index.type)),
      )
    );
  }
  if (SchemaAST.isArrays(a)) {
    if (!SchemaAST.isArrays(b)) {
      return false;
    }
    if (b.elements.length === 0 && b.rest.length === 1) {
      return [...a.elements, ...a.rest].every((type) => isSubtype(type, b.rest[0]));
    }
    return (
      a.elements.length !== b.elements.length ||
      a.rest.length !== b.rest.length ||
      [...a.elements, ...a.rest].every((type, i) => isSubtype(type, [...b.elements, ...b.rest][i]))
    );
  }
  return a._tag === b._tag;
};

/**
 * The values out of `a` and `b` that the other takes too: each type `a` is a
 * union of that `b` takes whole, and the other way round, as `Meet` works it
 * out in the types.
 */
const meet = (
  a: ReadonlyArray<SchemaAST.AST>,
  b: ReadonlyArray<SchemaAST.AST>,
): ReadonlyArray<SchemaAST.AST> => {
  const within = (types: ReadonlyArray<SchemaAST.AST>) => (type: SchemaAST.AST) =>
    types.some((other) => isSubtype(type, other));
  return [...a.filter(within(b)), ...b.filter(within(a))];
};

/**
 * Whether some value is taken by every one of `schemas`, as `MeetAll` tells it
 * in the types, so a key is shared, and has a path, exactly where its type
 * says. The literal that tells members apart takes none.
 */
const meets = (schemas: ReadonlyArray<Schema.Top>): boolean =>
  schemas.map((schema) => constituents(schema.ast)).reduceRight((acc, types) => meet(types, acc))
    .length > 0;

/**
 * What a Shared Field is patched through: the value is encoded through the
 * field of every member, each of which must take it, and all of which must
 * store it as the same Firestore Value. Each member decides by the canonical
 * codec, not by the encoding the caller asks for, since that is what Firestore
 * ends up holding. It is written as the first member writes it, which is then
 * what every member would write.
 */
const SharedValueSchema = (schemas: ReadonlyArray<Schema.Top>): Schema.Top => {
  if (schemas.length === 1) {
    return schemas[0];
  }
  // Encoding runs synchronously, as a check does, so a member's encoding may
  // ask for no service.
  const codecs = schemas.map((schema) =>
    firestoreValue.toCodecFirestore(schema as Schema.Codec<unknown, unknown>),
  );
  return schemas[0].check(
    Schema.makeFilter(
      (value: unknown, _, options) => {
        let stored: unknown;
        for (const [i, codec] of codecs.entries()) {
          const result = SchemaParser.encodeUnknownResult(codec)(value, options);
          if (Result.isFailure(result)) {
            return result.failure;
          }
          if (i === 0) {
            stored = result.success;
          } else if (!firestoreValueWalk.equals(stored, result.success)) {
            return "Expected a value every member of the union stores the same way";
          }
        }
        return undefined;
      },
      { expected: "a value every member of the union takes and stores the same way" },
    ),
  );
};

/**
 * The patch of the Shared Fields of a union, refusing a key it does not know,
 * since a `Schema.Struct` would otherwise drop it and write nothing. That is a
 * key some member goes without, or one the members cannot agree on, such as
 * the literal they are told apart by.
 */
const SharedPatchSchema = (fields: Schema.Top, keys: ReadonlyArray<string>): Schema.Top =>
  Schema.declareConstructor<any, any>()(
    [fields],
    ([fields]) =>
      (input, ast, options) => {
        if (patch.isReplace(input) || fieldValue.isDeleteField(input)) {
          return Effect.fail(new SchemaIssue.InvalidType(ast, input, options));
        }
        if (Predicate.isObject(input)) {
          const unknown = Object.keys(input).find((key) => !keys.includes(key));
          if (unknown !== undefined) {
            return Effect.fail(
              new SchemaIssue.Pointer(
                [unknown],
                new SchemaIssue.UnexpectedKey(ast, (input as Record<string, unknown>)[unknown]),
              ),
            );
          }
        }
        return SchemaParser.decodeUnknownEffect(fields)(input, options);
      },
    { expected: "a patch of the Shared Fields of a union" },
  );

/**
 * Builds the patch of the Shared Fields of a union, given the fields of each
 * of its members, along with where the structs among them sit, and gathers the
 * schema of each path it can write at into `paths`.
 *
 * A Shared Field is a key every member holds, at which every member takes an
 * update: a value, patched through {@link SharedValueSchema}, or a struct,
 * patched at its own Shared Fields by the same rule one level down. A struct
 * every member may go without takes the removal alone, and one only some
 * members may go without takes nothing. A Record or a union is not shared.
 * Where no value is taken by every member's type, as {@link meets} tells, the
 * key is not shared either, which is what keeps it out of `paths` exactly
 * where the type keeps it out.
 *
 * Under `unchecked`, a key only some members hold is patched by the same rule
 * over just those members. Its path is gathered in either mode, so the paths
 * are the same in both and only the patch tells them apart.
 */
const buildShared = (
  memberFields: ReadonlyArray<VariantSchema.Struct.Fields>,
  path: Path,
  paths: Paths,
  mode: FirestoreModel.UpdateMode,
): { readonly patch: Schema.Top; readonly shape: Shape; readonly keys: ReadonlyArray<string> } => {
  const schemas: Record<string, Schema.Top> = {};
  const shapes: Record<string, Shape> = {};
  const names = [...new Set(memberFields.flatMap((f) => Object.keys(f)))];
  for (const key of names) {
    // A key only some members hold is checked against just those, and only
    // patched where the caller vouches for the member. It is written at its
    // path in either mode, as a struct a document may go without is.
    const holders = memberFields.filter((f) => Object.hasOwn(f, key));
    const taken = holders.length === memberFields.length || mode === "unchecked";
    if (key.includes(".")) {
      throw new Error(`Invalid Firestore field name "${key}": it must not contain "."`);
    }
    const at = [...path, key];
    const held = holders.map((f) => f[key]);
    if (held.every((field) => VariantSchema.isStruct(unwrap(field)))) {
      if (held.every((field) => !isOptional(field))) {
        const inner = buildShared(
          held.map((field) => fields(field as VariantSchema.Struct<any>)),
          at,
          paths,
          mode,
        );
        if (taken && inner.keys.length > 0) {
          schemas[key] = Schema.optionalKey(inner.patch);
          shapes[key] = inner.shape;
        }
      } else if (held.every(isOptional)) {
        if (taken) {
          schemas[key] = Schema.optionalKey(firestoreSchema.DeleteField);
        }
        addPath(paths, at, firestoreSchema.DeleteField);
      }
    } else if (held.every((field) => nodeOf(field) === undefined)) {
      const updates = held.map(updateSchema);
      if (updates.every((u) => u !== undefined) && meets(updates)) {
        const schema = SharedValueSchema(updates.map(withoutConstructorDefault));
        if (taken) {
          schemas[key] = Schema.optionalKey(schema);
        }
        addPath(paths, at, schema);
      }
    }
  }
  const keys = Object.keys(schemas);
  return {
    patch: SharedPatchSchema(Schema.Struct(schemas), keys),
    shape: { fields: shapes, rest: undefined },
    keys,
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

/** @internal */
export const Union = (members: Members): any => {
  // Each member as the default variant is read, which keeps a class a class.
  // Effect builds the same for its own union, though only it can extract
  // that, and its union defines the variants for good, so it is rebuilt here.
  const read = Schema.Union((Variants.Union(members) as Schema.Union<any>).members);
  const node = unionNode(members, false);
  const schemas = {
    read,
    create: node.create(),
    ...(node.writable && { update: nodeUpdate(node) }),
  };
  return Object.defineProperties(read, {
    [FieldTypeId]: { value: FieldTypeId },
    schemas: { value: schemas },
    read: { value: Schema.Union(members.map((member) => extract(member, "read") as Schema.Top)) },
    create: { value: schemas.create },
    [UnionTypeId]: { value: members },
  });
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
