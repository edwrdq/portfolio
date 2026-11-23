// sitemap, built at deploy time. add new public pages to TOOLS.
import type { APIRoute } from "astro";
import { getIndex, getPosts } from "../lib/content";

const TOOLS = ["/dither", "/daily", "/daily/picross", "/daily/archive"];
const HIDDEN = new Set(["/styleguide"]);

export const GET: APIRoute = async ({ site }) => {
  const abs = (p: string) => new URL(p, site).href;
  const urls: { loc: string; lastmod?: string }[] = [{ loc: abs("/") }];
  for (const s of await getIndex()) urls.push({ loc: abs(s.data.href) });
  for (const p of await getPosts()) urls.push({ loc: abs(`/blog/${p.id}`), lastmod: p.data.date.toISOString().slice(0, 10) });
  for (const t of TOOLS) urls.push({ loc: abs(t) });

  const seen = new Set<string>();
  const body = urls
    .filter((u) => !HIDDEN.has(new URL(u.loc).pathname) && !seen.has(u.loc) && seen.add(u.loc))
    .map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`)
    .join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
};
