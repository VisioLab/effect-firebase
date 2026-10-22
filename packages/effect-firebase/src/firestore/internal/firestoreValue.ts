import {
  DateTime,
  Effect,
  Predicate,
  Schema,
  SchemaAST,
  SchemaGetter,
  SchemaIssue,
  SchemaTransformation,
} from "effect";
import type * as FirestoreValue from "../FirestoreValue.ts";
import type * as Timestamp_ from "../Timestamp.ts";
import * as firestoreValueWalk from "./firestoreValueWalk.ts";
import * as schemaAST from "./schemaAST.ts";
import * as timestamp from "./timestamp.ts";
import * as timestampSchema from "./timestampSchema.ts";

/** @internal */
export const isFirestoreValue = firestoreValueWalk.isFirestoreValue;

/**
 * Accepts only Firestore Values. A declaration with no link to any canonical
 * format falls back to this, so a value Firestore cannot store fails at its own
 * path instead of being stored as a map.
 */
const FirestoreValueSchema = Schema.declare<FirestoreValue.FirestoreValue>(isFirestoreValue, {
  expected: "a Firestore value",
  toCodecFirestore: () => undefined,
});

/** @internal */
export const unknownToFirestore = new SchemaAST.Link(
  FirestoreValueSchema.ast,
  SchemaTransformation.passthrough(),
);

const timestampFromMillis = (millis: number, options: SchemaAST.ParseOptions) => {
  const out = timestamp.fromMillis(millis);
  return out._tag === "Some"
    ? Effect.succeed(out.value)
    : Effect.fail(
        new SchemaIssue.InvalidValue(
          { message: "Expected an instant Firestore can store, between the years 1 and 9999" },
          millis,
          options,
        ),
      );
};

const dateToTimestamp = Schema.link<globalThis.Date>()(timestampSchema.Timestamp, {
  decode: SchemaGetter.transform((ts: Timestamp_.Timestamp) => new Date(timestamp.toMillis(ts))),
  encode: SchemaGetter.transformEffect((date: globalThis.Date, options) =>
    timestampFromMillis(date.getTime(), options),
  ),
});

const dateTimeUtcToTimestamp = Schema.link<DateTime.Utc>()(timestampSchema.Timestamp, {
  decode: SchemaGetter.transform(timestamp.toDateTime),
  encode: SchemaGetter.transformEffect((dateTime: DateTime.Utc, options) =>
    timestampFromMillis(DateTime.toEpochMillis(dateTime), options),
  ),
});

const representationId = (ast: SchemaAST.Declaration): unknown => {
  const representation: unknown = ast.annotations?.representation;
  return Predicate.hasProperty(representation, "id") ? representation.id : undefined;
};

/**
 * Firestore's own types come first, so these win over the declaration's
 * `toCodecJson`, which would write a string.
 */
const nativeLink = (ast: SchemaAST.Declaration): SchemaAST.Link | null | undefined => {
  switch (representationId(ast)) {
    case "effect/schema/Date":
      return dateToTimestamp;
    case "effect/schema/DateTimeUtc":
      return dateTimeUtcToTimestamp;
    case "effect/schema/Uint8Array":
      return null;
  }
  return undefined;
};

type GetLink = (typeParameters: ReadonlyArray<Schema.Constraint>) => SchemaAST.Link | undefined;

const declarationStep = (
  ast: SchemaAST.Declaration,
  recur: (ast: SchemaAST.AST) => SchemaAST.AST,
): SchemaAST.AST => {
  const native = nativeLink(ast);
  if (native === null) return ast;
  if (native !== undefined) return schemaAST.replaceEncoding(ast, [native]);
  const annotations = ast.annotations as
    | {
        readonly toCodecFirestore?: unknown;
        readonly toCodecJson?: unknown;
        readonly toCodec?: unknown;
      }
    | undefined;
  const getLink = [
    annotations?.toCodecFirestore,
    annotations?.toCodecJson,
    annotations?.toCodec,
  ].find(Predicate.isFunction) as GetLink | undefined;
  if (getLink === undefined) return schemaAST.replaceEncoding(ast, [unknownToFirestore]);
  const typeParameters = ast.typeParameters.map((tp) => Schema.make(SchemaAST.toEncoded(tp)));
  const link = getLink(typeParameters);
  // `undefined` means the declaration is already canonical, and so is
  // everything it holds: in Firestore form, or in JSON form, and every JSON
  // value is a Firestore Value.
  return link === undefined
    ? ast
    : schemaAST.replaceEncoding(ast, [schemaAST.mapLink(link, recur)]);
};

