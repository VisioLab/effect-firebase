import starlight from "@astrojs/starlight";
import catppuccin from "@catppuccin/starlight";
import { defineConfig } from "astro/config";
import { packages, publicModules } from "./src/api/packages.ts";

type SidebarLink = { label: string; link: string };

/**
 * The sidebar entries for a package's modules: top-level modules as links,
 * and the modules in a directory such as `firestore/` gathered into a group
 * named after it.
 */
const moduleItems = (dir: string) => {
  const groups = new Map<string, Array<SidebarLink>>();
  const items: Array<SidebarLink | { label: string; items: Array<SidebarLink> }> = [];
  for (const module of publicModules(dir)) {
    const item = { label: module.split("/").at(-1)!, link: `/api/${dir}/${module}/` };
    const slash = module.lastIndexOf("/");
    if (slash === -1) {
      items.push(item);
      continue;
    }
    const directory = module.slice(0, slash);
    let group = groups.get(directory);
    if (group === undefined) {
      group = [];
      groups.set(directory, group);
      items.push({ label: directory[0]!.toUpperCase() + directory.slice(1), items: group });
    }
    group.push(item);
  }
  return items;
};

export default defineConfig({
  integrations: [
    starlight({
      title: "Effect Firebase",
      customCss: ["./src/styles/api.css"],
      components: { PageTitle: "./src/components/PageTitle.astro" },
      plugins: [catppuccin()],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/VisioLab/effect-firebase",
        },
      ],
      sidebar: [
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        {
          label: "API reference",
          items: packages.map(({ dir, name }) => ({
            label: name,
            collapsed: true,
            items: [{ label: "Overview", link: `/api/${dir}/` }, ...moduleItems(dir)],
          })),
        },
      ],
    }),
  ],
});
