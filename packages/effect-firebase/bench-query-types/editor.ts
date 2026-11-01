/**
 * THROWAWAY (#126). Editor latency through TypeScript 6's tsserver (the JS
 * language service; there is no scriptable tsgo one here), on the one-query
 * files: open and first diagnostics, the diagnostics after a one-character
 * edit (what each keystroke costs), and completions at the path.
 *
 *   vpx bench-query-types/editor.ts <name>
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const [name] = process.argv.slice(2);
const root = path.join(import.meta.dirname, "generated", name!);
const tsserver = path.join(
  import.meta.dirname,
  "../../../node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsserver.js",
);

/** Where completions are asked: inside the path literal, or after the field object. */
const styles = {
  baseline1: (_: string) => undefined,
  dotted1: (src: string) => src.indexOf(`Q.where("`) + `Q.where("`.length,
  dottedLookup1: (src: string) => src.indexOf(`Q.where("`) + `Q.where("`.length,
  fields1: (src: string) => src.indexOf(`(p0.`) + `(p0.`.length,
} as const;

const position = (src: string, at: number) => {
  const before = src.slice(0, at).split("\n");
  return { line: before.length, offset: before.at(-1)!.length + 1 };
};

const server = () => {
  const proc = spawn("node", [tsserver, "--disableAutomaticTypingAcquisition"], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buffer = "";
  let seq = 0;
  const waiting = new Map<number, (body: any) => void>();
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const header = buffer.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!header) return;
      const start = header.index! + header[0].length;
      const length = Number(header[1]);
      if (Buffer.byteLength(buffer.slice(start)) < length) return;
      const body = Buffer.from(buffer.slice(start)).subarray(0, length).toString();
      buffer = Buffer.from(buffer.slice(start)).subarray(length).toString();
      const msg = JSON.parse(body);
      if (msg.type === "response") waiting.get(msg.request_seq)?.(msg);
    }
  });
  const request = (command: string, args: unknown) =>
    new Promise<any>((resolve) => {
      const s = ++seq;
      waiting.set(s, resolve);
      proc.stdin.write(
        JSON.stringify({ seq: s, type: "request", command, arguments: args }) + "\n",
      );
    });
  const notify = (command: string, args: unknown) =>
    proc.stdin.write(
      JSON.stringify({ seq: ++seq, type: "request", command, arguments: args }) + "\n",
    );
  return { request, notify, close: () => proc.kill() };
};

const time = async <A>(f: () => Promise<A>) => {
  const start = performance.now();
  const a = await f();
  return [performance.now() - start, a] as const;
};

console.log(
  `\n### ${name} (tsserver, TypeScript 6.0.3)\n\n| style | open + diagnostics (ms) | per edit (ms, median of 5) | completions (ms) | entries |\n|---|---|---|---|---|`,
);
for (const [style, at] of Object.entries(styles)) {
  // Each style in its own folder with its own tsconfig.json, so tsserver does
  // not pick up the package one (which would load every generated file).
  const dir = path.join(root, `editor-${style}`);
  fs.mkdirSync(dir, { recursive: true });
  const src = fs
    .readFileSync(path.join(root, `${style}.ts`), "utf8")
    .replaceAll(`"./model.ts"`, `"../model.ts"`)
    .replaceAll(`"../../lib/`, `"../../../lib/`);
  const file = path.join(dir, "index.ts");
  fs.writeFileSync(file, src);
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      extends: "../../../../tsconfig.json",
      compilerOptions: { plugins: [], lib: ["es2023", "dom"] },
      files: ["./index.ts"],
    }),
  );

  const ts = server();
  const [open, first] = await time(async () => {
    ts.notify("open", { file });
    return ts.request("semanticDiagnosticsSync", { file });
  });
  const errors = first.body.length;

  // A keystroke at the end of the file: insert a space, re-check, remove it, re-check.
  const end = position(src, src.length);
  const edits: Array<number> = [];
  for (let i = 0; i < 5; i++) {
    const insert = i % 2 === 0;
    ts.notify("change", {
      file,
      ...end,
      endLine: end.line,
      endOffset: insert ? end.offset : end.offset + 1,
      insertString: insert ? " " : "",
    });
    const [ms] = await time(() => ts.request("semanticDiagnosticsSync", { file }));
    edits.push(ms);
  }
  edits.sort((a, b) => a - b);

  let completions = "-";
  let entries = "-";
  const offset = at(src);
  if (offset !== undefined) {
    // A keystroke first, so completions do not ride on the diagnostics' caches.
    ts.notify("change", {
      file,
      ...end,
      endLine: end.line,
      endOffset: end.offset,
      insertString: "\n",
    });
    const [ms, res] = await time(() =>
      ts.request("completionInfo", { file, ...position(src, offset) }),
    );
    completions = ms.toFixed(0);
    entries = String(res.body?.entries?.length ?? 0);
  }
  ts.close();
  console.log(
    `| ${style} | ${open.toFixed(0)}${errors ? ` (${errors} errors)` : ""} | ${edits[2]!.toFixed(0)} | ${completions} | ${entries} |`,
  );
}
