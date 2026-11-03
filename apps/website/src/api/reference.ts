/**
 * The API reference, read from the packages' own declarations.
 *
 * Each package's public modules are compiled to declaration files in memory.
 * A module's page is built from its declaration file: an export's JSDoc gives
 * its description and tags, and the export's declaration is its signature, so
 * the signature reads exactly as a consumer's editor shows it.
 */
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { format } from "oxfmt";
import ts from "typescript";
import { packageRoot, packages, publicModules } from "./packages.ts";

/**
 * Rendered Markdown, with its code blocks kept apart so the page renders them
 * the way it renders every other code block.
 */
export type Rich = ReadonlyArray<
  | { readonly kind: "html"; readonly html: string }
  | { readonly kind: "code"; readonly code: string; readonly lang: string }
>;

export interface Doc {
  readonly body: Rich;
  readonly since: string | undefined;
  readonly stability: string | undefined;
  /** Tags rendered as sections of their own, such as `@see` and `@deprecated`. */
  readonly sections: ReadonlyArray<{ readonly title: string; readonly body: Rich }>;
  readonly examples: ReadonlyArray<Example>;
}

/** An `@example`: its code, under the title written after the tag, if any. */
export interface Example {
  readonly title: string | undefined;
  readonly code: string;
}

/** A documented member of an interface or class, such as `Firestore.With`'s `getDoc`. */
export interface Member {
  readonly name: string;
  readonly anchor: string;
  readonly signature: string;
  readonly doc: Doc;
}

export interface Declaration {
  readonly name: string;
  readonly anchor: string;
  readonly kind: string;
  readonly signature: string;
  readonly doc: Doc;
  readonly members: ReadonlyArray<Member>;
  readonly sourceUrl: string;
}

export interface Category {
  readonly name: string;
  readonly anchor: string;
  readonly declarations: ReadonlyArray<Declaration>;
}

export interface Module {
  /** The module's path as it is imported, `firestore/Collection`. */
  readonly path: string;
  readonly name: string;
  readonly doc: Doc | undefined;
  readonly exportCount: number;
  readonly sourceUrl: string;
  readonly categories: ReadonlyArray<Category>;
}

export interface PackageReference {
  readonly dir: string;
  readonly name: string;
  readonly readme: Rich;
  readonly modules: ReadonlyArray<Module>;
}

export const modulePath = (pkg: { readonly dir: string }, module: { readonly path: string }) =>
  `/api/${pkg.dir}/${module.path}/`;

// Parsing -------------------------------------------------------------------

/** A JSDoc comment split into its description and its block tags. */
interface RawDoc {
  readonly description: string;
  readonly tags: ReadonlyArray<{ readonly tag: string; readonly text: string }>;
}

const parseJsDoc = (raw: string): RawDoc => {
  const lines = raw
    .replace(/^\/\*\*\s?/, "")
    .replace(/\s*\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""));
  const description: Array<string> = [];
  const tags: Array<{ tag: string; lines: Array<string> }> = [];
  let fenced = false;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    const tag = fenced ? null : /^@(\w+)\s?(.*)$/.exec(line);
    if (tag !== null) tags.push({ tag: tag[1]!, lines: [tag[2]!] });
    else (tags.at(-1)?.lines ?? description).push(line);
  }
  return {
    description: description.join("\n").trim(),
    tags: tags.map(({ tag, lines }) => ({ tag, text: lines.join("\n").trim() })),
  };
};

const jsDocRanges = (text: string, node: ts.Node): Array<string> =>
  (ts.getLeadingCommentRanges(text, node.pos) ?? [])
    .map((range) => text.slice(range.pos, range.end))
    .filter((comment) => comment.startsWith("/**"));

const isExported = (node: ts.Statement) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

const declarationOf = (node: ts.Statement): { name: string; kind: string } | undefined => {
  if (ts.isVariableStatement(node)) {
    const declaration = node.declarationList.declarations[0];
    if (declaration === undefined || !ts.isIdentifier(declaration.name)) return undefined;
    const kind = node.declarationList.flags & ts.NodeFlags.Const ? "const" : "let";
    return { name: declaration.name.text, kind };
  }
  const kind = ts.isInterfaceDeclaration(node)
    ? "interface"
    : ts.isTypeAliasDeclaration(node)
      ? "type"
      : ts.isClassDeclaration(node)
        ? "class"
        : ts.isFunctionDeclaration(node)
          ? "function"
          : ts.isModuleDeclaration(node)
            ? "namespace"
            : ts.isEnumDeclaration(node)
              ? "enum"
              : undefined;
  const name = (node as { name?: ts.Node }).name;
  return kind === undefined || name === undefined || !ts.isIdentifier(name)
    ? undefined
    : { name: name.text, kind };
};

