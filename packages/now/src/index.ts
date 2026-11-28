// "now" — what eddy is up to, resolved from (in order):
//   status: manual (D1) → discord via lanyard → hackatime (≤15m) → "listening" if music is live → last manual, dimmed
//   music:  cider/apple music via lanyard → spotify via lanyard → manual track (D1). nothing playing → null.
// the public never sees raw presence data, only the resolved strip.

const UA = "edwrdq-site (+https://edwrdq.com)";
const KV_KEY = "now:v1";
export const FRESH_MS = 30_000;
const SOURCE_TIMEOUT_MS = 1500;
const HACKATIME_WINDOW_S = 15 * 60;

export const TAGS = ["coding", "lifting", "at the shop", "listening"] as const;
export type Tag = (typeof TAGS)[number];

// ---- minimal binding shapes (no workers types dependency)
type D1 = {
  prepare(sql: string): {
    bind(...v: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
    first<T>(): Promise<T | null>;
  };
};
type KV = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};
export type NowEnv = { DB: D1; STATS: KV; DISCORD_USER_ID?: string; HACKATIME_API_KEY?: string };

export type Status = {
  text: string;
  tag: Tag | null;
  source: "manual" | "discord" | "hackatime" | "music" | "last";
  /** live = happening right now. false only for the dimmed "last manual" fallback */
  live: boolean;
  /** when it was set (iso) — used for "2h ago" on the fallback */
  since: string | null;
  /** rich presence extras (discord activities only): "details · state", start time, icon url */
  detail?: string | null;
  start?: string | null;
  /** remote icon url. never shown raw — the site serves it to a pixelating canvas */
  art?: string | null;
};
export type Music = {
  track: string;
  artist: string | null;
  url: string | null;
  /** remote album art url. never shown raw — the site serves it to a pixelating canvas */
  art: string | null;
  source: "cider" | "spotify" | "manual";
};
export type Presence = "online" | "idle" | "dnd" | "offline";
/** discord custom status. emoji only when it's a plain unicode one */
export type Custom = { text: string | null; emoji: string | null };
export type Now = {
  v: 1;
  checkedAt: string;
  status: Status | null;
  music: Music | null;
  /** discord online state (lanyard). null when lanyard is off/unavailable */
  presence?: Presence | null;
  custom?: Custom | null;
};

/** one thing being done right now, as recorded into now_sessions */
export type Seen = { kind: "coding" | "playing" | "watching" | "streaming" | "competing" | "listening"; name: string | null };

// diagnostics for the admin tool only — never sent to the public
export type NowDebug = {
  lanyard: { configured: boolean; state: "ok" | "not_monitored" | "error" | "off"; error?: string; activities?: unknown[]; spotify?: unknown };
  hackatime: { configured: boolean; state: "ok" | "error" | "off"; error?: string; project?: string | null; at?: string | null };
};

// ---------------------------------------------------------------- helpers

async function withTimeout<T>(p: Promise<T>, ms = SOURCE_TIMEOUT_MS): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms))),
  ]);
}

