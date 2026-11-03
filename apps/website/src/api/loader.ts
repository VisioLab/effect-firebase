/**
 * The content loader behind the `api` collection: an entry per package and
 * one per module, read from the packages' declarations.
 *
 * In `astro dev` it watches the packages' sources and READMEs, and reads the
 * reference again when one changes, so an edited JSDoc shows up on the page
 * without restarting the server.
 */
import type { Loader } from "astro/loaders";
import { resolve, sep } from "node:path";
import { packageRoot, packages } from "./packages.ts";
import { type Module, type PackageReference, type Rich, readApiReference } from "./reference.ts";

export interface PackageInfo {
  readonly dir: string;
  readonly name: string;
}

export type ApiEntry =
  | {
      readonly kind: "package";
      readonly package: PackageInfo;
      readonly readme: Rich;
      readonly modules: ReadonlyArray<string>;
    }
  | { readonly kind: "module"; readonly package: PackageInfo; readonly module: Module };

const toEntries = (reference: ReadonlyArray<PackageReference>): Array<[string, ApiEntry]> =>
  reference.flatMap(({ dir, name, readme, modules }) => {
    const info = { dir, name };
    return [
      [dir, { kind: "package", package: info, readme, modules: modules.map(({ path }) => path) }],
      ...modules.map((module): [string, ApiEntry] => [
        `${dir}/${module.path}`,
        { kind: "module", package: info, module },
      ]),
    ];
  });

export const apiReferenceLoader = (): Loader => ({
  name: "api-reference",
  load: async (context) => {
    const { store, logger, watcher } = context;
    const sync = async () => {
      const started = performance.now();
      const entries = toEntries(await readApiReference());
      const ids = new Set(entries.map(([id]) => id));
      for (const [id, entry] of entries) {
        const data = entry as unknown as Record<string, unknown>;
        // An unchanged digest leaves the entry, and the page built from it, alone.
        store.set({ id, data, digest: context.generateDigest(data) });
      }
      for (const id of store.keys()) if (!ids.has(id)) store.delete(id);
      logger.info(`Read the API reference in ${Math.round(performance.now() - started)}ms`);
    };

    await sync();
    if (watcher === undefined) return;

    const roots = packages.map(({ dir }) => packageRoot(dir));
    watcher.add(roots.flatMap((root) => [resolve(root, "src"), resolve(root, "README.md")]));
    // Saving several files at once triggers one read, and a read never
    // overlaps the one before it.
    let pending: ReturnType<typeof setTimeout> | undefined;
    let running = Promise.resolve();
    const onChange = (file: string) => {
      if (!roots.some((root) => file.startsWith(root + sep))) return;
      clearTimeout(pending);
      pending = setTimeout(() => {
        running = running
          .then(sync)
          .catch((error: unknown) =>
            logger.error(`Could not read the API reference: ${String(error)}`),
          );
      }, 200);
    };
    for (const event of ["add", "change", "unlink"] as const) watcher.on(event, onChange);
  },
});