/** The names an `export { … } from "…"` re-exports, as they are exported. */
const reexported = (statement: ts.Statement): ReadonlyArray<ts.ExportSpecifier> =>
  ts.isExportDeclaration(statement) &&
  !statement.isTypeOnly &&
  statement.moduleSpecifier !== undefined &&
  statement.exportClause !== undefined &&
  ts.isNamedExports(statement.exportClause)
    ? statement.exportClause.elements.filter((specifier) => !specifier.isTypeOnly)
    : [];

const printer = ts.createPrinter({ removeComments: true });

/**
 * Prints a declaration the way a consumer reads it. A class that extends a
 * base the compiler declared beside it, such as the `FirestoreError_base` of a
 * `Schema.TaggedError`, is printed after that base, which is where its fields
 * are.
 */
const printDeclaration = (statement: ts.Statement, file: ts.SourceFile): string => {
  const printed = printer
    .printNode(ts.EmitHint.Unspecified, statement, file)
    .replace(/^export /, "");
  if (!ts.isClassDeclaration(statement)) return printed;
  const base = statement.heritageClauses?.[0]?.types[0]?.expression;
  if (base === undefined || !ts.isIdentifier(base)) return printed;
  const baseStatement = file.statements.find(
    (other) =>
      ts.isVariableStatement(other) &&
      !isExported(other) &&
      other.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === base.text,
      ),
  );
  return baseStatement === undefined
    ? printed
    : `${printer.printNode(ts.EmitHint.Unspecified, baseStatement, file)}\n${printed}`;
};

interface RawMember {
  readonly name: string;
  readonly signature: string;
  readonly doc: RawDoc;
}

interface RawDeclaration {
  readonly name: string;
  readonly kind: string;
  readonly signature: string;
  readonly doc: RawDoc;
  readonly members: ReadonlyArray<RawMember>;
  readonly line: number;
}

interface RawModule {
  readonly path: string;
  readonly doc: RawDoc | undefined;
  readonly declarations: ReadonlyArray<RawDeclaration>;
}

/** Where each export starts in the module's source, by name, in order. */
const sourceLines = (file: string): Map<string, Array<number>> => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const lines = new Map<string, Array<number>>();
  const add = (name: string, node: ts.Node) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    lines.set(name, [...(lines.get(name) ?? []), line]);
  };
  for (const statement of source.statements) {
    for (const specifier of reexported(statement)) add(specifier.name.text, specifier);
    const declaration = isExported(statement) ? declarationOf(statement) : undefined;
    if (declaration !== undefined) add(declaration.name, statement);
  }
  return lines;
};

/**
 * The members of an interface or class that carry a JSDoc comment of their
 * own, each with the signature it is declared with. Overloads of a member are
 * one member with several signatures, documented by the first.
 */
const membersOf = (statement: ts.Statement, text: string, file: ts.SourceFile) => {
  if (!ts.isInterfaceDeclaration(statement) && !ts.isClassDeclaration(statement)) return [];
  const members: Array<RawMember> = [];
  for (const member of statement.members) {
    const name = member.name;
    if (name === undefined || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) continue;
    const signature = printer.printNode(ts.EmitHint.Unspecified, member, file);
    const previous = members.at(-1);
    if (previous?.name === name.text) {
      members[members.length - 1] = {
        ...previous,
        signature: `${previous.signature}\n${signature}`,
      };
      continue;
    }
    const comment = jsDocRanges(text, member).at(-1);
    if (comment !== undefined)
      members.push({ name: name.text, signature, doc: parseJsDoc(comment) });
  }
  return members;
};

/** Reads a module's emitted declaration file, by the path of its source. */
type DeclarationReader = (sourceFile: string) => string | undefined;

/**
 * The declaration a re-export stands for, read from the module it comes from,
 * as the module that re-exports it names it.
 */
