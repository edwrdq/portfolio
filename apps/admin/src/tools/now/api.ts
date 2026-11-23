import { env } from "cloudflare:workers";
import { refreshNow, TAGS } from "@edwrdq/now";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";

type In = {
  text?: string;
  tag?: string | null;
  artist?: string | null;
  url?: string | null;
  expires_at?: number | null;
  id?: number;
};

const clean = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");
const MAX_EXPIRY_S = 60 * 60 * 24 * 365;

function expiry(v: unknown): number | null | "bad" {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return "bad";
  const now = Date.now() / 1000;
  if (v <= now || v > now + MAX_EXPIRY_S) return "bad";
  return Math.floor(v);
}

function link(v: unknown): string | null | "bad" {
  const s = clean(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "bad";
  } catch {
    return "bad";
  }
}

// every write: close out the previous active row of that kind, then refresh the public cache
const closeActive = (kind: "status" | "track") =>
  env.DB.prepare(
    `UPDATE now_status SET cleared_at = unixepoch()
     WHERE kind = ? AND cleared_at IS NULL AND (expires_at IS NULL OR expires_at > unixepoch())`,
  ).bind(kind);

export const POST: ToolApi["POST"] = async ({ request }, path) => {
  const b = (await body<In>(request)) ?? {};
  const action = path[0];

  if (action === "status") {
    const text = clean(b.text, 120);
    if (!text) return fail("status can't be empty");
    const tag = b.tag ? clean(b.tag, 20) : null;
    if (tag && !(TAGS as readonly string[]).includes(tag)) return fail("unknown tag");
    const exp = expiry(b.expires_at);
    if (exp === "bad") return fail("bad expiry");
    await env.DB.batch([
      closeActive("status"),
      env.DB.prepare("INSERT INTO now_status (kind, text, tag, expires_at) VALUES ('status', ?, ?, ?)").bind(text, tag, exp),
    ]);
  } else if (action === "track") {
    const text = clean(b.text, 120);
    if (!text) return fail("track can't be empty");
    const artist = clean(b.artist, 120) || null;
    const url = link(b.url);
    if (url === "bad") return fail("link must be http(s)");
    const exp = expiry(b.expires_at);
    if (exp === "bad" || exp === null) return fail("tracks need an expiry");
    await env.DB.batch([
      closeActive("track"),
      env.DB.prepare("INSERT INTO now_status (kind, text, artist, url, expires_at) VALUES ('track', ?, ?, ?, ?)").bind(text, artist, url, exp),
    ]);
  } else if (action === "clear-status") {
    await closeActive("status").run();
  } else if (action === "clear-track") {
    await closeActive("track").run();
  } else if (action === "delete") {
    if (!Number.isInteger(b.id)) return fail("bad id");
    await env.DB.prepare("DELETE FROM now_status WHERE id = ?").bind(b.id).run();
  } else {
    return fail("not found", 404);
  }

  const { now } = await refreshNow(env);
  return json({ ok: true, now });
};
