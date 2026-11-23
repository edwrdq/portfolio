import { env } from "cloudflare:workers";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";
import { validRows } from "./grid";

type In = { id?: number; name?: string; rows?: unknown; overwrite?: boolean };
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const POST: ToolApi["POST"] = async ({ request }, path) => {
  const b = (await body<In>(request)) ?? {};
  switch (path[0]) {
    case "save": {
      const name = String(b.name ?? "").trim().toLowerCase();
      if (!NAME.test(name)) return fail("name: a–z, 0–9, - and _, up to 40");
      if (!validRows(b.rows)) return fail("bad grid");
      const grid = b.rows.join("\n");
      const existing = await env.DB.prepare("SELECT id FROM pixel_icons WHERE name = ?").bind(name).first<{ id: number }>();
      if (existing && !b.overwrite) return json({ ok: false, exists: true, error: `"${name}" exists` }, 409);
      if (existing) await env.DB.prepare("UPDATE pixel_icons SET grid = ?, updated_at = unixepoch() WHERE id = ?").bind(grid, existing.id).run();
      else await env.DB.prepare("INSERT INTO pixel_icons (name, grid) VALUES (?, ?)").bind(name, grid).run();
      return json({ ok: true, icon: await env.DB.prepare("SELECT * FROM pixel_icons WHERE name = ?").bind(name).first() });
    }
    case "duplicate": {
      if (!Number.isInteger(b.id)) return fail("bad id");
      const src = await env.DB.prepare("SELECT * FROM pixel_icons WHERE id = ?").bind(b.id).first<{ name: string; grid: string }>();
      if (!src) return fail("not found", 404);
      let name = `${src.name}-copy`.slice(0, 40);
      for (let i = 2; await env.DB.prepare("SELECT 1 FROM pixel_icons WHERE name = ?").bind(name).first(); i++) name = `${src.name}-copy${i}`.slice(0, 40);
      await env.DB.prepare("INSERT INTO pixel_icons (name, grid) VALUES (?, ?)").bind(name, src.grid).run();
      return json({ ok: true, icon: await env.DB.prepare("SELECT * FROM pixel_icons WHERE name = ?").bind(name).first() });
    }
    case "delete": {
      if (!Number.isInteger(b.id)) return fail("bad id");
      await env.DB.prepare("DELETE FROM pixel_icons WHERE id = ?").bind(b.id).run();
      return json({ ok: true });
    }
    default:
      return fail("not found", 404);
  }
};
