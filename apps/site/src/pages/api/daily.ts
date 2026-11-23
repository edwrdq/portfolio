// "x% solved today" counter for the daily puzzles. anonymous: just per-game, per-day totals.
// rate limited per connection with cloudflare's rate-limit binding (counted in memory, nothing stored).
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { dayKey, isDay, isGame } from "@edwrdq/daily";

export const prerender = false;

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...extra } });

type Limiter = { limit(o: { key: string }): Promise<{ success: boolean }> };

export const GET: APIRoute = async ({ url }) => {
  const game = url.searchParams.get("game");
  const date = url.searchParams.get("date");
  if (!isGame(game) || !isDay(date)) return json({ error: "bad request" }, 400);
  const row = await env.DB.prepare("SELECT plays, solves FROM daily_stats WHERE game = ? AND date = ?").bind(game, date).first<{ plays: number; solves: number }>();
  return json({ plays: row?.plays ?? 0, solves: row?.solves ?? 0 }, 200, { "cache-control": "public, max-age=60" });
};

export const POST: APIRoute = async ({ request }) => {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "json only" }, 415);
  const limiter = (env as unknown as { DAILY_LIMIT?: Limiter }).DAILY_LIMIT;
  if (limiter) {
    const { success } = await limiter.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" });
    if (!success) return json({ error: "slow down" }, 429);
  }
  const b = (await request.json().catch(() => null)) as { game?: unknown; date?: unknown; event?: unknown } | null;
  // only today's puzzle counts — archive plays and made-up dates are ignored
  if (!b || !isGame(b.game) || b.date !== dayKey() || (b.event !== "play" && b.event !== "solve")) return json({ error: "bad request" }, 400);
  const col = b.event === "play" ? "plays" : "solves";
  await env.DB.prepare(`INSERT INTO daily_stats (game, date, ${col}) VALUES (?, ?, 1) ON CONFLICT (game, date) DO UPDATE SET ${col} = ${col} + 1`)
    .bind(b.game, b.date)
    .run();
  return json({ ok: true });
};
