import { defineCollection } from "astro:content";
import { file, glob } from "astro/loaders";
import { z } from "astro/zod";
import { parse } from "yaml";
import { iconNames } from "@edwrdq/ui/icons";

// the homepage index. order in index.yml = order on the page (001, 002, ...).
// every entry except blog also gets a /[id] section page.
const index = defineCollection({
  // the store doesn't keep file order, so stamp each entry with its position
  loader: file("src/content/index.yml", {
    parser: (text) => (parse(text) as Record<string, unknown>[]).map((e, i) => ({ ...e, order: i })),
  }),
  schema: z.object({
    title: z.string(),
    desc: z.string(),
    intro: z.string().optional(),
    /** optional note block above the entries: dim text with a small image beside it */
    note: z
      .object({
        text: z.string(),
        image: z.string().startsWith("/img/"),
        alt: z.string(),
        caption: z.string().optional(),
        captionLink: z.object({ label: z.string(), href: z.string().url() }).optional(),
      })
      .optional(),
    /** "rows": entries render as numbered index rows (icon + one line) instead of full entries */
    layout: z.enum(["rows"]).optional(),
    /** optional closing line at the bottom of the section page */
    outro: z.string().optional(),
    /** optional sub-sections on the section page; entries pick one with `group:` */
    groups: z.array(z.object({ id: z.string(), title: z.string(), intro: z.string().optional() })).optional(),
    icon: z.enum(iconNames as [string, ...string[]]),
    href: z.string(),
    status: z.enum(["planned"]).optional(),
    order: z.number(),
  }),
});

// project dates can be rough: 2026, 2026-03, 2026-03-idk, 2026-03-?? → start of that month/year.
// (yaml turns a full 2026-03-12 into a Date already.)
const roughDate = z.preprocess((v) => {
  if (v instanceof Date) return v;
  const m = String(v ?? "").trim().match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return v;
  return new Date(Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1));
}, z.date());

// src/content/projects/<section>/<entry>.md
const projects = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    section: z.string(),
    /** sub-section id, when the section has groups */
    group: z.string().optional(),
    date: roughDate,
    /** optional end date, used by the work timeline */
    end: roughDate.optional(),
    /** work timeline: where (shown under the role) */
    org: z.string().optional(),
    /** replaces the shown date text, e.g. "????—now" or "always". "" hides it. date still sorts. */
    when: z.string().optional(),
    summary: z.string(),
    /** optional — leave it off for things that aren't projects (e.g. music taste) */
    status: z.enum(["active", "shipped", "planned", "archived", "concept"]).optional(),
    links: z.array(z.object({ label: z.string(), href: z.string().url() })).optional(),
    /** dithered image in public/img, e.g. "/img/civic.png" */
    image: z.string().startsWith("/img/").optional(),
    imageAlt: z.string().optional(),
    /** pixel icon, used when the section has layout: rows */
    /** where a rows-layout entry links to (e.g. a tool page) */
    href: z.string().optional(),
    icon: z.enum(iconNames as [string, ...string[]]).optional(),
    /** name of a file in src/demos (without .astro) */
    demo: z.string().optional(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { index, projects, blog };
