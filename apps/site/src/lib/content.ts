import { getCollection } from "astro:content";

/** homepage index entries, in file order */
export async function getIndex() {
  return (await getCollection("index")).sort((a, b) => a.data.order - b.data.order);
}

/** published posts, newest first. drafts show in dev only. */
export async function getPosts() {
  const posts = await getCollection("blog", (p) => import.meta.env.DEV || !p.data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

const fmt = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" });
const fmtMonth = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", timeZone: "UTC" });

/** 2026.11.23 */
export function stamp(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}.${p.month}.${p.day}`;
}

/** 2026.11 */
export function stampMonth(d: Date) {
  const p = Object.fromEntries(fmtMonth.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}.${p.month}`;
}

export const pad = (n: number) => String(n).padStart(3, "0");
