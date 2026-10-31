/**
 * A throwaway resolver of a field path through a model's read schema, walking
 * the public `SchemaAST`, and a check of each answer against what encoding the
 * whole document stores at that path.
 *
 * Run: vpx docs/research/field-path-through-model/resolve.ts
 */
import { DateTime, Option, Schema, SchemaAST } from "./effect.ts";
import {
  Collection,
  FirestoreModel,
  FirestoreSchema,
  FirestoreValue,
} from "../../../packages/effect-firebase/src/firestore/index.ts";

// ---------------------------------------------------------------------------
// The resolver

type Resolved =
  | { readonly _tag: "Leaves"; readonly leaves: ReadonlyArray<SchemaAST.AST> }
  | { readonly _tag: "Refused"; readonly reason: string };

const leaves = (leaves: ReadonlyArray<SchemaAST.AST>): Resolved => ({ _tag: "Leaves", leaves });
const refused = (reason: string): Resolved => ({ _tag: "Refused", reason });

/**
 * A `Schema.Class` (and so a `FirestoreModel.Class`) is a declaration whose
 * one type parameter is the struct it is encoded to, with a transformation
 * that only builds or unwraps the instance: its keys are the struct's keys.
 */
const classStruct = (ast: SchemaAST.Declaration): SchemaAST.Objects | undefined => {
  const last = ast.encoding?.[ast.encoding.length - 1]?.to;
  const [tp] = ast.typeParameters;
  return ast.typeParameters.length === 1 &&
    last !== undefined &&
    SchemaAST.isObjects(tp) &&
    tp === last
    ? tp
    : undefined;
};

/** The schemas a document may hold at `path`, one per member holding it. */
const resolve = (ast: SchemaAST.AST, path: ReadonlyArray<string>): Resolved => {
  if (path.length === 0) return leaves([ast]);
  const [key, ...rest] = path;
  switch (ast._tag) {
    case "Suspend":
      return resolve(ast.thunk(), path);
    case "Declaration": {
      const struct = classStruct(ast);
      return struct === undefined
        ? refused(`"${key}" is inside a declaration whose encoded keys are not known`)
        : resolve(struct, path);
    }
    case "Objects": {
      // A struct with an encoding of its own was transformed as a whole, as
      // `Schema.encodeKeys` does: its transformation is a function, so which
      // encoded key holds `key` cannot be read off the AST.
      if (ast.encoding !== undefined) {
        return refused(`"${key}" is inside a struct transformed as a whole (keys may be renamed)`);
      }
      const ps = ast.propertySignatures.find((p) => p.name === key);
      if (ps !== undefined) return resolve(ps.type, rest);
      const index = ast.indexSignatures.find((is) => Schema.is(Schema.make(is.parameter))(key));
      if (index !== undefined) return resolve(index.type, rest);
      return leaves([]);
    }
    case "Union": {
      // Every member that may hold the path; a document of any other member
      // simply has no value there, and Firestore never matches it.
      const out: Array<SchemaAST.AST> = [];
      for (const member of ast.types) {
        const r = resolve(member, path);
        if (r._tag === "Refused") return r;
        out.push(...r.leaves);
      }
      return leaves(out);
    }
    case "Arrays":
      return refused(`"${key}" indexes into an array, which a Firestore field path cannot`);
    default:
      return leaves([]);
  }
};

/** The schema of an element of an array field, for `array-contains`. */
const element = (ast: SchemaAST.AST): SchemaAST.AST | undefined =>
  SchemaAST.isArrays(ast) && ast.encoding === undefined
    ? ast.elements.length === 0 && ast.rest.length === 1
      ? ast.rest[0]
      : Schema.Union([...ast.elements, ...ast.rest].map((a) => Schema.make(a))).ast
    : undefined;

/**
 * Encodes `value` as each leaf stores it. One Firestore Value where every
 * member holding the path that takes the value stores it the same way, the
 * condition a Shared Field holds for an update.
 */
const encodeAt = (leavesAt: ReadonlyArray<SchemaAST.AST>, value: unknown) =>
  leavesAt.map((leaf) => {
    try {
      return {
        ok: Schema.encodeUnknownSync(FirestoreValue.toCodecFirestore(Schema.make(leaf)) as any)(
          value,
        ),
      };
    } catch (e) {
      return { error: (e as Error).message.split("\n")[0] };
    }
  });

// ---------------------------------------------------------------------------
// Models

const Person = Schema.Struct({ name: Schema.String, age: Schema.Number });

