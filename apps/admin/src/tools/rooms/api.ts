// admin → rooms. the live list comes from d1 (rooms rows); peek / mute / kick / ban go straight to
// each room's durable object in the edwrdq-rooms worker. bans are hashes only (session + ip).
import { env } from "cloudflare:workers";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";

// the rpc surface of edwrdq-rooms' Room (apps/rooms/src/room.ts)
type RoomRpc = {
  peek(): Promise<unknown>;
  moderate(action: "mute" | "unmute" | "kick" | "close", sid?: string): Promise<boolean>;
  enforceBan(sid: string | null, ip: string | null): Promise<number>;
  refresh(): Promise<void>;
};
const room = (code: string) => env.ROOM.get(env.ROOM.idFromName(code)) as unknown as RoomRpc;
const isCode = (c: unknown): c is string => typeof c === "string" && /^[A-Z0-9]{4}$/.test(c);
const isHash = (h: unknown): h is string => typeof h === "string" && /^[0-9a-f]{32}$/.test(h);
const DURATION = { "1h": 3600, "24h": 86400, forever: null } as const;
type Duration = keyof typeof DURATION;

async function codes() {
  const { results } = await env.DB.prepare("SELECT code FROM rooms").all<{ code: string }>();
  return results.map((r) => r.code);
}
/** run on every live room; one broken room never blocks the rest */
const everyRoom = async <T>(f: (r: RoomRpc) => Promise<T>) => Promise.allSettled((await codes()).map((c) => f(room(c))));

async function getSettings() {
  const { results } = await env.DB.prepare("SELECT key, value FROM rooms_settings").all<{ key: string; value: string }>();
  const get = (k: string) => results.find((r) => r.key === k)?.value ?? "";
  return { chatOff: get("chat_off") === "1", playOff: get("play_off") === "1", words: get("banned_words") };
}
const setSetting = (key: string, value: string) =>
  env.DB.prepare("INSERT INTO rooms_settings (key, value, updated_at) VALUES (?1, ?2, unixepoch()) ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = unixepoch()").bind(key, value).run();

export const GET: ToolApi["GET"] = async ({ url }, path) => {
  switch (path[0]) {
    case "live": {
      const [{ results: rooms }, s, open] = await Promise.all([
        env.DB.prepare("SELECT code, game, public, state, players, max, created_at, updated_at FROM rooms ORDER BY created_at DESC LIMIT 200").all(),
        getSettings(),
        env.DB.prepare("SELECT count(*) n FROM room_reports WHERE status = 'open'").first<{ n: number }>(),
      ]);
      return json({ ok: true, rooms, chatOff: s.chatOff, playOff: s.playOff, reports: open?.n ?? 0 });
    }
    case "peek": {
      const code = url.searchParams.get("code");
      if (!isCode(code)) return fail("bad code");
      return json({ ok: true, room: await room(code).peek() });
    }
    case "reports": {
      const { results } = await env.DB.prepare("SELECT * FROM room_reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 200").all();
      return json({ ok: true, reports: results });
    }
    case "bans": {
      const { results } = await env.DB.prepare("SELECT * FROM room_bans WHERE expires_at IS NULL OR expires_at > unixepoch() ORDER BY created_at DESC LIMIT 500").all();
      return json({ ok: true, bans: results });
    }
    case "words":
      return json({ ok: true, words: (await getSettings()).words });
  }
  return fail("not found", 404);
};

export const POST: ToolApi["POST"] = async ({ request }, path) => {
  const b = await body<Record<string, unknown>>(request);
  if (!b) return fail("bad json");
  switch (path[0]) {
    case "switch": {
      if (b.key !== "chat_off" && b.key !== "play_off") return fail("bad switch");
      await setSetting(b.key, b.on ? "1" : "0");
      await everyRoom((r) => r.refresh()); // live rooms pick it up now, not in 30s
      return json({ ok: true });
    }
    case "moderate": {
      const action = b.action;
      if (!isCode(b.code) || (action !== "mute" && action !== "unmute" && action !== "kick" && action !== "close")) return fail("bad request");
      if (action !== "close" && !isHash(b.sid)) return fail("bad session");
      return json({ ok: await room(b.code).moderate(action, action === "close" ? undefined : (b.sid as string)) });
    }
    case "ban": {
      const sid = isHash(b.sid) ? b.sid : null;
      const ip = isHash(b.ip) ? b.ip : null;
      const d = b.duration as Duration;
      if ((!sid && !ip) || !(d in DURATION)) return fail("bad ban");
      const secs = DURATION[d];
      await env.DB.prepare("INSERT INTO room_bans (sid_hash, ip_hash, nick, reason, expires_at) VALUES (?, ?, ?, ?, ?)")
        .bind(sid, ip, typeof b.nick === "string" ? b.nick.slice(0, 40) : null, typeof b.reason === "string" ? b.reason.slice(0, 200) : null, secs ? Math.floor(Date.now() / 1000) + secs : null)
        .run();
      // their open reports are dealt with too
      if (sid) await env.DB.prepare("UPDATE room_reports SET status = 'banned' WHERE status = 'open' AND sid_hash = ?").bind(sid).run();
      const hits = await everyRoom((r) => r.enforceBan(sid, ip));
      const removed = hits.reduce((n, h) => n + (h.status === "fulfilled" ? h.value : 0), 0);
      return json({ ok: true, removed });
    }
    case "unban": {
      if (typeof b.id !== "number") return fail("bad id");
      await env.DB.prepare("DELETE FROM room_bans WHERE id = ?").bind(b.id).run();
      return json({ ok: true });
    }
    case "dismiss": {
      if (typeof b.id !== "number") return fail("bad id");
      await env.DB.prepare("UPDATE room_reports SET status = 'dismissed' WHERE id = ?").bind(b.id).run();
      return json({ ok: true });
    }
    case "words": {
      if (typeof b.words !== "string" || b.words.length > 50_000) return fail("too long");
      await setSetting("banned_words", b.words.replace(/\r\n?/g, "\n"));
      await everyRoom((r) => r.refresh());
      return json({ ok: true });
    }
  }
  return fail("not found", 404);
};