const reexportTarget = (
  specifier: ts.ExportSpecifier,
  from: string,
  sourceFile: string,
  readDeclarations: DeclarationReader,
) => {
  const text = readDeclarations(resolve(dirname(sourceFile), from));
  if (text === undefined) return undefined;
  const file = ts.createSourceFile("target.d.ts", text, ts.ScriptTarget.Latest, true);
  const original = (specifier.propertyName ?? specifier.name).text;
  for (const statement of file.statements) {
    const declaration = isExported(statement) ? declarationOf(statement) : undefined;
    if (declaration?.name !== original) continue;
    return {
      kind: declaration.kind,
      signature: printDeclaration(statement, file).replaceAll(
        new RegExp(`\\b${original}\\b`, "g"),
        specifier.name.text,
      ),
      members: membersOf(statement, text, file),
    };
  }
  return undefined;
};

const readModule = (
  path: string,
  sourceFile: string,
  declarationText: string,
  readDeclarations: DeclarationReader,
): RawModule => {
  const file = ts.createSourceFile("module.d.ts", declarationText, ts.ScriptTarget.Latest, true);
  const lines = sourceLines(sourceFile);
  const first = file.statements[0];
  // The module's own comment opens the file. Above an import it can only be
  // the module's; above a declaration, it is the module's only when the
  // declaration has a comment of its own after it.
  const opening = first === undefined ? [] : jsDocRanges(declarationText, first);
  const moduleComment =
    first !== undefined && (ts.isImportDeclaration(first) || opening.length > 1)
      ? opening[0]
      : undefined;

  const declarations: Array<RawDeclaration> = [];
  const occurrenceOf = (name: string) => declarations.filter((d) => d.name === name).length;
  for (const statement of file.statements) {
    // A re-export is documented where it is re-exported, and declared where it
    // comes from.
    for (const specifier of reexported(statement)) {
      const from = (statement as ts.ExportDeclaration).moduleSpecifier as ts.StringLiteral;
      const target = reexportTarget(specifier, from.text, sourceFile, readDeclarations);
      if (target === undefined) continue;
      const name = specifier.name.text;
      const comment = jsDocRanges(declarationText, specifier).at(-1);
      declarations.push({
        name,
        ...target,
        doc: comment === undefined ? { description: "", tags: [] } : parseJsDoc(comment),
        line: lines.get(name)?.[occurrenceOf(name)] ?? 1,
      });
    }
    const declaration = isExported(statement) ? declarationOf(statement) : undefined;
    if (declaration === undefined) continue;
    const signature = printDeclaration(statement, file);
    const previous = declarations.at(-1);
    // Overloads are one declaration with several signatures.
    if (previous?.name === declaration.name && previous.kind === declaration.kind) {
      declarations[declarations.length - 1] = {
        ...previous,
        signature: `${previous.signature}\n${signature}`,
      };
      continue;
    }
    const comment = jsDocRanges(declarationText, statement).at(-1);
    const occurrence = occurrenceOf(declaration.name);
    declarations.push({
      ...declaration,
      signature,
      doc: comment === undefined ? { description: "", tags: [] } : parseJsDoc(comment),
      members: membersOf(statement, declarationText, file),
      line: lines.get(declaration.name)?.[occurrence] ?? 1,
    });
  }
  return {
    path,
    doc: moduleComment === undefined ? undefined : parseJsDoc(moduleComment),
    declarations,
  };
};

/** Compiles the package's public modules to declaration files in memory. */
const readPackage = (dir: string): ReadonlyArray<RawModule> => {
  const root = packageRoot(dir);
  const config = ts.getParsedCommandLineOfConfigFile(resolve(root, "tsconfig.json"), undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  });
  const modules = publicModules(dir).map((path) => ({
    path,
    sourceFile: resolve(root, "src", `${path}.ts`),
  }));
  const program = ts.createProgram(
    modules.map(({ sourceFile }) => sourceFile),
    {
      ...config?.options,
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      removeComments: false,
    },
  );
  const emitted = new Map<string, string>();
  // Type errors do not stop declaration emit, and the packages' own checks
  // guard them.
  program.emit(undefined, (name, text) => emitted.set(name, text), undefined, true);
  return modules.map(({ path, sourceFile }) =>
    readModule(
      path,
      sourceFile,
      emitted.get(sourceFile.replace(/\.ts$/, ".d.ts")) ?? "",
      (source) => emitted.get(source.replace(/\.ts$/, ".d.ts")),
    ),
  );
};

