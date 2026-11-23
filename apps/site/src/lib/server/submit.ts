// shared pipeline for guestbook messages and blog comments:
// parse → validate → turnstile → rate limit → insert (pending) → discord ping
import { env } from "cloudflare:workers";

const RATE_LIMIT = 5;
const RATE_WINDOW_S = 10 * 60;

export type Input = { body: string; name: string | null; token: string };

export class Fail extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function readInput(request: Request): Promise<Record<string, unknown> & Input> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new Fail(415, "send json.");
  let raw: Record<string, unknown>;
  try {
    raw = await request.json();
  } catch {
    throw new Fail(400, "that didn't parse.");
  }
  if (!raw || typeof raw !== "object") throw new Fail(400, "that didn't parse.");

  // normalize line endings, strip control chars (keep \n and \t), trim
  const clean = (v: unknown) =>
    typeof v === "string"
      ? v
          .replace(/\r\n?/g, "\n")
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
          .trim()
      : "";

  const body = clean(raw.body);
  const name = clean(raw.name).replace(/\s+/g, " ");
  const token = typeof raw.token === "string" ? raw.token : "";

  // count code points, not utf-16 units
  const len = (s: string) => [...s].length;
  if (len(body) < 1) throw new Fail(400, "say something first.");
  if (len(body) > 1000) throw new Fail(400, "keep it under 1000 characters.");
  if (len(name) > 40) throw new Fail(400, "name's too long. 40 max.");

  return { ...raw, body, name: name || null, token };
}

export async function verifyTurnstile(token: string, ip: string | null) {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) {
    if (import.meta.env.DEV) return; // local dev without a secret: skip
    throw new Fail(500, "the bot check isn't set up. tell eddy.");
  }
  if (!token) throw new Fail(400, "the bot check didn't finish. try again.");

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);

  let ok = false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = (await res.json()) as { success?: boolean };
    ok = data.success === true;
  } catch {
    throw new Fail(502, "couldn't reach the bot check. try again.");
  }
  if (!ok) throw new Fail(403, "the bot check said no. refresh and try again.");
}

export async function hashIp(ip: string | null) {
  const salt = env.IP_SALT;
  if (!salt && !import.meta.env.DEV) throw new Fail(500, "not set up yet. tell eddy.");
  const data = new TextEncoder().encode(`${ip ?? "unknown"}${salt ?? "dev"}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 5 submissions per 10 min per ip hash, across messages + comments */
export async function checkRate(ipHash: string) {
  const since = Math.floor(Date.now() / 1000) - RATE_WINDOW_S;
  const row = await env.DB.prepare(
    `SELECT
       (SELECT count(*) FROM messages WHERE ip_hash = ?1 AND created_at > ?2) +
       (SELECT count(*) FROM comments WHERE ip_hash = ?1 AND created_at > ?2) AS n`,
  )
    .bind(ipHash, since)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= RATE_LIMIT) throw new Fail(429, "slow down. try again in a few minutes.");
}

/** fire-and-forget discord ping. never throws. */
export function ping(ctx: { waitUntil(p: Promise<unknown>): void } | undefined, text: string) {
  const url = env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  const p = fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // no mentions, ever — content is user-written
    body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
  }).catch(() => {});
  if (ctx) ctx.waitUntil(p);
}

export const clientIp = (request: Request) => request.headers.get("cf-connecting-ip");

export const preview = (s: string, n = 140) => {
  const one = s.replace(/\s+/g, " ");
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/** run a handler and turn Fail into a json error */
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Fail) return json({ ok: false, error: e.message }, e.status);
    console.error(e);
    return json({ ok: false, error: "something broke. try again?" }, 500);
  }
}