const reorderUnion = (types: ReadonlyArray<SchemaAST.AST>): ReadonlyArray<SchemaAST.AST> => {
  // Members written as strings go first, so a string member doesn't swallow
  // them when reading back, as `toCodecJson` does.
  const priority = (ast: SchemaAST.AST): number => {
    switch (SchemaAST.toEncoded(ast)._tag) {
      case "BigInt":
      case "Symbol":
      case "UniqueSymbol":
        return 0;
      default:
        return 1;
    }
  };
  const sorted = [...types].sort((a, b) => priority(a) - priority(b));
  return sorted.some((ast, i) => ast !== types[i]) ? sorted : types;
};

const step = (ast: SchemaAST.AST, recur: (ast: SchemaAST.AST) => SchemaAST.AST): SchemaAST.AST => {
  switch (ast._tag) {
    case "Declaration":
      return declarationStep(ast, recur);
    // Unlike `Schema.toCodecJson`, `Schema.Any` is no escape hatch: the SDK
    // mappings take Firestore Values only, so nothing else may get past here.
    case "Any":
    case "Unknown":
    case "ObjectKeyword":
      return schemaAST.replaceEncoding(ast, [unknownToFirestore]);
    case "Undefined":
    case "Void":
    case "Literal":
      return schemaAST.keywordToCodecJson(ast);
    case "UniqueSymbol":
    case "Symbol":
    case "BigInt":
      return schemaAST.keywordToCodecStringTree(ast);
    case "Objects":
      // A map's keys are strings, so a struct keyed by a symbol has no
      // Firestore form. Derivation never fails: the struct takes Firestore
      // Values only, and encoding one fails with a schema issue at its path.
      if (ast.propertySignatures.some((ps) => typeof ps.name !== "string")) {
        return schemaAST.replaceEncoding(ast, [unknownToFirestore]);
      }
      return schemaAST.recur(ast, recur, schemaAST.parameterFromString);
    case "Union": {
      const types = reorderUnion(ast.types);
      const union =
        types === ast.types
          ? ast
          : new SchemaAST.Union(
              types,
              ast.options,
              ast.annotations,
              ast.checks,
              ast.encoding,
              ast.context,
              ast.encodingChecks,
            );
      return schemaAST.recur(union, recur);
    }
    case "Arrays":
    case "Suspend":
      return schemaAST.recur(ast, recur);
  }
  // `null`, `boolean`, `number` and `string` are already Firestore Values.
  return ast;
};

const withoutConstructorDefault = (context: SchemaAST.Context): SchemaAST.Context =>
  context.constructorDefault === undefined
    ? context
    : new SchemaAST.Context(context.isOptional, context.isMutable, undefined, context.annotations);

/** @internal */
export const toCodecFirestoreAST: (ast: SchemaAST.AST) => SchemaAST.AST =
  schemaAST.applyToSelfOrLastLinkEncodingIdempotent((ast) => {
    const out = step(ast, toCodecFirestoreAST);
    const context = ast.context;
    if (out === ast || context === undefined) return out;
    return schemaAST.replaceContextLastLink(out, withoutConstructorDefault(context));
  });

/** @internal */
export const toCodecFirestore = <S extends Schema.Constraint>(
  schema: S,
): FirestoreValue.toCodecFirestore<S> =>
  Schema.make<FirestoreValue.toCodecFirestore<S>>(toCodecFirestoreAST(schema.ast), { schema });