// Rendering -----------------------------------------------------------------

const markdown = await createMarkdownProcessor();

const renderMarkdown = async (source: string): Promise<string> =>
  source.trim() === "" ? "" : (await markdown.render(source)).code;

const renderRich = async (source: string): Promise<Rich> => {
  // Splitting on a fence with a capture group alternates prose and code:
  // prose, lang, code, prose, lang, code, ..., prose.
  const parts = source.split(/^```(\w*)\n([\s\S]*?)^```$/m);
  const blocks: Array<Rich[number]> = [];
  for (let index = 0; index < parts.length; index += 3) {
    const html = await renderMarkdown(parts[index]!);
    if (html !== "") blocks.push({ kind: "html", html });
    const code = parts[index + 2];
    if (code !== undefined)
      blocks.push({ kind: "code", code: code.trimEnd(), lang: parts[index + 1] || "ts" });
  }
  return blocks;
};

/** Wraps a signature to the width of the page's code blocks. */
const formatSignature = async (signature: string): Promise<string> => {
  const { code, errors } = await format("signature.ts", signature, { printWidth: 80 });
  return errors.length === 0 ? code.trimEnd() : signature;
};

/**
 * Wraps a member's signature as {@link formatSignature} does a declaration's,
 * formatting it inside an interface, since a member alone does not parse.
 */
const formatMemberSignature = async (signature: string): Promise<string> => {
  const { code, errors } = await format("signature.ts", `interface _ {\n${signature}\n}`, {
    printWidth: 82,
  });
  if (errors.length > 0) return signature;
  return code
    .trimEnd()
    .split("\n")
    .slice(1, -1)
    .map((line) => line.replace(/^  /, ""))
    .join("\n");
};

const tagText = (doc: RawDoc, tag: string) => doc.tags.find((t) => t.tag === tag)?.text;

const example = (text: string): Example => {
  const fence = text.indexOf("```");
  if (fence === -1) return { title: undefined, code: text };
  const title = text.slice(0, fence).trim();
  return {
    title: title === "" ? undefined : title,
    code: /```\w*\n([\s\S]*?)```/.exec(text.slice(fence))?.[1]?.trimEnd() ?? text,
  };
};

const sectionTitles: Record<string, string> = { see: "See", deprecated: "Deprecated" };
const metadataTags = new Set(["since", "stability", "category", "example"]);

type LinkResolver = (target: string) => string | undefined;

/**
 * Turns `{@link target}`, `{@link target | text}` and `{@link target text}`
 * into Markdown links, or into code where the target is not documented.
 */
const resolveLinks = (source: string, resolveLink: LinkResolver) =>
  source.replace(
    /\{@link(?:code|plain)?\s+([^\s|}]+)\s*(?:\|\s*)?([^}]*)\}/g,
    (_, target, text) => {
      const label = text.trim() === "" ? `\`${target}\`` : text.trim();
      const href = resolveLink(target);
      return href === undefined ? label : `[${label}](${href})`;
    },
  );

const renderDoc = async (doc: RawDoc, resolveLink: LinkResolver): Promise<Doc> => ({
  body: await renderRich(resolveLinks(doc.description, resolveLink)),
  since: tagText(doc, "since"),
  stability: tagText(doc, "stability"),
  sections: await Promise.all(
    doc.tags
      .filter(({ tag }) => !metadataTags.has(tag))
      .map(async ({ tag, text }) => ({
        title: sectionTitles[tag] ?? tag[0]!.toUpperCase() + tag.slice(1),
        body: await renderRich(resolveLinks(text, resolveLink)),
      })),
  ),
  examples: doc.tags.filter(({ tag }) => tag === "example").map(({ text }) => example(text)),
});

const sourceUrl = (dir: string, path: string) =>
  `https://github.com/VisioLab/effect-firebase/blob/main/packages/${dir}/src/${path}.ts`;

const memberAnchor = (anchor: string, member: string) => `${anchor}.${member}`;

/** Splits `a.b.c` into `a` and `b.c`. */
const splitFirst = (name: string): [string, string | undefined] => {
  const dot = name.indexOf(".");
  return dot === -1 ? [name, undefined] : [name.slice(0, dot), name.slice(dot + 1)];
};

const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const compareCategories = (left: string, right: string) =>
  Number(left === "Other") - Number(right === "Other") || left.localeCompare(right);

