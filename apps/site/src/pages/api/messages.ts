import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { checkRate, clientIp, handle, hashIp, json, ping, preview, readInput, verifyTurnstile } from "../../lib/server/submit";

export const prerender = false;

export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const input = await readInput(request);
    const ip = clientIp(request);
    await verifyTurnstile(input.token, ip);
    const ipHash = await hashIp(ip);
    await checkRate(ipHash);

    await env.DB.prepare("INSERT INTO messages (body, name, ip_hash) VALUES (?, ?, ?)")
      .bind(input.body, input.name, ipHash)
      .run();

    ping(locals.cfContext, `guestbook — ${input.name ?? "anon"}: ${preview(input.body)}`);
    return json({ ok: true }, 201);
  });
