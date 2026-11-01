/**
 * THROWAWAY (#126). Type-checks every style at the given scales, single
 * threaded, `runs` times each, and prints the median check time with the
 * (deterministic) instantiation and type counts.
 *
 *   vpx bench-query-types/run.ts <runs> <name>...
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const [runs, ...names] = process.argv.slice(2);
const tsc = path.join(import.meta.dirname, "../../../node_modules/.bin/tsc");
const styles = [
  "baseline",
  "dotted",
  "dottedLookup",
  "fields",
  "update",
  "baseline1",
  "dotted1",
  "dottedLookup1",
  "fields1",
];

for (const name of names) {
  console.log(
    `\n### ${name}\n\n| style | check (s, median) | instantiations | types | memory (MB) | errors |\n|---|---|---|---|---|---|`,
  );
  for (const style of styles) {
    const samples: Array<Record<string, number>> = [];
    let errors = "";
    for (let i = 0; i < Number(runs); i++) {
      const config = path.join(import.meta.dirname, "generated", name, `tsconfig.${style}.json`);
      const r = spawnSync(tsc, ["-p", config, "--extendedDiagnostics", "--singleThreaded"], {
        encoding: "utf8",
        maxBuffer: 1 << 26,
      });
      const m: Record<string, number> = {};
      for (const [, k, v] of r.stdout.matchAll(/^([A-Za-z ]+):\s+([\d.]+)/gm))
        m[k!.trim()] = Number(v);
      samples.push(m);
      const first = r.stdout.split("\n").find((l) => l.includes("error TS"));
      if (first) errors = first.replace(/^.*error /, "").slice(0, 120);
    }
    const checks = samples.map((s) => s["Check time"]!).sort((a, b) => a - b);
    const s = samples[0]!;
    console.log(
      `| ${style} | ${checks[Math.floor(checks.length / 2)]!.toFixed(2)} | ${s["Instantiations"]} | ${s["Types"]} | ${Math.round(s["Memory used"]! / 1024)} | ${errors || "none"} |`,
    );
  }
}
