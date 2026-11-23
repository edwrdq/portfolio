import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getPosts } from "../../lib/content";
import { checkRate, clientIp, Fail, handle, hashIp, json, ping, preview, readInput, verifyTurnstile } from "../../lib/server/submit";

export const prerender = false;

async function assertPost(slug: unknown): Promise<string> {
  if (typeof slug !== "string" || !slug || slug.length > 200) throw new Fail(400, "which post?");
  const posts = await getPosts();
  // getPosts() already drops drafts in prod
  if (!posts.some((p) => p.id === slug)) throw new Fail(404, "that post doesn't exist.");
  return slug;
}

// approved comments for a post (also rendered server-side by the Comments island)
export const GET: APIRoute = ({ url }) =>
  handle(async () => {
    const slug = await assertPost(url.searchParams.get("slug"));
    const { results } = await env.DB.prepare(
      "SELECT id, body, name, reply, created_at FROM comments WHERE slug = ? AND status = 'approved' ORDER BY created_at ASC LIMIT 500",
    )
      .bind(slug)
      .all();
    return json({ ok: true, comments: results });
  });

export const POST: APIRoute = ({ request, locals }) =>
  handle(async () => {
    const input = await readInput(request);
    const slug = await assertPost(input.slug);
    const ip = clientIp(request);
    await verifyTurnstile(input.token, ip);
    const ipHash = await hashIp(ip);
    await checkRate(ipHash);

    await env.DB.prepare("INSERT INTO comments (slug, body, name, ip_hash) VALUES (?, ?, ?, ?)")
      .bind(slug, input.body, input.name, ipHash)
      .run();

    ping(locals.cfContext, `comment on /blog/${slug} — ${input.name ?? "anon"}: ${preview(input.body)}`);
    return json({ ok: true }, 201);
  });
