import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { checkRate, checkSender, handle, json, ping, preview, readInput } from "../../lib/server/submit";

export const prerender = false;

export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const input = await readInput(request);
    const ipHash = await checkSender(request, input);
    await checkRate(ipHash);

    await env.DB.prepare("INSERT INTO messages (body, name, ip_hash) VALUES (?, ?, ?)")
      .bind(input.body, input.name, ipHash)
      .run();

    ping(locals.cfContext, `guestbook — ${input.name ?? "anon"}: ${preview(input.body)}`);
    return json({ ok: true }, 201);
  });
