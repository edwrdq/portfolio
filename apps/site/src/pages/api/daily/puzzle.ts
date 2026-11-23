// the curated puzzle for a game on a date, if one is approved + scheduled. generated games ask
// here first (an override wins), then fall back to their seed. never serves future dates.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { LAUNCH, dayKey, isDay, isGame } from "@edwrdq/daily";
import { diagnoseFromRow, estimateFromRow, overrideFromRow, type Served } from "@edwrdq/daily/curated";

export const prerender = false;

const json = (data: unknown, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });

export const GET: APIRoute = async ({ url }) => {
  const game = url.searchParams.get("game");
  const date = url.searchParams.get("date");
  const today = dayKey();
  if (!isGame(game) || !isDay(date) || date < LAUNCH || date > today) return json({ error: "bad request" }, 400);
  // today's can still be approved/changed in admin, so keep it short; past days are settled
  const maxAge = date === today ? 120 : 3600;
  let served: Served | null = null;

  if (game === "diagnose") {
    const r = await env.DB.prepare("SELECT * FROM diagnose_cases WHERE scheduled_for = ? AND status = 'approved'").bind(date).first();
    if (r) {
      const { flags, status, author, scheduled_for, ...data } = diagnoseFromRow(r);
      served = { kind: "diagnose", data };
    }
  } else if (game === "estimate") {
    const r = await env.DB.prepare("SELECT * FROM estimate_questions WHERE scheduled_for = ? AND status = 'approved'").bind(date).first();
    if (r) {
      const { flags, status, author, scheduled_for, ...data } = estimateFromRow(r);
      served = { kind: "estimate", data };
    }
  } else {
    const r = await env.DB.prepare("SELECT * FROM daily_overrides WHERE game = ? AND scheduled_for = ? AND status = 'approved'").bind(game, date).first();
    if (r) {
      const o = overrideFromRow(r);
      served = { kind: o.kind, data: o.data } as Served;
    }
  }
  return json({ puzzle: served }, 200, maxAge);
};
