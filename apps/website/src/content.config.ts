import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { type ApiEntry, apiReferenceLoader } from "./api/loader.ts";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        // Set by the API reference pages, so `PageTitle.astro` titles them the
        // way Effect's API reference does.
        api: z
          .object({
            breadcrumbs: z.array(z.object({ label: z.string(), href: z.string().optional() })),
            stability: z.string().optional(),
          })
          .optional(),
      }),
    }),
  }),
  // The loader builds every entry itself, so the schema only carries its type.
  api: defineCollection({ loader: apiReferenceLoader(), schema: z.custom<ApiEntry>() }),
};
