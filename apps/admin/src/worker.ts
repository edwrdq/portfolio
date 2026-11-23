// admin entry. nothing — not even a stylesheet — is served without a valid
// Cloudflare Access JWT. Access already sits in front; this is the second lock.
import astro from "@astrojs/cloudflare/entrypoints/server";
import { verifyAccess } from "./lib/access";

const forbidden = () =>
  new Response("403 — forbidden\n", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // local dev has no Access in front. this branch is compiled out of prod builds.
    if (import.meta.env.DEV) return astro.fetch(request as any, env as any, ctx as any);

    const claims = await verifyAccess(
      request.headers.get("cf-access-jwt-assertion"),
      env.ACCESS_TEAM_DOMAIN,
      env.ACCESS_AUD,
    );
    if (!claims) return forbidden();

    // overwrite (never trust) the identity header we pass to pages
    const headers = new Headers(request.headers);
    headers.set("x-admin-email", claims.email ?? claims.sub ?? "unknown");
    const authed = new Request(request, { headers });

    const res = await astro.fetch(authed as any, env as any, ctx as any);
    // admin pages are never cacheable by anyone in between
    const out = new Response(res.body, res);
    out.headers.set("cache-control", "private, no-store");
    out.headers.set("x-robots-tag", "noindex, nofollow");
    out.headers.set("referrer-policy", "same-origin");
    out.headers.set("x-frame-options", "DENY");
    return out;
  },
} satisfies ExportedHandler<Env>;
