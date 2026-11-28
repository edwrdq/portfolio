import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getNow } from "@edwrdq/now";

export const prerender = false;

const TTL = 30;

// resolved "now" strip. ~30s fresh: edge cache in front, kv behind, sources behind that.
export const GET: APIRoute = async ({ request, locals }) => {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(new URL("/api/now", request.url).toString());
  const hit = await cache.match(key);
  if (hit) {
    // responses out of the cache api pick up the zone's browser-cache ttl (4h by default),
    // which would freeze the strip in browsers. re-wrap with our own header.
    const out = new Response(hit.body, hit);
    out.headers.set("cache-control", `public, max-age=${TTL}`);
    return out;
  }

  const now = await getNow(env, locals.cfContext);
  // public shape: no raw presence, no art url (art goes through /api/now/art)
  const body = {
    status: now.status && {
      ...now.status,
      art: now.status.art ? `/api/now/art?k=activity&v=${await short(now.status.art)}` : null,
    },
    music: now.music && {
      track: now.music.track,
      artist: now.music.artist,
      url: now.music.url,
      source: now.music.source,
      art: now.music.art ? `/api/now/art?v=${await short(now.music.art)}` : null,
    },
    presence: now.presence ?? null,
    custom: now.custom ?? null,
    checkedAt: now.checkedAt,
  };
  const res = new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${TTL}` },
  });
  locals.cfContext?.waitUntil(cache.put(key, res.clone()));
  return res;
};

async function short(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d).slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
