// GET /d/<token>/f/<idx>?t=<ticket> — streams one file from r2. supports range (resume).
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { disposition, RISKY_TYPES, TOKEN_RE, type DropFile } from "@edwrdq/drop";

export const prerender = false;

const gone = () => new Response("this drop expired.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export const GET: APIRoute = async ({ params, url, request }) => {
  const token = params.token ?? "";
  const ticket = url.searchParams.get("t") ?? "";
  const idx = Number(params.idx);
  if (!TOKEN_RE.test(token) || !TOKEN_RE.test(ticket) || !Number.isInteger(idx)) return gone();

  const ok = await env.DB.prepare("SELECT 1 FROM drop_tickets WHERE ticket = ? AND drop_token = ? AND expires_at > unixepoch()").bind(ticket, token).first();
  if (!ok) return gone();
  const f = await env.DB.prepare("SELECT * FROM drop_files WHERE drop_token = ? AND idx = ? AND done = 1").bind(token, idx).first<DropFile>();
  if (!f) return gone();

  const obj = await env.DROP.get(f.r2_key, { range: request.headers, onlyIf: request.headers });
  if (!obj) return gone();

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  const type = f.content_type && !RISKY_TYPES.test(f.content_type) ? f.content_type : "application/octet-stream";
  headers.set("content-type", type);
  headers.set("content-disposition", disposition(f.filename));
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "sandbox; default-src 'none'");
  headers.set("referrer-policy", "no-referrer");

  // conditional request matched (304-ish): r2 returns metadata without a body
  if (!("body" in obj)) return new Response(null, { status: 304, headers });

  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && request.headers.has("range")) {
    const offset = range.suffix !== undefined ? obj.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? obj.size - offset);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
};
