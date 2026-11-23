// admin → daily. curated banks (diagnose, estimate), hand-made overrides (asm, logic, …),
// schedules, approvals, and the numbers. nothing reaches the public site unless approved.
import { env } from "cloudflare:workers";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";
import { GAMES, addDays, dayKey, isDay, isGame } from "@edwrdq/daily";
import { checkDiagnose, checkEstimate, checkOverride, diagnoseFromRow, diagnoseToRow, estimateFromRow, overrideFromRow } from "@edwrdq/daily/curated";

type Type = "diagnose" | "estimate" | "override";
const TABLE: Record<Type, string> = { diagnose: "diagnose_cases", estimate: "estimate_questions", override: "daily_overrides" };
const isType = (t: unknown): t is Type => t === "diagnose" || t === "estimate" || t === "override";
/** curated games and how many days ahead they should be filled */
export const WARN_DAYS = 14;

/** consecutive approved+scheduled days starting today */
async function coverage(type: "diagnose" | "estimate", today: string) {
  const { results } = await env.DB.prepare(`SELECT scheduled_for d FROM ${TABLE[type]} WHERE status = 'approved' AND scheduled_for >= ? ORDER BY scheduled_for`).bind(today).all<{ d: string }>();
  const have = new Set(results.map((r) => r.d));
  let n = 0;
  while (have.has(addDays(today, n))) n++;
  return n;
}

export const GET: ToolApi["GET"] = async ({ url }, path) => {
  const today = dayKey();
  switch (path[0]) {
    case "overview": {
      const since = addDays(today, -6);
      const { results: st } = await env.DB.prepare("SELECT game, date, plays, solves FROM daily_stats WHERE date >= ? ORDER BY date").bind(since).all<{ game: string; date: string; plays: number; solves: number }>();
      const games = [];
      for (const g of GAMES) {
        const rows = st.filter((r) => r.game === g.id);
        const t = rows.find((r) => r.date === today);
        const plays7 = rows.reduce((a, r) => a + r.plays, 0);
        const solves7 = rows.reduce((a, r) => a + r.solves, 0);
        const out: Record<string, unknown> = { id: g.id, kind: g.kind, today: { plays: t?.plays ?? 0, solves: t?.solves ?? 0 }, week: { plays: plays7, solves: solves7 } };
        if (g.id === "diagnose" || g.id === "estimate") {
          const c = await env.DB.prepare(
            `SELECT sum(status = 'unverified') unverified, sum(status = 'approved' AND scheduled_for IS NULL) queued, sum(status = 'approved' AND scheduled_for >= ?1) upcoming FROM ${TABLE[g.id]}`,
          )
            .bind(today)
            .first<{ unverified: number; queued: number; upcoming: number }>();
          out.days = await coverage(g.id, today);
          out.unverified = c?.unverified ?? 0;
          out.queued = c?.queued ?? 0;
          out.warn = (out.days as number) < WARN_DAYS;
        } else {
          const c = await env.DB.prepare("SELECT sum(status = 'unverified') unverified, sum(status = 'approved' AND scheduled_for >= ?2) upcoming FROM daily_overrides WHERE game = ?1")
            .bind(g.id, today)
            .first<{ unverified: number; upcoming: number }>();
          out.unverified = c?.unverified ?? 0;
          out.upcoming = c?.upcoming ?? 0;
        }
        games.push(out);
      }
      return json({ ok: true, today, games });
    }
    case "calendar": {
      const from = isDay(url.searchParams.get("from")) ? url.searchParams.get("from")! : today;
      const days = Math.min(60, Math.max(1, Number(url.searchParams.get("days")) || 21));
      const to = addDays(from, days - 1);
      const q = (sql: string) => env.DB.prepare(sql).bind(from, to).all<Record<string, unknown>>();
      const [d, e, o] = await Promise.all([
        q("SELECT id, scheduled_for d, status FROM diagnose_cases WHERE scheduled_for BETWEEN ? AND ?"),
        q("SELECT id, scheduled_for d, status FROM estimate_questions WHERE scheduled_for BETWEEN ? AND ?"),
        q("SELECT id, scheduled_for d, status, game, kind FROM daily_overrides WHERE scheduled_for BETWEEN ? AND ?"),
      ]);
      const cal = Array.from({ length: days }, (_, i) => {
        const date = addDays(from, i);
        const cell: Record<string, { src: string; id?: number; status?: string }> = {};
        for (const g of GAMES) {
          const ov = o.results.find((r) => r.d === date && r.game === g.id);
          const cur = g.id === "diagnose" ? d.results.find((r) => r.d === date) : g.id === "estimate" ? e.results.find((r) => r.d === date) : null;
          if (ov) cell[g.id] = { src: `override:${ov.kind}`, id: ov.id as number, status: ov.status as string };
          else if (cur) cell[g.id] = { src: "entry", id: cur.id as number, status: cur.status as string };
          else cell[g.id] = { src: g.kind === "curated" ? "missing" : "generated" };
        }
        return { date, games: cell };
      });
      return json({ ok: true, calendar: cal });
    }
    case "entries": {
      const type = url.searchParams.get("type");
      if (!isType(type)) return fail("bad type");
      const { results } = await env.DB.prepare(`SELECT * FROM ${TABLE[type]} ORDER BY status = 'approved', scheduled_for IS NULL, scheduled_for, id`).all<Record<string, unknown>>();
      const conv = type === "diagnose" ? diagnoseFromRow : type === "estimate" ? estimateFromRow : overrideFromRow;
      return json({ ok: true, entries: results.map((r) => conv(r)) });
    }
    case "scheduled": {
      const game = url.searchParams.get("game");
      const date = url.searchParams.get("date");
      if (!isGame(game) || !isDay(date)) return fail("bad request");
      const ov = await env.DB.prepare("SELECT * FROM daily_overrides WHERE game = ? AND scheduled_for = ?").bind(game, date).first();
      if (ov) return json({ ok: true, type: "override", entry: overrideFromRow(ov) });
      if (game === "diagnose" || game === "estimate") {
        const r = await env.DB.prepare(`SELECT * FROM ${TABLE[game]} WHERE scheduled_for = ?`).bind(date).first();
        if (r) return json({ ok: true, type: game, entry: game === "diagnose" ? diagnoseFromRow(r) : estimateFromRow(r) });
      }
      return json({ ok: true, type: null, entry: null });
    }
  }
  return fail("not found", 404);
};