/**
 * Reads the API reference of every package afresh. Every package at once,
 * since a `{@link}` may point into any of them.
 */
export const readApiReference = async (): Promise<ReadonlyArray<PackageReference>> => {
  const raw = packages.map((pkg) => ({ pkg, modules: readPackage(pkg.dir) }));

  // Anchors first, so a link can point at any module before it is rendered.
  const anchors = new Map<RawModule, Map<RawDeclaration, string>>();
  for (const { modules } of raw) {
    for (const module of modules) {
      const taken = new Set<string>();
      const moduleAnchors = new Map<RawDeclaration, string>();
      for (const declaration of module.declarations) {
        // A type and a value may share a name; the second takes its kind.
        const anchor = taken.has(declaration.name)
          ? `${declaration.name}-${declaration.kind}`
          : declaration.name;
        taken.add(anchor);
        moduleAnchors.set(declaration, anchor);
      }
      anchors.set(module, moduleAnchors);
    }
  }
  // `With.getDoc` names a member of `With`, which has an anchor of its own.
  const anchorOf = (module: RawModule, name: string) => {
    const [owner, member] = splitFirst(name);
    const found = [...anchors.get(module)!].find(([declaration]) => declaration.name === owner);
    if (found === undefined) return undefined;
    const [declaration, anchor] = found;
    if (member === undefined) return anchor;
    return declaration.members.some((m) => m.name === member)
      ? memberAnchor(anchor, member)
      : undefined;
  };
  const moduleNamed = (name: string, preferred: (typeof raw)[number]) =>
    [preferred, ...raw]
      .flatMap(({ pkg, modules }) => modules.map((module) => ({ pkg, module })))
      .find(({ module }) => module.path.split("/").at(-1) === name);

  const resolverFor =
    (current: (typeof raw)[number], module: RawModule): LinkResolver =>
    (target) => {
      const local = anchorOf(module, target);
      if (local !== undefined) return `#${local}`;
      const [head, member] = splitFirst(target);
      const other = moduleNamed(head, current);
      if (other === undefined) return undefined;
      const page = modulePath(other.pkg, other.module);
      if (member === undefined) return page;
      const anchor = anchorOf(other.module, member);
      return anchor === undefined ? page : `${page}#${anchor}`;
    };

  return Promise.all(
    raw.map(async (current) => {
      const { pkg, modules } = current;
      const readme = readFileSync(resolve(packageRoot(pkg.dir), "README.md"), "utf8")
        // The page has the package's name as its title already.
        .replace(/^# .*\n/, "");
      return {
        dir: pkg.dir,
        name: pkg.name,
        readme: await renderRich(readme),
        modules: await Promise.all(
          modules.map(async (module): Promise<Module> => {
            const resolveLink = resolverFor(current, module);
            const declarations = await Promise.all(
              module.declarations.map(async (declaration) => {
                const anchor = anchors.get(module)!.get(declaration)!;
                return {
                  category: tagText(declaration.doc, "category") ?? "Other",
                  declaration: {
                    name: declaration.name,
                    anchor,
                    kind: declaration.kind,
                    signature: await formatSignature(declaration.signature),
                    doc: await renderDoc(declaration.doc, resolveLink),
                    members: await Promise.all(
                      declaration.members.map(async (member) => ({
                        name: member.name,
                        anchor: memberAnchor(anchor, member.name),
                        signature: await formatMemberSignature(member.signature),
                        doc: await renderDoc(member.doc, resolveLink),
                      })),
                    ),
                    sourceUrl: `${sourceUrl(pkg.dir, module.path)}#L${declaration.line}`,
                  },
                };
              }),
            );
            const categories = Map.groupBy(declarations, ({ category }) => category);
            return {
              path: module.path,
              name: module.path.split("/").at(-1)!,
              doc: module.doc === undefined ? undefined : await renderDoc(module.doc, resolveLink),
              exportCount: module.declarations.length,
              sourceUrl: sourceUrl(pkg.dir, module.path),
              categories: [...categories]
                .toSorted(([left], [right]) => compareCategories(left, right))
                .map(([name, entries]) => ({
                  name,
                  anchor: `category-${slugify(name)}`,
                  declarations: entries
                    .map(({ declaration }) => declaration)
                    .toSorted((left, right) => left.name.localeCompare(right.name)),
                })),
            };
          }),
        ),
      };
    }),
  );
};
