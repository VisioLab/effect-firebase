/**
 * The packages the API reference documents, and the modules each one makes
 * public.
 *
 * Paths resolve against the working directory, which is the website's own:
 * `astro dev` and `astro build` both run from there.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Package {
  /** The package's directory under `packages/`, and its URL segment. */
  readonly dir: string;
  readonly name: string;
}

export const packages: ReadonlyArray<Package> = [
  { dir: "effect-firebase", name: "@visiolab/effect-firebase" },
  { dir: "admin", name: "@visiolab/effect-firebase-admin" },
  { dir: "client", name: "@visiolab/effect-firebase-client" },
];

export const packageRoot = (dir: string): string => resolve("../../packages", dir);

interface Manifest {
  readonly version: string;
  readonly exports: Record<string, string>;
}

const manifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(resolve(packageRoot(dir), "package.json"), "utf8")) as Manifest;

/**
 * The package's version as last released. Changesets bumps it only in the
 * release's version PR, so on `main` it is the version on the registry.
 */
export const packageVersion = (dir: string): string => manifest(dir).version;

/**
 * The package's public modules, as its `exports` name them (`firestore/Collection`),
 * leaving out the barrels, which only re-export the modules.
 */
export const publicModules = (dir: string): ReadonlyArray<string> => {
  return Object.entries(manifest(dir).exports)
    .filter(([, source]) => source.endsWith(".ts") && !source.endsWith("/index.ts"))
    .map(([subpath]) => subpath.slice("./".length));
};
