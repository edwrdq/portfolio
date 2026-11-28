import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { artUrl, getNow } from "@edwrdq/now";

export const prerender = false;

// serves the *current* track's album art (or ?k=activity: the current game/activity icon),
// same-origin, so the strip's canvas can pixelate it. not a proxy: it takes no url,
// and only fetches from known art hosts.
export const GET: APIRoute = async ({ locals, url }) => {
  // getNow, not a raw kv read: kv reads are edge-cached ~60s, so right after a track
  // change a raw read can still say "nothing playing"
  const now = await getNow(env, locals.cfContext);
  const art = await artUrl(url.searchParams.get("k") === "activity" ? now?.status?.art : now?.music?.art);
  if (!art) return new Response(null, { status: 404 });

  const upstream = await fetch(small(art), { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit).catch(() => null);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream?.ok || !type.startsWith("image/")) {
    console.error("now art upstream", upstream?.status, type, new URL(art).hostname);
    return new Response(null, { status: 404 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": type,
      // url carries ?v=<hash of art url>, so a long cache is safe
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
};

// the strip only needs ~24px — ask the art hosts for a small rendition
function small(url: string) {
  return url
    .replace(/\/\d+x\d+(bb|cc|sr)?\.(jpg|jpeg|png|webp)$/i, "/64x64bb.jpg") // apple mzstatic
    .replace(/\/image\/ab67616d0000b273/, "/image/ab67616d00004851"); // spotify 640 → 64
}
