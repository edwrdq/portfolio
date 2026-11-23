import { env } from "cloudflare:workers";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";
import { guessLang, LANGS, looksSecret, type Entry } from "./shared";

type In = Partial<Pick<Entry, "id" | "title" | "body" | "lang" | "note">> & {
  tags?: string | string[];
  pinned?: boolean;
  force?: boolean;
  entries?: In[];
};

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").slice(0, n) : "");
const normTags = (v: unknown) =>
  [...new Set((Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/)).map((t) => String(t).replace(/^#/, "").trim().toLowerCase()).filter((t) => /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u.test(t)))].join(",");

function clean(b: In) {
  const text = clip(b.body, 20000).replace(/^\n+|\s+$/g, "");
  if (!text.trim()) throw "paste something first";
  const title = clip(b.title, 200).trim() || text.split("\n").find((l) => l.trim())!.trim().slice(0, 200);
  const lang = typeof b.lang === "string" && (LANGS as readonly string[]).includes(b.lang) ? b.lang : guessLang(text);
  const note = clip(b.note, 2000).trim() || null;
  return { title, body: text, lang, note, tags: normTags(b.tags) };
}

const one = (id: number) => env.DB.prepare("SELECT * FROM vault_entries WHERE id = ?").bind(id).first<Entry>();

export const POST: ToolApi["POST"] = async ({ request }, path) => {
  const b = (await body<In>(request)) ?? {};
  try {
    switch (path[0]) {
      case "create": {
        const e = clean(b);
        const secret = looksSecret(`${e.title}\n${e.body}\n${e.note ?? ""}`);
        if (secret && !b.force) return json({ ok: false, secret, error: `looks like ${secret}` }, 409);
        const row = await env.DB.prepare("INSERT INTO vault_entries (title, body, lang, note, tags) VALUES (?, ?, ?, ?, ?) RETURNING id")
          .bind(e.title, e.body, e.lang, e.note, e.tags)
          .first<{ id: number }>();
        return json({ ok: true, entry: await one(row!.id) });
      }
      case "update": {
        if (!Number.isInteger(b.id)) throw "bad id";
        const e = clean(b);
        const secret = looksSecret(`${e.title}\n${e.body}\n${e.note ?? ""}`);
        if (secret && !b.force) return json({ ok: false, secret, error: `looks like ${secret}` }, 409);
        await env.DB.prepare("UPDATE vault_entries SET title = ?, body = ?, lang = ?, note = ?, tags = ?, updated_at = unixepoch() WHERE id = ?")
          .bind(e.title, e.body, e.lang, e.note, e.tags, b.id)
          .run();
        return json({ ok: true, entry: await one(b.id!) });
      }
      case "pin": {
        if (!Number.isInteger(b.id)) throw "bad id";
        await env.DB.prepare("UPDATE vault_entries SET pinned = ? WHERE id = ?").bind(b.pinned ? 1 : 0, b.id).run();
        return json({ ok: true, entry: await one(b.id!) });
      }
      case "use": {
        if (!Number.isInteger(b.id)) throw "bad id";
        await env.DB.prepare("UPDATE vault_entries SET uses = uses + 1, last_used_at = unixepoch() WHERE id = ?").bind(b.id).run();
        return json({ ok: true, entry: await one(b.id!) });
      }
      case "duplicate": {
        if (!Number.isInteger(b.id)) throw "bad id";
        const row = await env.DB.prepare(
          `INSERT INTO vault_entries (title, body, lang, note, tags)
           SELECT substr(title || ' (copy)', 1, 200), body, lang, note, tags FROM vault_entries WHERE id = ? RETURNING id`,
        ).bind(b.id).first<{ id: number }>();
        if (!row) return fail("not found", 404);
        return json({ ok: true, entry: await one(row.id) });
      }
      case "delete": {
        if (!Number.isInteger(b.id)) throw "bad id";
        await env.DB.prepare("DELETE FROM vault_entries WHERE id = ?").bind(b.id).run();
        return json({ ok: true });
      }
      case "import": {
        const list = Array.isArray(b.entries) ? b.entries.slice(0, 500) : [];
        if (!list.length) throw "nothing to import";
        const rows = list.map((x) => {
          try {
            return clean(x);
          } catch {
            return null;
          }
        }).filter((x): x is NonNullable<typeof x> => !!x);
        const flagged = rows.filter((r) => looksSecret(`${r.title}\n${r.body}\n${r.note ?? ""}`)).map((r) => r.title);
        if (flagged.length && !b.force) return json({ ok: false, secret: "secrets", flagged, error: `${flagged.length} look like they contain secrets` }, 409);
        await env.DB.batch(rows.map((r) => env.DB.prepare("INSERT INTO vault_entries (title, body, lang, note, tags) VALUES (?, ?, ?, ?, ?)").bind(r.title, r.body, r.lang, r.note, r.tags)));
        return json({ ok: true, imported: rows.length });
      }
      default:
        return fail("not found", 404);
    }
  } catch (e) {
    if (typeof e === "string") return fail(e);
    throw e;
  }
};
