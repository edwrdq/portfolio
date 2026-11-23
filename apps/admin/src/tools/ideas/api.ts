import { env } from "cloudflare:workers";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";
import { extractTags, STATUSES, type Idea } from "./shared";

type In = { id?: number; body?: string; status?: string; pinned?: boolean };

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "");
const SELECT = `SELECT i.*, (SELECT count(*) FROM idea_notes n WHERE n.idea_id = i.id) AS notes FROM ideas i`;

const one = (id: number) => env.DB.prepare(`${SELECT} WHERE i.id = ?`).bind(id).first<Idea>();

export const GET: ToolApi["GET"] = async (_ctx, path) => {
  if (path[0] === "notes" && /^\d+$/.test(path[1] ?? "")) {
    const { results } = await env.DB.prepare("SELECT id, body, created_at FROM idea_notes WHERE idea_id = ? ORDER BY created_at, id")
      .bind(Number(path[1]))
      .all();
    return json({ ok: true, notes: results });
  }
  return fail("not found", 404);
};

export const POST: ToolApi["POST"] = async ({ request }, path) => {
  const b = (await body<In>(request)) ?? {};
  switch (path[0]) {
    case "create": {
      const text = clean(b.body);
      if (!text) return fail("empty");
      if (text.length > 5000) return fail("too long (5000 max)");
      const row = await env.DB.prepare("INSERT INTO ideas (body, tags) VALUES (?, ?) RETURNING id")
        .bind(text, extractTags(text).join(","))
        .first<{ id: number }>();
      return json({ ok: true, idea: await one(row!.id) });
    }
    case "update": {
      if (!Number.isInteger(b.id)) return fail("bad id");
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (b.body !== undefined) {
        const text = clean(b.body);
        if (!text) return fail("empty");
        if (text.length > 5000) return fail("too long (5000 max)");
        sets.push("body = ?", "tags = ?");
        vals.push(text, extractTags(text).join(","));
      }
      if (b.status !== undefined) {
        if (!(STATUSES as readonly string[]).includes(b.status)) return fail("bad status");
        sets.push("status = ?");
        vals.push(b.status);
      }
      if (b.pinned !== undefined) {
        sets.push("pinned = ?");
        vals.push(b.pinned ? 1 : 0);
      }
      if (!sets.length) return fail("nothing to change");
      const r = await env.DB.prepare(`UPDATE ideas SET ${sets.join(", ")}, updated_at = unixepoch() WHERE id = ?`).bind(...vals, b.id).run();
      if (!r.meta.changes) return fail("not found", 404);
      return json({ ok: true, idea: await one(b.id!) });
    }
    case "delete": {
      if (!Number.isInteger(b.id)) return fail("bad id");
      await env.DB.batch([
        env.DB.prepare("DELETE FROM idea_notes WHERE idea_id = ?").bind(b.id),
        env.DB.prepare("DELETE FROM ideas WHERE id = ?").bind(b.id),
      ]);
      return json({ ok: true });
    }
    case "note": {
      if (!Number.isInteger(b.id)) return fail("bad id");
      const text = clean(b.body);
      if (!text) return fail("empty");
      if (text.length > 5000) return fail("too long (5000 max)");
      const exists = await env.DB.prepare("SELECT 1 FROM ideas WHERE id = ?").bind(b.id).first();
      if (!exists) return fail("not found", 404);
      const note = await env.DB.prepare("INSERT INTO idea_notes (idea_id, body) VALUES (?, ?) RETURNING id, body, created_at")
        .bind(b.id, text)
        .first();
      await env.DB.prepare("UPDATE ideas SET updated_at = unixepoch() WHERE id = ?").bind(b.id).run();
      return json({ ok: true, note, idea: await one(b.id!) });
    }
    case "note-delete": {
      if (!Number.isInteger(b.id)) return fail("bad id");
      await env.DB.prepare("DELETE FROM idea_notes WHERE id = ?").bind(b.id).run();
      return json({ ok: true });
    }
    default:
      return fail("not found", 404);
  }
};