class Post extends FirestoreModel.Class<Post>("Post")({
  title: Schema.String,
  author: FirestoreModel.Struct({
    name: Schema.String,
    joined: Schema.DateTimeUtc,
  }),
  views: Schema.BigInt,
  nickname: FirestoreModel.Optional(Schema.String),
  subtitle: Schema.optional(Schema.String),
  editor: Schema.OptionFromOptionalKey(Schema.String),
  renamed: Person.pipe(Schema.encodeKeys({ name: "full_name" })),
  score: Schema.NumberFromString,
  tags: FirestoreModel.Array(Schema.String),
  seen: FirestoreModel.Array(Schema.Date),
  pair: Schema.Tuple([Schema.String, Schema.BigInt]),
  shape: FirestoreModel.Union([
    FirestoreModel.Struct({
      kind: Schema.Literal("circle"),
      radius: Schema.Number,
      at: Schema.Date,
    }),
    FirestoreModel.Struct({
      kind: Schema.Literal("square"),
      side: Schema.Number,
      at: Schema.DateFromString,
    }),
  ]),
  counts: FirestoreModel.Record(Schema.String, Schema.BigInt),
  set: Schema.ReadonlySet(Schema.Number),
}) {}

const Posts = Collection.make("posts", Post);

class Draft extends FirestoreModel.Class<Draft>("Draft")({
  status: Schema.Literal("draft"),
  title: Schema.String,
  updated: Schema.DateTimeUtc,
}) {}
class Published extends FirestoreModel.Class<Published>("Published")({
  status: Schema.Literal("published"),
  title: Schema.String,
  updated: Schema.Date,
  link: FirestoreSchema.DocumentReference(Posts),
}) {}
const Article = FirestoreModel.Union([Draft, Published]);

// ---------------------------------------------------------------------------
// Checks

const at = (doc: unknown, path: ReadonlyArray<string>): unknown =>
  path.reduce<any>((v, k) => (v === undefined ? undefined : v[k]), doc);

const show = (u: unknown): string =>
  JSON.stringify(u, (_, v) => (typeof v === "bigint" ? `${v}n` : v)) ?? String(u);

const check = (
  model: Schema.Top,
  doc: unknown,
  path: string,
  value?: { readonly value: unknown },
) => {
  const segments = path.split(".");
  const r = resolve(model.ast, segments);
  if (r._tag === "Refused") {
    console.log(`${path.padEnd(16)} REFUSED: ${r.reason}`);
    return;
  }
  const stored = at(
    Schema.encodeUnknownSync(FirestoreValue.toCodecFirestore(model as any) as any)(doc),
    segments,
  );
  const modelValue = value ? value.value : at(doc, segments);
  const encoded = encodeAt(r.leaves, modelValue);
  console.log(
    `${path.padEnd(16)} ${String(r.leaves.length)} leaf/leaves; model ${show(modelValue)} -> filter ${encoded.map(show).join(" | ")}; stored ${show(stored)}`,
  );
};

const post = Post.make({
  title: "t",
  author: { name: "Ada", joined: DateTime.makeUnsafe(1000) },
  views: 10n,
  nickname: "n",
  subtitle: undefined,
  editor: Option.none(),
  renamed: { name: "Ann", age: 3 },
  score: 7,
  tags: ["a", "b"],
  seen: [new Date(5)],
  pair: ["x", 1n],
  shape: { kind: "circle", radius: 2, at: new Date(7) },
  counts: { a: 1n },
  set: new Set([1]),
});

console.log("=== Post");
check(Post, post, "author.name");
check(Post, post, "author.joined");
check(Post, post, "views");
check(Post, post, "nickname");
check(Post, post, "subtitle");
check(Post, post, "editor");
check(Post, post, "editor", { value: Option.some("Eve") });
check(Post, post, "renamed.name");
check(Post, post, "score");
check(Post, post, "shape.radius");
check(Post, post, "shape.at");
check(Post, post, "counts.a");
check(Post, post, "tags.0");

console.log("\n=== Post, array-contains");
for (const [path, value] of [
  ["tags", "a"],
  ["seen", new Date(5)],
  ["pair", 1n],
] as const) {
  const r = resolve(Post.ast, [path]);
  if (r._tag === "Refused") continue;
  const el = element(r.leaves[0]);
  console.log(`${path.padEnd(16)} element ${el?._tag} -> ${show(el && encodeAt([el], value))}`);
}
{
  const r = resolve(Post.ast, ["set"]);
  console.log(
    `${"set".padEnd(16)} ${r._tag === "Leaves" ? `leaf ${r.leaves[0]._tag}, element ${String(element(r.leaves[0]))}` : r.reason}`,
  );
}

console.log("\n=== Article (union document)");
const published = Published.make({
  status: "published",
  title: "t",
  updated: new Date(1234),
  link: Option.getOrThrow(Collection.fromPath(Posts, "posts/p1")),
});
check(Article, published, "title");
check(Article, published, "status", { value: "draft" });
check(Article, published, "updated");
check(Article, published, "updated", { value: new Date(1234) });
check(Article, published, "link");