type In = { type?: unknown; id?: number; data?: Record<string, unknown>; status?: string; date?: string | null; days?: number };

export const POST: ToolApi["POST"] = async ({ request }, path) => {
  const b = (await body<In>(request)) ?? {};
  if (!isType(b.type)) return fail("bad type");
  const type = b.type;
  const table = TABLE[type];
  const id = Number.isInteger(b.id) ? b.id! : null;
  try {
    switch (path[0]) {
      case "save": {
        const d = b.data ?? {};
        let cols: Record<string, unknown>;
        if (type === "diagnose") {
          const errs = checkDiagnose(d);
          if (errs.length) return fail(errs.join("; "));
          cols = diagnoseToRow(d as never);
        } else if (type === "estimate") {
          const errs = checkEstimate(d);
          if (errs.length) return fail(errs.join("; "));
          cols = { question: String(d.question).trim(), answer: d.answer, unit: String(d.unit ?? "").trim(), reasoning: String(d.reasoning).trim(), source_url: String(d.source_url).trim(), flags: JSON.stringify(d.flags ?? []) };
        } else {
          const game = String(d.game ?? ""), kind = String(d.kind ?? "");
          if (!isGame(game)) return fail("override needs a game");
          const errs = checkOverride(game, kind, d.data);
          if (errs.length) return fail(errs.join("; "));
          cols = { game, kind, data: JSON.stringify(d.data), title: String(d.title ?? "").slice(0, 120) };
        }
        const keys = Object.keys(cols);
        if (id) {
          const r = await env.DB.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = unixepoch() WHERE id = ?`).bind(...Object.values(cols), id).run();
          if (!r.meta.changes) return fail("not found", 404);
          return json({ ok: true, id });
        }
        // made in admin = written by eddy, so it's approved from the start (only agent-written rows need review)
        const row = await env.DB.prepare(`INSERT INTO ${table} (${keys.join(", ")}, author, status) VALUES (${keys.map(() => "?").join(", ")}, 'eddy', 'approved') RETURNING id`)
          .bind(...Object.values(cols))
          .first<{ id: number }>();
        return json({ ok: true, id: row!.id });
      }
      case "status": {
        if (!id || (b.status !== "approved" && b.status !== "unverified")) return fail("bad request");
        await env.DB.prepare(`UPDATE ${table} SET status = ?, updated_at = unixepoch() WHERE id = ?`).bind(b.status, id).run();
        return json({ ok: true });
      }
      case "schedule": {
        if (!id) return fail("bad id");
        if (b.date !== null && !isDay(b.date)) return fail("bad date");
        await env.DB.prepare(`UPDATE ${table} SET scheduled_for = ?, updated_at = unixepoch() WHERE id = ?`).bind(b.date, id).run();
        return json({ ok: true });
      }
      case "autofill": {
        // fill the next empty days with approved, unscheduled entries (oldest first)
        if (type === "override") return fail("overrides are scheduled by hand");
        const days = Math.min(120, Math.max(1, b.days ?? 30));
        const today = dayKey();
        const { results: taken } = await env.DB.prepare(`SELECT scheduled_for d FROM ${table} WHERE scheduled_for >= ?`).bind(today).all<{ d: string }>();
        const used = new Set(taken.map((r) => r.d));
        const { results: pool } = await env.DB.prepare(`SELECT id FROM ${table} WHERE status = 'approved' AND scheduled_for IS NULL ORDER BY id`).all<{ id: number }>();
        const stmts = [];
        let i = 0;
        for (let k = 0; k < days && i < pool.length; k++) {
          const d = addDays(today, k);
          if (used.has(d)) continue;
          stmts.push(env.DB.prepare(`UPDATE ${table} SET scheduled_for = ?, updated_at = unixepoch() WHERE id = ?`).bind(d, pool[i++].id));
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true, scheduled: stmts.length });
      }
      case "delete": {
        if (!id) return fail("bad id");
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
        return json({ ok: true });
      }
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("UNIQUE")) return fail("something's already scheduled on that date.", 409);
    throw e;
  }
  return fail("not found", 404);
};
