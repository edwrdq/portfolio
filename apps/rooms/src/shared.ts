// bits the worker and the room objects both need: hashing, settings, json replies.
import { compile, type Rule } from "@edwrdq/rooms/filter";

export type Settings = { chatOff: boolean; playOff: boolean; words: string; rules: Rule[] };

let cached: { at: number; s: Settings } | null = null;
const TTL = 30_000;

/** kill switches + banned words from d1, cached per isolate for 30s (admin pushes changes to live rooms) */
export async function settings(env: Env, fresh = false): Promise<Settings> {
  if (!fresh && cached && Date.now() - cached.at < TTL) return cached.s;
  const { results } = await env.DB.prepare("SELECT key, value FROM rooms_settings").all<{ key: string; value: string }>();
  const get = (k: string) => results.find((r) => r.key === k)?.value ?? "";
  const words = get("banned_words");
  const s = { chatOff: get("chat_off") === "1", playOff: get("play_off") === "1", words, rules: compile(words) };
  cached = { at: Date.now(), s };
  return s;
}

/** salted sha-256, 32 hex chars. used for ips and session ids — the raw values are never stored. */
export async function hash(env: Env, kind: "ip" | "sid", value: string) {
  const salt = env.IP_SALT || (env.DEV ? "dev-only-salt" : "");
  if (!salt) throw new Error("IP_SALT is not set");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${kind}:${value}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** came through the tor doorway? only if X-From-Onion matches ONION_SECRET exactly */
export function isOnion(request: Request, env: Env) {
  const got = request.headers.get("x-from-onion");
  const want = env.ONION_SECRET;
  if (!want || !got || got.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < got.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

/** an active ban on either hash? (tor visitors have no ip hash: they all share the vps's ip) */
export async function banned(env: Env, sidHash: string | null, ipHash: string | null) {
  ipHash ||= null;
  const row = await env.DB.prepare(
    "SELECT 1 FROM room_bans WHERE (sid_hash = ?1 OR ip_hash = ?2) AND (expires_at IS NULL OR expires_at > unixepoch()) LIMIT 1",
  )
    .bind(sidHash ?? "-", ipHash ?? "-")
    .first();
  return !!row;
}

export const isSid = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(s);
