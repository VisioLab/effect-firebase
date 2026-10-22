/**
 * The one place this package reaches into Effect's `@internal` `SchemaAST`
 * helpers.
 *
 * Effect has no public way to define a canonical format, so deriving
 * `toCodecFirestore` the way `toCodecJson` is derived needs the same internal
 * helpers Effect uses for it (ADR 0002). They exist at runtime but are stripped
 * from Effect's type declarations, so each is typed here by hand, against the
 * pinned `effect` version. Keeping them together means a future public API for
 * canonical formats is a swap of this module only.
 */
import { SchemaAST } from "effect";

interface Internals {
  readonly replaceEncoding: <A extends SchemaAST.AST>(
    ast: A,
    encoding: SchemaAST.Encoding | undefined,
  ) => A;
  readonly mapLink: (
    link: SchemaAST.Link,
    f: (ast: SchemaAST.AST) => SchemaAST.AST,
  ) => SchemaAST.Link;
  readonly replaceContextLastLink: <A extends SchemaAST.AST>(
    ast: A,
    context: SchemaAST.Context,
  ) => A;
  readonly applyToSelfOrLastLinkEncodingIdempotent: (
    f: (ast: SchemaAST.AST) => SchemaAST.AST,
  ) => (ast: SchemaAST.AST) => SchemaAST.AST;
  readonly parameterFromString: (ast: SchemaAST.AST) => SchemaAST.AST;
}

const internals = SchemaAST as unknown as Internals;

/** Replaces the encoding chain of `ast`, leaving `ast` alone when it is the same. */
export const replaceEncoding = internals.replaceEncoding;

/** Maps the target of `link`, leaving `link` alone when the target is unchanged. */
export const mapLink = internals.mapLink;

/** Replaces the context of the last link's target. */
export const replaceContextLastLink = internals.replaceContextLastLink;

/**
 * Applies `f` to the node itself when it has no encoding, or to the target of
 * its last encoding link otherwise, so user transformations run first. The
 * result is memoized per node.
 */
export const applyToSelfOrLastLinkEncodingIdempotent =
  internals.applyToSelfOrLastLinkEncodingIdempotent;

/** How a canonical format reads index-signature and property keys back from strings. */
export const parameterFromString = internals.parameterFromString;

/** The keywords whose canonical JSON form Effect derives itself. */
type JsonKeyword =
  | SchemaAST.Undefined
  | SchemaAST.Void
  | SchemaAST.Literal
  | SchemaAST.Number
  | SchemaAST.Symbol
  | SchemaAST.UniqueSymbol
  | SchemaAST.BigInt;

/** The keyword's own canonical JSON codec, as `toCodecJson` derives it. */
export const keywordToCodecJson = (ast: JsonKeyword): SchemaAST.AST =>
  (ast as unknown as { toCodecJson(): SchemaAST.AST }).toCodecJson();

/** The keyword's own canonical StringTree codec, as `toCodecStringTree` derives it. */
export const keywordToCodecStringTree = (ast: JsonKeyword): SchemaAST.AST =>
  (ast as unknown as { toCodecStringTree(): SchemaAST.AST }).toCodecStringTree();

/** Recurs into the members of a composite node. */
export const recur = <A extends SchemaAST.AST>(
  ast: A,
  f: (ast: SchemaAST.AST) => SchemaAST.AST,
  onKey?: (ast: SchemaAST.AST) => SchemaAST.AST,
): A =>
  (
    ast as unknown as {
      recur(f: (ast: SchemaAST.AST) => SchemaAST.AST, onKey?: unknown): A;
    }
  ).recur(f, onKey);
