// shared drop logic for the site (download page) and admin (upload + manage).

export const PART_SIZE = 50 * 1024 * 1024; // r2 multipart part size; stays under the 100MB request limit
export const TICKET_TTL_S = 6 * 60 * 60; // long enough for a multi-GB download to finish or resume
export const PW_MAX_FAILS = 5; // wrong passwords allowed per token…
export const PW_WINDOW_S = 15 * 60; // …per 15 minutes
const PBKDF2_ITER = 100_000; // workers' webcrypto caps pbkdf2 at 100k

// ---- minimal binding shapes
type Stmt = { bind(...v: unknown[]): Stmt; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> };
type D1 = { prepare(sql: string): Stmt; batch(s: Stmt[]): Promise<unknown> };
type R2 = {
  list(o: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
};
export type DropEnv = { DB: D1; DROP: R2 };

export type Drop = {
  token: string;
  note: string | null;
  expires_at: number;
  max_downloads: number | null;
  download_count: number;
  password_hash: string | null;
  created_at: number;
  ready: number;
  pw_fails: number;
  pw_window: number;
};
export type DropFile = { id: number; drop_token: string; idx: number; r2_key: string; filename: string; size: number; content_type: string | null; upload_id: string | null; done: number };

// ---------------------------------------------------------------- tokens

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

/** 128-bit random, base64url (22 chars) */
export const newToken = () => b64url(crypto.getRandomValues(new Uint8Array(16)));
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

// ---------------------------------------------------------------- passwords (pbkdf2-sha256)

async function pbkdf2(password: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, PBKDF2_ITER))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = await pbkdf2(password, fromB64url(salt), Number(iter));
  const want = fromB64url(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i]; // constant time
  return diff === 0;
}

// ---------------------------------------------------------------- state

export const nowS = () => Math.floor(Date.now() / 1000);

export function dropState(d: Pick<Drop, "ready" | "expires_at" | "max_downloads" | "download_count">, now = nowS()) {
  if (!d.ready) return "uploading" as const;
  if (d.expires_at <= now) return "expired" as const;
  if (d.max_downloads !== null && d.download_count >= d.max_downloads) return "used" as const;
  return "live" as const;
}

/** a download that's already started keeps its files until its ticket runs out */
export async function hasLiveTickets(env: DropEnv, token: string) {
  return !!(await env.DB.prepare("SELECT 1 FROM drop_tickets WHERE drop_token = ? AND expires_at > unixepoch() LIMIT 1").bind(token).first());
}

/** delete every r2 object under the drop (incl. half-finished uploads) and its rows */
export async function deleteDrop(env: DropEnv, token: string) {
  const prefix = `drops/${token}/`;
  let cursor: string | undefined;
  do {
    const page = await env.DROP.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length) await env.DROP.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM drop_tickets WHERE drop_token = ?").bind(token),
    env.DB.prepare("DELETE FROM drop_files WHERE drop_token = ?").bind(token),
    env.DB.prepare("DELETE FROM drops WHERE token = ?").bind(token),
  ]);
}

/**
 * purge drops that are expired, used up, or abandoned mid-upload (>24h) — skipping any
 * with a download still in flight. returns how many were deleted.
 */
export async function purgeExpired(env: DropEnv) {
  const { results } = await env.DB.prepare(
    `SELECT token FROM drops d
     WHERE (expires_at <= unixepoch()
            OR (max_downloads IS NOT NULL AND download_count >= max_downloads)
            OR (ready = 0 AND created_at < unixepoch() - 86400))
       AND NOT EXISTS (SELECT 1 FROM drop_tickets t WHERE t.drop_token = d.token AND t.expires_at > unixepoch())
     LIMIT 200`,
  ).all<{ token: string }>();
  for (const r of results) await deleteDrop(env, r.token);
  await env.DB.prepare("DELETE FROM drop_tickets WHERE expires_at <= unixepoch()").bind().run();
  return results.length;
}

// ---------------------------------------------------------------- display

export function bytes(n: number) {
  if (n < 1024) return `${n} b`;
  const units = ["kb", "mb", "gb", "tb"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) (v /= 1024), u++;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

export function timeLeft(expires: number, now = nowS()) {
  const s = expires - now;
  if (s <= 0) return "expired";
  if (s < 3600) return `${Math.ceil(s / 60)}m left`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m left`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h left`;
}

/** safe object key part from a filename */
export const keyName = (name: string) => name.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "file";

/** Content-Disposition with an ascii fallback + utf-8 filename* */
export function disposition(filename: string) {
  const ascii = filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** types a browser might render inline — always served as a plain download */
export const RISKY_TYPES = /^(text\/html|application\/xhtml|image\/svg|application\/xml|text\/xml|application\/(x-)?javascript|text\/javascript)/i;
