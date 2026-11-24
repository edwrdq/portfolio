// browser side of a room: your identity (localStorage), the http calls (new / quick), and a
// websocket that reconnects on its own. refresh within ~30s and the server gives you your seat back.
import { randomName } from "./names.ts";
import { PROTOCOL, CLOSE, type ClientMsg, type ServerMsg } from "./protocol.ts";

const KEY = "edwrdq-play-v1";
type Ident = { sid: string; name: string };

function randomSid() {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let memory: Ident | null = null; // fallback when storage is blocked
export function identity(): Ident {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Ident> | null;
    if (raw && typeof raw.sid === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(raw.sid) && typeof raw.name === "string") return { sid: raw.sid, name: raw.name };
  } catch {
    /* blocked or corrupt */
  }
  memory ??= { sid: randomSid(), name: randomName() };
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* fine, memory only */
  }
  return memory;
}
export function saveName(name: string) {
  const id = { ...identity(), name };
  memory = id;
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* memory only */
  }
}

/** where the rooms worker lives: same origin in prod, :8787 when the site runs on astro dev */
function base() {
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return local ? `${location.protocol}//${location.hostname}:8787` : location.origin;
}

export async function getCode(kind: "new" | "quick", game: string, pub = false): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${base()}/ws/${kind}?game=${encodeURIComponent(game)}${pub ? "&public=1" : ""}`);
    const j = (await res.json().catch(() => null)) as { ok?: boolean; code?: string; error?: string } | null;
    if (res.ok && j?.ok && j.code) return { ok: true, code: j.code };
    return { ok: false, error: j?.error ?? "couldn't reach the rooms. try again." };
  } catch {
    return { ok: false, error: "couldn't reach the rooms. try again." };
  }
}

export type ConnState = "connecting" | "open" | "reconnecting" | "closed";

/** one room connection. retries with backoff until the server says bye (kicked, full, gone…). */
export class RoomSocket {
  private ws: WebSocket | null = null;
  private tries = 0;
  private ping: ReturnType<typeof setInterval> | undefined;
  private done = false;

  constructor(
    private code: string,
    private on: { msg: (m: ServerMsg) => void; state: (s: ConnState) => void },
  ) {}

  connect() {
    if (this.done) return;
    this.on.state(this.tries ? "reconnecting" : "connecting");
    const url = `${base().replace(/^http/, "ws")}/ws/room/${this.code}`;
    const ws = (this.ws = new WebSocket(url));
    ws.onopen = () => {
      const { sid, name } = identity();
      this.raw({ t: "hello", v: PROTOCOL, sid, name });
      clearInterval(this.ping);
      this.ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25_000); // answered without waking the room
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === "welcome") {
        this.tries = 0;
        this.on.state("open");
      }
      if (m.t === "bye") this.done = true;
      this.on.msg(m);
    };
    ws.onclose = (e) => {
      clearInterval(this.ping);
      if (this.done || e.code === CLOSE.bye) {
        this.done = true;
        return this.on.state("closed");
      }
      this.tries++;
      if (this.tries > 8) {
        this.done = true;
        this.on.msg({ t: "bye", reason: "bad" });
        return this.on.state("closed");
      }
      this.on.state("reconnecting");
      setTimeout(() => this.connect(), Math.min(8000, 400 * 2 ** this.tries) + Math.random() * 300);
    };
  }

  private raw(m: ClientMsg) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }
  send(m: Exclude<ClientMsg, { t: "hello" }>) {
    return this.raw(m);
  }
  close() {
    this.done = true;
    this.ws?.close();
  }
}
