// edwrdq-rooms: everything under edwrdq.com/ws/*
//   GET /ws/new?game=auction&public=0|1   → { code }  make a room
//   GET /ws/quick?game=auction            → { code }  an open public room, or a new public one
//   GET /ws/room/K7QX  (websocket)        → that room's durable object
// browser-only: requests must come from the site's origin. ips are hashed here and never kept raw.
import { GAMES, isCode, isGame, newCode } from "@edwrdq/rooms";
import { ONION_ADDRESS } from "@edwrdq/ui/onion";
import { banned, hash, isOnion, settings } from "./shared";

export { Room } from "./room";

function cors(env: Env, origin: string | null): Record<string, string> {
  // only needed locally (site on :4321, rooms on :8787). in prod it's all edwrdq.com.
  return env.DEV && origin ? { "access-control-allow-origin": origin, vary: "origin" } : {};
}
function reply(env: Env, origin: string | null, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(env, origin) },
  });
}

async function makeRoom(env: Env, game: (typeof GAMES)[number]["id"], pub: boolean) {
  for (let i = 0; i < 6; i++) {
    const code = newCode(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32);
    const taken = await env.DB.prepare("SELECT 1 FROM rooms WHERE code = ?").bind(code).first();
    if (taken) continue;
    if (await env.ROOM.get(env.ROOM.idFromName(code)).init(code, game, pub)) return code;
  }
  return null;
}

export default {
  // every 30 min: rooms whose row hasn't changed in 30 min check their own clean-up (see Room.check).
  // rooms close themselves via alarms; this only catches one that somehow lost its alarm.
  async scheduled(_event: ScheduledController, env: Env) {
    const { results } = await env.DB.prepare("SELECT code FROM rooms WHERE updated_at < unixepoch() - 1800 LIMIT 100").all<{ code: string }>();
    for (const { code } of results) {
      const r = await env.ROOM.get(env.ROOM.idFromName(code)).check().catch(() => "error");
      if (r === "gone") await env.DB.prepare("DELETE FROM rooms WHERE code = ?").bind(code).run();
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const onion = isOnion(request, env);
    const allowed = env.ORIGINS.split(",").map((s) => s.trim());
    if (onion && ONION_ADDRESS) allowed.push(`http://${ONION_ADDRESS}`);
    if (!origin || !allowed.includes(origin)) return new Response("forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, origin) });
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });

    const s = await settings(env);
    if (s.playOff) return reply(env, origin, { ok: false, error: "multiplayer is off right now. try again later." }, 503);

    const ip = request.headers.get("cf-connecting-ip") ?? (env.DEV ? "127.0.0.1" : "");
    // tor visitors all arrive from the vps: no ip hash for them (an ip ban would ban all of tor).
    // they're limited and banned by session instead.
    let ipHash: string;
    try {
      ipHash = onion ? "" : await hash(env, "ip", ip);
    } catch {
      return reply(env, origin, { ok: false, error: "rooms aren't set up yet." }, 503);
    }

    const parts = url.pathname.split("/").filter(Boolean); // ["ws", ...]
    const game = url.searchParams.get("game");

    if (parts[1] === "new" || parts[1] === "quick") {
      if (!isGame(game)) return reply(env, origin, { ok: false, error: "no such game." }, 400);
      if (await banned(env, null, ipHash)) return reply(env, origin, { ok: false, error: "you can't join rooms right now." }, 403);
      if (parts[1] === "quick") {
        const open = await env.DB.prepare(
          "SELECT code FROM rooms WHERE game = ? AND public = 1 AND state = 'lobby' AND players > 0 AND players < max ORDER BY players DESC, updated_at DESC LIMIT 1",
        )
          .bind(game)
          .first<{ code: string }>();
        if (open) return reply(env, origin, { ok: true, code: open.code });
      }
      const sid = url.searchParams.get("s") ?? "";
      const key = onion ? `onion:${await hash(env, "sid", sid.slice(0, 64) || "none")}` : ipHash;
      const { success } = await env.CREATE_LIMIT.limit({ key });
      if (!success) return reply(env, origin, { ok: false, error: "slow down. try again in a minute." }, 429);
      const code = await makeRoom(env, game, parts[1] === "quick" || url.searchParams.get("public") === "1");
      return code ? reply(env, origin, { ok: true, code }) : reply(env, origin, { ok: false, error: "couldn't make a room. try again." }, 500);
    }

    if (parts[1] === "room" && isCode(parts[2]) && parts.length === 3) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected a websocket", { status: 426 });
      // the room checks bans (it needs the session too), seats, everything else
      const headers = new Headers(request.headers);
      headers.set("x-ip-hash", ipHash); // overwritten, never trusted from the client
      const stub = env.ROOM.get(env.ROOM.idFromName(parts[2]));
      return stub.fetch(new Request(request, { headers }));
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
