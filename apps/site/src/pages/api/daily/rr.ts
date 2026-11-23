// today's (or an archive day's) real-or-random rounds: one precomputed kv value per day,
// built by scripts/real-or-random.mjs. never serves future days.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { LAUNCH, dayKey, isDay } from "@edwrdq/daily";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const date = url.searchParams.get("date");
  const today = dayKey();
  if (!isDay(date) || date < LAUNCH || date > today) return new Response(JSON.stringify({ error: "bad request" }), { status: 400, headers: { "content-type": "application/json" } });
  const v = await env.STATS.get(`rr:${date}`);
  return new Response(v ?? JSON.stringify({ rounds: null }), {
    headers: { "content-type": "application/json", "cache-control": v ? "public, max-age=86400" : "public, max-age=60" },
  });
};
