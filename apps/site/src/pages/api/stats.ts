import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getStats } from "@edwrdq/stats";

export const prerender = false;

// cached json. stale → served anyway, refreshed in the background.
export const GET: APIRoute = async ({ locals }) => {
  const { data, ageMs, stale, refreshing } = await getStats(env, locals.cfContext);
  return new Response(JSON.stringify({ ...data, ageMs, stale, refreshing }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
};
