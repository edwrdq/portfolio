// saving an item + the background fetch. used by the api and the /share page.
import { env } from "cloudflare:workers";
import { extract } from "../../lib/extract";
import { classify, type Device, type Item } from "./shared";

export async function saveItem(input: string, from: Device, hintTitle: string | null, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Item> {
  const c = classify(input.slice(0, 20000));
  let row: { id: number } | null;
  if ("url" in c) {
    let url: string;
    try {
      const u = new URL(c.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw 0;
      url = u.toString().slice(0, 2000);
    } catch {
      throw "that link doesn't parse";
    }
    const title = hintTitle?.replace(/\s+/g, " ").trim().slice(0, 300) || null;
    row = await env.DB.prepare("INSERT INTO later_items (url, title, site, sent_from) VALUES (?, ?, ?, ?) RETURNING id")
      .bind(url, title, new URL(url).hostname.replace(/^www\./, ""), from)
      .first<{ id: number }>();
    const id = row!.id;
    const job = enrich(id, url).catch((e) => console.error("later fetch", url, e?.message ?? e));
    if (ctx) ctx.waitUntil(job);
    else await job;
  } else {
    const note = c.note;
    if (!note) throw "nothing to save";
    const title = note.split("\n").find((l) => l.trim())!.trim().slice(0, 120);
    row = await env.DB.prepare("INSERT INTO later_items (title, note, sent_from) VALUES (?, ?, ?) RETURNING id").bind(title, note, from).first<{ id: number }>();
  }
  return (await getItem(row!.id))!;
}

export const getItem = (id: number) =>
  env.DB.prepare(
    "SELECT i.*, (SELECT count(*) FROM later_archive a WHERE a.item_id = i.id) AS has_text FROM later_items i WHERE i.id = ?",
  ).bind(id).first<Item>();

/** fetch the page and fill in what we can. failures just leave the url. */
async function enrich(id: number, url: string) {
  const x = await extract(url);
  await env.DB.batch([
    env.DB.prepare("UPDATE later_items SET title = coalesce(title, ?), site = coalesce(?, site), excerpt = ? WHERE id = ?").bind(x.title, x.site, x.excerpt, id),
    ...(x.text.length > 80
      ? [env.DB.prepare("INSERT OR REPLACE INTO later_archive (item_id, text) VALUES (?, ?)").bind(id, x.text)]
      : []),
  ]);
}