const clip = (s: unknown, n = 120) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** discord activity asset → image url (per discord's activity asset image docs) */
export function resolveAsset(image: unknown, applicationId?: unknown): string | null {
  if (typeof image !== "string" || !image) return null;
  if (image.startsWith("mp:")) {
    // mp:external/<hash>/https/<host>/<path> wraps the original url — use it directly
    // (discord's media proxy tends to refuse requests from workers)
    const m = image.match(/^mp:external\/[^/]+\/(https?)\/(.+)$/);
    if (m) return `${m[1]}://${m[2]}`;
    return `https://media.discordapp.net/${image.slice(3)}`;
  }
  if (image.startsWith("spotify:")) return `https://i.scdn.co/image/${image.slice(8)}`;
  if (/^https?:\/\//.test(image)) return image;
  if (/^\d+$/.test(image) && typeof applicationId === "string" && /^\d+$/.test(applicationId))
    return `https://cdn.discordapp.com/app-assets/${applicationId}/${image}.png`;
  return null;
}

/** a game with no rpc assets (plain detected game) still has an app icon behind discord's api */
const appIcon = (id: unknown) => (typeof id === "string" && /^\d+$/.test(id) ? `app:${id}` : null);

/** hosts the site may fetch album art from (the art endpoint refuses anything else) */
export const ART_HOSTS = [
  "media.discordapp.net",
  "cdn.discordapp.com",
  "i.scdn.co",
  /\.mzstatic\.com$/,
  /\.steamstatic\.com$/,
] as const;
export function artAllowed(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return ART_HOSTS.some((h) => (typeof h === "string" ? u.hostname === h : h.test(u.hostname)));
  } catch {
    return false;
  }
}

/**
 * stored art → fetchable https url. "app:<id>" (detected game, no rpc assets) is looked up
 * via discord's public rpc endpoint for the app's icon hash. null when there's nothing usable.
 */
export async function artUrl(art: string | null | undefined): Promise<string | null> {
  if (!art) return null;
  const app = art.match(/^app:(\d+)$/)?.[1];
  if (!app) return artAllowed(art) ? art : null;
  const res = await withTimeout(
    fetch(`https://discord.com/api/v10/applications/${app}/rpc`, { headers: { "user-agent": UA }, cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit),
  ).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { icon?: unknown } | null;
  const icon = typeof body?.icon === "string" && /^[a-f0-9_]+$/i.test(body.icon) ? body.icon : null;
  return icon ? `https://cdn.discordapp.com/app-icons/${app}/${icon}.png?size=64` : null;
}

// ---------------------------------------------------------------- lanyard

type Activity = {
  type?: number;
  name?: string;
  details?: string;
  state?: string;
  details_url?: string;
  application_id?: string;
  timestamps?: { start?: number; end?: number };
  assets?: { large_image?: string; large_text?: string; large_url?: string; small_image?: string };
  emoji?: { name?: string; id?: string };
};

const httpUrl = (v: unknown) => (typeof v === "string" && /^https?:\/\/\S+$/.test(v) ? v.slice(0, 500) : null);

// a track whose end time has passed (paused / stale rpc) isn't "playing now"
const stillPlaying = (a: Activity) => !a.timestamps?.end || a.timestamps.end > Date.now() - 15_000;

const IDLE = /^(idling|idle|afk)$/i;

const EDITORS = /^(visual studio code|code|vs ?code|cursor|zed|neovim|n?vim|sublime text|intellij idea.*|webstorm|rustrover|clion|pycharm.*|goland|android studio|xcode|helix|emacs)$/i;
const MUSIC_APPS = /^(cider|apple music|itunes|music)$/i;

let loggedShape = false;

async function lanyard(id: string) {
  const res = await withTimeout(fetch(`https://api.lanyard.rest/v1/users/${encodeURIComponent(id)}`, { headers: { "user-agent": UA } }));
  const body = (await res.json().catch(() => null)) as any;
  if (res.status === 404 && body?.error?.code === "user_not_monitored") return { state: "not_monitored" as const };
  if (!res.ok || !body?.success) throw new Error(`lanyard → ${res.status}`);
  const data = body.data ?? {};
  const activities: Activity[] = Array.isArray(data.activities) ? data.activities : [];

  // dev: print the raw activities once so the parsing matches reality
  if (!loggedShape && (import.meta as any).env?.DEV) {
    loggedShape = true;
    console.log("[now] lanyard activities:", JSON.stringify(activities, null, 2));
  }

  // ---- music
  let music: Music | null = null;
  // real cider shape (checked against lanyard): type 2, name "Cider", details = track,
  // state = artist, details_url = song.link, assets.large_url = apple music, art = mp:external/…
  const cider = activities.find(
    (a) => a.name !== "Spotify" && (MUSIC_APPS.test(a.name ?? "") || a.type === 2) && stillPlaying(a),
  );
  if (cider && clip(cider.details)) {
    music = {
      track: clip(cider.details),
      artist: clip(cider.state).replace(/^by\s+/i, "") || null,
      url: httpUrl(cider.details_url) ?? httpUrl(cider.assets?.large_url),
      art: resolveAsset(cider.assets?.large_image, cider.application_id),
      source: "cider",
    };
  } else if (data.listening_to_spotify && data.spotify?.song) {
    const s = data.spotify;
    music = {
      track: clip(s.song),
      artist: clip(s.artist).replace(/;\s*/g, ", ") || null,
      url: typeof s.track_id === "string" && s.track_id ? `https://open.spotify.com/track/${s.track_id}` : null,
      art: typeof s.album_art_url === "string" ? s.album_art_url : null,
      source: "spotify",
    };
  }

  // ---- status from non-music activities (skip listening + custom status)
  // a game/stream/watch beats an open editor (editors sit open in the background all day)
  let status: Status | null = null;
  let editor: Status | null = null;
  const VERB: Record<number, string> = { 0: "playing", 1: "streaming", 3: "watching", 5: "competing in" };
  const KIND: Record<number, Seen["kind"]> = { 0: "playing", 1: "streaming", 3: "watching", 5: "competing" };
  let seen: Seen | null = null;
  let editorSeen: Seen | null = null;
  for (const a of activities) {
    if (a.type === 2 || a.type === 4 || MUSIC_APPS.test(a.name ?? "")) continue;
    const name = clip(a.name, 60);
    if (!name) continue;
    if (EDITORS.test(name)) {
      if (editor) continue;
      // an open-but-idle editor isn't "coding" — let hackatime decide
      if (IDLE.test(clip(a.details)) || IDLE.test(clip(a.state))) continue;
      const ws =
        clip(a.state).match(/^(?:workspace|in|project|working on)[:\s]+(.+)$/i)?.[1] ??
        clip(a.details).match(/^(?:workspace|in|project|working on)[:\s]+(.+)$/i)?.[1] ??
        null;
      editor = { text: ws ? `coding ${ws.toLowerCase()}` : `coding in ${name.toLowerCase()}`, tag: "coding", source: "discord", live: true, since: null };
      editorSeen = { kind: "coding", name: (ws ?? name).toLowerCase().slice(0, 80) };
      continue;
    }
    const verb = a.type !== undefined ? VERB[a.type] : undefined;
    if (!verb) continue;
    const subject = a.type === 1 ? clip(a.details, 60) || name : name;
    const detail = [a.type === 1 ? "" : clip(a.details, 80), clip(a.state, 80)].filter(Boolean).join(" · ") || null;
    const start = typeof a.timestamps?.start === "number" && a.timestamps.start < Date.now() + 60_000 ? new Date(a.timestamps.start).toISOString() : null;
    status = {
      text: `${verb} ${subject.toLowerCase()}`,
      tag: null,
      source: "discord",
      live: true,
      since: null,
      detail,
      start,
      art: resolveAsset(a.assets?.large_image, a.application_id) ?? resolveAsset(a.assets?.small_image, a.application_id) ?? appIcon(a.application_id),
    };
    seen = { kind: KIND[a.type!]!, name: name.toLowerCase().slice(0, 80) };
    break;
  }
  status ??= editor;

  // ---- discord online state + custom status (type 4)
  const presence: Presence | null = ["online", "idle", "dnd", "offline"].includes(data.discord_status) ? data.discord_status : null;
  const cs = activities.find((a) => a.type === 4);
  const csText = clip(cs?.state, 128) || null;
  // custom (server) emoji have an id and need discord's cdn — only keep plain unicode ones
  const csEmoji = cs?.emoji?.name && !cs.emoji.id ? clip(cs.emoji.name, 16) || null : null;
  const custom: Custom | null = csText || csEmoji ? { text: csText, emoji: csEmoji } : null;

  return { state: "ok" as const, status, presence, custom, seen, editorSeen, music, activities, spotify: data.spotify ?? null };
}

// ---------------------------------------------------------------- hackatime

async function hackatime(key: string) {
  const res = await withTimeout(
    fetch("https://hackatime.hackclub.com/api/v1/my/heartbeats/most_recent", {
      headers: { authorization: `Bearer ${key}`, "user-agent": UA, accept: "application/json" },
    }),
  );
  if (!res.ok) throw new Error(`hackatime → ${res.status}`);
  const body = (await res.json()) as { has_heartbeat?: boolean; heartbeat?: { time?: number; project?: string } | null };
  const hb = body.has_heartbeat ? body.heartbeat : null;
  const time = typeof hb?.time === "number" ? hb.time : null;
  const project = clip(hb?.project, 60) || null;
  const fresh = time !== null && Date.now() / 1000 - time <= HACKATIME_WINDOW_S;
  return {
    project,
    at: time !== null ? new Date(time * 1000).toISOString() : null,
    status: fresh && project ? ({ text: `coding ${project.toLowerCase()}`, tag: "coding", source: "hackatime", live: true, since: null } as Status) : null,
  };
}

export type CodingDay = { date: string; total: number; projects: [string, number][] };

/**
 * hackatime's own per-day coding totals (utc days, oldest first) for /stats.
 * edge-cached 10 min so page views don't hit hackatime. null on any failure.
 */
export async function hackatimeDays(key: string | undefined, days = 14): Promise<CodingDay[] | null> {
  if (!key?.trim()) return null;
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const url = `https://hackatime.hackclub.com/api/hackatime/v1/users/current/summaries?start=${ymd(start)}&end=${ymd(end)}`;
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  // cache key never contains the api key
  const ck = new Request(`https://now.cache/hackatime/${ymd(start)}/${ymd(end)}`);
  let body: any = null;
  try {
    const hit = await cache?.match(ck);
    if (hit) body = await hit.json();
    else {
      const res = await withTimeout(fetch(url, { headers: { authorization: `Bearer ${key.trim()}`, "user-agent": UA, accept: "application/json" } }), 3000);
      if (!res.ok) throw new Error(`hackatime summaries → ${res.status}`);
      body = await res.json();
      await cache?.put(ck, new Response(JSON.stringify(body), { headers: { "cache-control": "public, max-age=600" } })).catch(() => {});
    }
  } catch (e) {
    console.error("hackatime summaries", e);
    return null;
  }
  if (!Array.isArray(body?.data)) return null;
  return body.data.map((d: any) => ({
    date: String(d?.range?.date ?? "").slice(0, 10),
    total: Math.max(0, Number(d?.grand_total?.total_seconds) || 0),
    projects: (Array.isArray(d?.projects) ? d.projects : [])
      .map((p: any) => [clip(p?.name, 80).toLowerCase(), Math.max(0, Number(p?.total_seconds) || 0)] as [string, number])
      .filter(([n, t]: [string, number]) => n && n !== "other" && n !== "unknown" && t > 0),
  }));
}

// ---------------------------------------------------------------- d1

type Row = { id: number; kind: "status" | "track"; text: string; tag: Tag | null; artist: string | null; url: string | null; created_at: number; expires_at: number | null; cleared_at: number | null };

const ACTIVE = `cleared_at IS NULL AND (expires_at IS NULL OR expires_at > unixepoch())`;

export const activeStatus = (db: D1) =>
  db.prepare(`SELECT * FROM now_status WHERE kind = 'status' AND ${ACTIVE} ORDER BY created_at DESC, id DESC LIMIT 1`).first<Row>();
export const activeTrack = (db: D1) =>
  db.prepare(`SELECT * FROM now_status WHERE kind = 'track' AND ${ACTIVE} ORDER BY created_at DESC, id DESC LIMIT 1`).first<Row>();
const lastStatus = (db: D1) =>
  db.prepare(`SELECT * FROM now_status WHERE kind = 'status' ORDER BY created_at DESC, id DESC LIMIT 1`).first<Row>();

const iso = (unix: number) => new Date(unix * 1000).toISOString();

// ---------------------------------------------------------------- sessions (history)

type SessionRow = { id: number; kind: Seen["kind"]; name: string | null; started_at: number; last_seen_at: number };

/** a session counts as over once it hasn't been seen for this long */
export const SESSION_GAP_S = 180;

// newest finished, non-music session (for "played roblox · 2h ago"). missing table → null.
const lastSession = (db: D1) =>
  db
    .prepare(`SELECT * FROM now_sessions WHERE kind != 'listening' AND last_seen_at < unixepoch() - ${SESSION_GAP_S} ORDER BY last_seen_at DESC LIMIT 1`)
    .first<SessionRow>();

const PAST: Record<Seen["kind"], string> = { coding: "coded", playing: "played", watching: "watched", streaming: "streamed", competing: "competed in", listening: "listened" };
const pastTense = (r: SessionRow) => (r.name ? `${PAST[r.kind]} ${r.name}` : PAST[r.kind]);

/** extend each open session, or start a new one. one write per active thing per minute. */
export async function recordSeen(db: D1, seen: Seen[]) {
  for (const x of seen) {
    const res = (await db
      .prepare(
        `UPDATE now_sessions SET last_seen_at = unixepoch()
         WHERE id = (SELECT id FROM now_sessions WHERE kind = ? AND name IS ? AND last_seen_at >= unixepoch() - ${SESSION_GAP_S} ORDER BY id DESC LIMIT 1)`,
      )
      .bind(x.kind, x.name)
      .run()) as { meta?: { changes?: number } };
    if (!res?.meta?.changes)
      await db.prepare(`INSERT INTO now_sessions (kind, name, started_at, last_seen_at) VALUES (?, ?, unixepoch(), unixepoch())`).bind(x.kind, x.name).run();
  }
}

/** cron (every minute): recompute, refresh the kv cache, record history */
export async function tick(env: NowEnv) {
  const [cached, { now, seen }] = await Promise.all([readNow(env), computeNow(env)]);
  // kv only on change (or every 10 min) — a write every minute would eat the daily kv quota
  const stale10m = !cached || Date.now() - Date.parse(cached.checkedAt) > 10 * 60_000;
  await Promise.all([!same(cached, now) || stale10m ? env.STATS.put(KV_KEY, JSON.stringify(now)) : null, recordSeen(env.DB, seen)]);
  return { now, seen };
}

// ---------------------------------------------------------------- resolve

export async function computeNow(env: NowEnv): Promise<{ now: Now; debug: NowDebug; seen: Seen[] }> {
  const discordId = env.DISCORD_USER_ID?.trim() || "";
  const hkKey = env.HACKATIME_API_KEY?.trim() || "";

  const [ly, hk, manual, track, last, ended] = await Promise.allSettled([
    discordId ? lanyard(discordId) : Promise.resolve(null),
    hkKey ? hackatime(hkKey) : Promise.resolve(null),
    activeStatus(env.DB),
    activeTrack(env.DB),
    lastStatus(env.DB),
    lastSession(env.DB),
  ]);

  const debug: NowDebug = {
    lanyard: { configured: !!discordId, state: discordId ? "error" : "off" },
    hackatime: { configured: !!hkKey, state: hkKey ? "error" : "off" },
  };

  const lyVal = ly.status === "fulfilled" ? ly.value : null;
  if (ly.status === "rejected") debug.lanyard.error = String(ly.reason?.message ?? ly.reason);
  if (lyVal?.state === "not_monitored") debug.lanyard.state = "not_monitored";
  if (lyVal?.state === "ok") Object.assign(debug.lanyard, { state: "ok", activities: lyVal.activities, spotify: lyVal.spotify });

  const hkVal = hk.status === "fulfilled" ? hk.value : null;
  if (hk.status === "rejected") debug.hackatime.error = String(hk.reason?.message ?? hk.reason);
  if (hkVal) Object.assign(debug.hackatime, { state: "ok", project: hkVal.project, at: hkVal.at });

  const m = manual.status === "fulfilled" ? manual.value : null;
  const t = track.status === "fulfilled" ? track.value : null;
  const l = last.status === "fulfilled" ? last.value : null;

  // ---- music: cider/spotify (live) → manual track
  let music: Music | null = lyVal?.state === "ok" ? lyVal.music : null;
  if (!music && t) music = { track: t.text, artist: t.artist, url: t.url, art: null, source: "manual" };

  // ---- status
  let status: Status | null = null;
  if (m) status = { text: m.text, tag: m.tag, source: "manual", live: true, since: iso(m.created_at) };
  else if (lyVal?.state === "ok" && lyVal.status) status = lyVal.status;
  else if (hkVal?.status) status = hkVal.status;
  else if (music) status = { text: "listening", tag: "listening", source: "music", live: true, since: null };
  else {
    // nothing live: the most recent of (last manual status, last recorded session)
    const e = ended.status === "fulfilled" ? ended.value : null;
    if (e && (!l || e.last_seen_at > l.created_at)) status = { text: pastTense(e), tag: e.kind === "coding" ? "coding" : null, source: "last", live: false, since: iso(e.last_seen_at) };
    else if (l) status = { text: l.text, tag: l.tag, source: "last", live: false, since: iso(l.created_at) };
  }

  // ---- what to record (independent of what the strip shows — a manual status doesn't hide a game)
  const seen: Seen[] = [];
  if (lyVal?.state === "ok" && lyVal.seen) seen.push(lyVal.seen);
  // hackatime keeps "coding" up for 15 min on the strip, but history only counts heartbeats
  // from the last 5 min — otherwise every session would end 15 min late
  const hkRecent = !!hkVal?.at && Date.now() - Date.parse(hkVal.at) <= 5 * 60_000;
  const hkProject = hkVal?.status && hkRecent ? hkVal.project?.toLowerCase() ?? null : null;
  if (hkProject) seen.push({ kind: "coding", name: hkProject });
  else if (lyVal?.state === "ok" && lyVal.editorSeen) seen.push(lyVal.editorSeen);
  if (music && music.source !== "manual") seen.push({ kind: "listening", name: null });

  const ok = lyVal?.state === "ok";
  return {
    now: { v: 1, checkedAt: new Date().toISOString(), status, music, presence: ok ? lyVal.presence : null, custom: ok ? lyVal.custom : null },
    debug,
    seen,
  };
}

// ---------------------------------------------------------------- kv cache

export async function readNow(env: Pick<NowEnv, "STATS">): Promise<Now | null> {
  try {
    return ((await env.STATS.get(KV_KEY, "json")) as Now | null) ?? null;
  } catch {
    return null;
  }
}

const same = (a: Now | null, b: Now) =>
  !!a && JSON.stringify([a.status, a.music, a.presence, a.custom]) === JSON.stringify([b.status, b.music, b.presence, b.custom]);

/**
 * fresh-enough cached value, or a recompute. kv is only written when the
 * result changes (or every 10 min), so a busy page doesn't burn kv writes.
 */
export async function getNow(env: NowEnv, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Now> {
  const cached = await readNow(env);
  if (cached && Date.now() - Date.parse(cached.checkedAt) < FRESH_MS) return cached;
  const { now } = await computeNow(env);
  const stale10m = !cached || Date.now() - Date.parse(cached.checkedAt) > 10 * 60_000;
  if (!same(cached, now) || stale10m) {
    const p = env.STATS.put(KV_KEY, JSON.stringify(now)).catch((e) => console.error("now kv", e));
    if (ctx) ctx.waitUntil(p);
    else await p;
  }
  return now;
}

/** admin: recompute and write immediately (after a manual change) */
export async function refreshNow(env: NowEnv) {
  const out = await computeNow(env);
  await env.STATS.put(KV_KEY, JSON.stringify(out.now));
  return out;
}
