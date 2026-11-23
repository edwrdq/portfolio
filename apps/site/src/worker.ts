// site entry: astro renders, then (in the background) we count the page view.
// counted: successful HTML GETs from humans. never counted: assets, /api, short links,
// drop pages, bots, prefetches. stored: date + city-level geo + path. never: ips, ids, cookies.
import astro from "@astrojs/cloudflare/entrypoints/server";
import { isBot } from "./lib/bots";

const SKIP = /^\/(api|x|d|_astro|_server-islands|og|img)(\/|$)/;

function countable(request: Request, res: Response) {
  if (request.method !== "GET" || res.status !== 200) return false;
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return false;
  const { pathname } = new URL(request.url);
  if (SKIP.test(pathname) || pathname === "/styleguide" || pathname === "/styleguide/") return false;
  return !isBot(request);
}

const round1 = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

async function record(request: Request, env: Env) {
  const cf = ((request as unknown as { cf?: Record<string, unknown> }).cf ?? {}) as Record<string, unknown>;
  let path = new URL(request.url).pathname;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  path = path.slice(0, 200) || "/";
  const date = new Date().toISOString().slice(0, 10);
  const country = typeof cf.country === "string" ? cf.country.slice(0, 2).toUpperCase() : "";
  const city = typeof cf.city === "string" ? cf.city.slice(0, 80) : "";
  await env.DB.prepare(
    `INSERT INTO visits_daily (date, country, city, lat, lon, path, count) VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT (date, country, city, path) DO UPDATE SET count = count + 1`,
  )
    .bind(date, country, city, round1(cf.latitude), round1(cf.longitude), path)
    .run();
}

// published images from the admin dither tool live in r2 (edwrdq-media, binding MEDIA) under img/.
// /img/* runs the worker first: static files in public/img win, misses fall back to r2.
const IMG = /^\/img\/([a-z0-9_-]+-[0-9a-f]{10}\.png)$/;

async function mediaImage(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const m = new URL(request.url).pathname.match(IMG);
  const bucket = (env as unknown as { MEDIA?: R2Bucket }).MEDIA;
  if (!m || !bucket || (request.method !== "GET" && request.method !== "HEAD")) return null;
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const obj = await bucket.get(`img/${m[1]}`);
  if (!obj) return null;
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("content-type", "image/png");
  headers.set("cache-control", "public, max-age=31536000, immutable"); // names carry a content hash
  headers.set("etag", obj.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  const res = new Response(obj.body, { headers });
  if (request.method === "GET") ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname.startsWith("/img/")) {
      const file = await env.ASSETS.fetch(request);
      if (file.status !== 404) return file;
      const img = await mediaImage(request, env, ctx).catch(() => null);
      return img ?? new Response("not found", { status: 404 });
    }
    const res = await astro.fetch(request as any, env as any, ctx as any);
    try {
      if (countable(request, res)) ctx.waitUntil(record(request, env).catch((e) => console.error("visit", e)));
    } catch {
      /* counting must never break a page */
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
