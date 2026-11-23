// tool registry. a tool = a folder in src/tools/<slug>/ with:
//   meta.ts     default export ToolMeta
//   index.astro the tool's page (rendered at /<slug>)
//   api.ts      optional. export GET/POST/... (ToolHandler), served at /api/<slug>/<...path>
import type { APIContext } from "astro";
import type { IconName } from "@edwrdq/ui/icons";

export type ToolMeta = {
  name: string;
  description: string;
  icon: IconName;
  order: number;
};

export type ToolHandler = (ctx: APIContext, path: string[]) => Response | Promise<Response>;
export type ToolApi = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", ToolHandler>>;

const metas = import.meta.glob<{ default: ToolMeta }>("../tools/*/meta.ts", { eager: true });
export const pages = import.meta.glob<{ default: any }>("../tools/*/index.astro");
export const apis = import.meta.glob<ToolApi>("../tools/*/api.ts");

const slugOf = (path: string) => path.split("/").at(-2)!;

export const tools = Object.entries(metas)
  .map(([path, mod]) => ({ slug: slugOf(path), ...mod.default }))
  .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

export const getTool = (slug: string) => tools.find((t) => t.slug === slug);
