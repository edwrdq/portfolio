import { env } from "cloudflare:workers";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";
import { deviceFromUA, type Device } from "./shared";
import { getItem, saveItem } from "./save";

type In = { id?: number; input?: string; from?: Device; status?: string; tags?: string };

export const GET: ToolApi["GET"] = async ({ url }, path) => {
  if (path[0] === "text" && /^\d+$/.test(path[1] ?? "")) {
    const row = await env.DB.prepare("SELECT text, fetched_at FROM later_archive WHERE item_id = ?").bind(Number(path[1])).first();
    return row ? json({ ok: true, ...row }) : fail("no archived text", 404);
  }
  if (path[0] === "search") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (!q) return json({ ok: true, ids: [] });
    const like = `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    const { results } = await env.DB.prepare(
      `SELECT i.id FROM later_items i LEFT JOIN later_archive a ON a.item_id = i.id
       WHERE i.title LIKE ?1 ESCAPE '\\' OR i.url LIKE ?1 ESCAPE '\\' OR i.excerpt LIKE ?1 ESCAPE '\\'
          OR i.note LIKE ?1 ESCAPE '\\' OR i.tags LIKE ?1 ESCAPE '\\' OR i.site LIKE ?1 ESCAPE '\\' OR a.text LIKE ?1 ESCAPE '\\'
       LIMIT 500`,
    ).bind(like).all<{ id: number }>();
    return json({ ok: true, ids: results.map((r) => r.id) });
  }
  if (path[0] === "item" && /^\d+$/.test(path[1] ?? "")) {
    const item = await getItem(Number(path[1]));
    return item ? json({ ok: true, item }) : fail("not found", 404);
  }
  return fail("not found", 404);
};

export const POST: ToolApi["POST"] = async ({ request, locals }, path) => {
  const b = (await body<In>(request)) ?? {};
  try {
    switch (path[0]) {
      case "save": {
        if (typeof b.input !== "string" || !b.input.trim()) throw "paste a link or some text";
        const from: Device = b.from === "phone" || b.from === "laptop" ? b.from : deviceFromUA(request.headers.get("user-agent"));
        return json({ ok: true, item: await saveItem(b.input, from, null, locals.cfContext) });
      }
      case "status": {
        if (!Number.isInteger(b.id) || !["inbox", "read", "archived"].includes(String(b.status))) throw "bad request";
        await env.DB.prepare(
          "UPDATE later_items SET status = ?, read_at = CASE WHEN ? = 'inbox' THEN NULL ELSE coalesce(read_at, unixepoch()) END WHERE id = ?",
        ).bind(b.status, b.status, b.id).run();
        return json({ ok: true, item: await getItem(b.id!) });
      }
      case "tags": {
        if (!Number.isInteger(b.id)) throw "bad id";
        const tags = [...new Set(String(b.tags ?? "").split(/[,\s]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter((t) => /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u.test(t)))].join(",");
        await env.DB.prepare("UPDATE later_items SET tags = ? WHERE id = ?").bind(tags, b.id).run();
        return json({ ok: true, item: await getItem(b.id!) });
      }
      case "delete": {
        if (!Number.isInteger(b.id)) throw "bad id";
        await env.DB.batch([
          env.DB.prepare("DELETE FROM later_archive WHERE item_id = ?").bind(b.id),
          env.DB.prepare("DELETE FROM later_items WHERE id = ?").bind(b.id),
        ]);
        return json({ ok: true });
      }
      default:
        return fail("not found", 404);
    }
  } catch (e) {
    if (typeof e === "string") return fail(e);
    throw e;
  }
};
