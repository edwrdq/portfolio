// one durable object per room. hibernatable websockets: an idle room costs nothing, and its
// state lives in its own storage so it survives hibernation. when the last human leaves (after
// the 30s reconnect window) the room deletes everything it stored and its row in d1.
//
// stored in the room (wiped on close): seats (hashed session, nickname), the last 50 chat lines.
// stored in d1: the room's row (code, game, player count) and only *reported* messages.
import { DurableObject } from "cloudflare:workers";
import { gameInfo, type GameId } from "@edwrdq/rooms";
import { checkChat, nameAllowed, REASON } from "@edwrdq/rooms/filter";
import { cleanName, randomName } from "@edwrdq/rooms/names";
import { CLOSE, PROTOCOL, type ByeReason, type ChatMsg, type ClientMsg, type RoomView, type ServerMsg } from "@edwrdq/rooms/protocol";
import { banned, hash, isSid, settings } from "./shared";
import * as auction from "@edwrdq/rooms/auction";
import * as arena from "@edwrdq/rooms/arena";

type Game = { kind: "auction"; s: auction.AuctionState } | { kind: "arena"; s: arena.ArenaState };

const GRACE_MS = 30_000; // refresh → back in your seat
const UNJOINED_MS = 2 * 60_000; // a room nobody ever joins closes after this
const KICK_MS = 10 * 60_000; // kicked players can't rejoin the same room for this long
const CHAT_KEEP = 50;
const MAX_FRAME = 4096; // arena programs ride in one frame

// chat rate limits
const GAP_MS = 1000; // 1 message / sec
const BURST = 10; // 10 per 30s
const BURST_MS = 30_000;
const SLOW_TRIGGER = 15; // this many room-wide messages in 10s → slow mode
const SLOW_WINDOW_MS = 10_000;
const SLOW_GAP_MS = 5000; // slow mode: 1 message / 5s each
const SLOW_FOR_MS = 60_000;

type Human = { bot: false; sidHash: string; ipHash: string; nick: string; leftAt: number | null };
type Bot = { bot: true; nick: string };
type Seat = Human | Bot | null;
type State = {
  code: string;
  game: GameId;
  public: boolean;
  state: "lobby" | "playing";
  host: number;
  seats: Seat[];
  createdAt: number;
  muted: string[];
  kicked: Record<string, number>;
  /** the running game, or the last finished one (its results stay up until the next start) */
  match?: Game | null;
};
type Attach = { ipHash: string; sidHash: string | null; seat: number };

const isHuman = (s: Seat): s is Human => !!s && !s.bot;

export class Room extends DurableObject<Env> {
  private st: State | null | undefined; // undefined = not loaded yet, null = no room here
  private sent = new Map<string, number[]>(); // sidHash → recent chat times (memory only)
  private roomTimes: number[] = [];
  private slowUntil = 0;
  private lastName = new Map<string, number>();
  private lastReport = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, seat INTEGER, nick TEXT, body TEXT, sys INTEGER, sid_hash TEXT, ip_hash TEXT)",
      );
      this.st = (await ctx.storage.get<State>("room")) ?? null;
    });
    // keepalive pings are answered without waking the room
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---------------------------------------------------------------- lifecycle

  /** called by the worker when a code is handed out. false if the code is already a room. */
  async init(code: string, game: GameId, pub: boolean) {
    if (this.st) return false;
    this.st = { code, game, public: pub, state: "lobby", host: -1, seats: Array(gameInfo(game).max).fill(null), createdAt: Date.now(), muted: [], kicked: {} };
    await this.save();
    await this.env.DB.prepare("INSERT INTO rooms (code, game, public, max) VALUES (?, ?, ?, ?)").bind(code, game, pub ? 1 : 0, gameInfo(game).max).run();
    await this.ctx.storage.setAlarm(Date.now() + UNJOINED_MS);
    return true;
  }

  private async save() {
    if (this.st) await this.ctx.storage.put("room", this.st);
  }

  /** mirror the bits quick play + admin need into d1 */
  private async sync() {
    const s = this.st;
    if (!s) return;
    await this.env.DB.prepare("UPDATE rooms SET public = ?, state = ?, players = ?, updated_at = unixepoch() WHERE code = ?")
      .bind(s.public ? 1 : 0, s.state, s.seats.filter(isHuman).length, s.code)
      .run()
      .catch((e) => console.error("room sync", e));
  }

  private async close(reason: ByeReason) {
    this.stopLoop();
    const code = this.st?.code;
    for (const ws of this.ctx.getWebSockets()) this.bye(ws, reason);
    this.st = null;
    await this.ctx.storage.deleteAll(); // seats, chat, alarm — all gone
    if (code) await this.env.DB.prepare("DELETE FROM rooms WHERE code = ?").bind(code).run();
  }

  /** next thing that needs a wake-up: a seat's reconnect window, slow mode ending, the unjoined timeout */
  private async schedule() {
    const s = this.st;
    if (!s) return;
    const times = s.seats.filter(isHuman).flatMap((h) => (h.leftAt ? [h.leftAt + GRACE_MS] : []));
    if (this.slowUntil > Date.now()) times.push(this.slowUntil);
    const g = this.gameWake();
    if (g !== null) times.push(g);
    if (!s.seats.some(isHuman)) times.push(Date.now() + GRACE_MS);
    // whole ms, a little in the future: an alarm for "right now" can be dropped
    if (times.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 10, Math.ceil(Math.min(...times))));
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    const s = this.st;
    if (!s) return void (await this.ctx.storage.deleteAll());
    const now = Date.now();
    let changed = false;
    s.seats.forEach((seat, i) => {
      if (isHuman(seat) && seat.leftAt && now - seat.leftAt >= GRACE_MS) {
        if (s.state === "playing") {
          // mid-game: a bot takes over the seat so the game keeps going
          s.seats[i] = { bot: true, nick: seat.nick };
          if (s.match?.kind === "auction") auction.botify(s.match.s, i);
          if (s.match?.kind === "arena") arena.botify(s.match.s, i);
          this.sys(`${seat.nick} left. a bot took over.`);
        } else {
          s.seats[i] = null;
          this.sys(`${seat.nick} left.`);
        }
        changed = true;
      }
    });
    if (s.state === "playing" && s.seats.some(isHuman)) {
      try {
        await this.gameTick(now);
      } catch (e) {
        // never let a game bug wedge the room's clock
        console.error("game tick", e);
      }
    }
    if (!s.seats.some(isHuman)) return this.close("closed");
    if (this.slowUntil && now >= this.slowUntil) {
      this.slowUntil = 0;
      this.sys("slow mode off.");
      changed = true;
    }
    if (changed) {
      this.fixHost();
      await this.save();
      await this.sync();
      this.broadcastRoom();
    }
    await this.schedule();
  }

  private fixHost() {
    const s = this.st!;
    const ok = (i: number) => isHuman(s.seats[i]) && !(s.seats[i] as Human).leftAt;
    if (s.host >= 0 && isHuman(s.seats[s.host])) {
      // keep the host through a refresh; hand it over only once they're gone for good
      return;
    }
    const next = s.seats.findIndex((_, i) => ok(i));
    s.host = next >= 0 ? next : s.seats.findIndex(isHuman);
  }

  // ---------------------------------------------------------------- sockets

  async fetch(request: Request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected a websocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ipHash: request.headers.get("x-ip-hash") ?? "", sidHash: null, seat: -1 } satisfies Attach);
    return new Response(null, { status: 101, webSocket: client });
  }

  private att(ws: WebSocket) {
    return ws.deserializeAttachment() as Attach;
  }
  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }
  private bye(ws: WebSocket, reason: ByeReason) {
    this.send(ws, { t: "bye", reason });
    try {
      ws.close(CLOSE.bye, reason);
    } catch {
      /* already closed */
    }
  }
  private notice(ws: WebSocket, text: string) {
    this.send(ws, { t: "notice", text });
  }
  /** sockets that have said hello and hold a seat */
  private members() {
    return this.ctx.getWebSockets().filter((ws) => this.att(ws).seat >= 0);
  }

  private view(): RoomView {
    const s = this.st!;
    return {
      code: s.code,
      game: s.game,
      public: s.public,
      state: s.state,
      host: s.host,
      seats: s.seats.map((x) => (x ? { nick: x.nick, bot: x.bot, online: x.bot || !x.leftAt } : null)),
      slow: this.slowUntil > Date.now(),
      chat: !this.chatOffCache,
    };
  }
  private chatOffCache = false;
  private broadcastRoom() {
    const room = this.view();
    for (const ws of this.members()) this.send(ws, { t: "room", room });
  }

  private recentChat(): ChatMsg[] {
    return this.ctx.storage.sql
      .exec<{ id: number; at: number; seat: number | null; nick: string; body: string; sys: number }>("SELECT id, at, seat, nick, body, sys FROM chat ORDER BY id DESC LIMIT ?", CHAT_KEEP)
      .toArray()
      .reverse()
      .map((r) => ({ id: r.id, at: r.at, seat: r.seat, nick: r.nick, body: r.body, ...(r.sys ? { sys: true } : {}) }));
  }

  private store(m: Omit<ChatMsg, "id">, sidHash: string | null, ipHash: string | null) {
    const sql = this.ctx.storage.sql;
    const id = sql
      .exec<{ id: number }>("INSERT INTO chat (at, seat, nick, body, sys, sid_hash, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id", m.at, m.seat, m.nick, m.body, m.sys ? 1 : 0, sidHash, ipHash)
      .one().id;
    sql.exec("DELETE FROM chat WHERE id <= ?", id - CHAT_KEEP);
    return { ...m, id } as ChatMsg;
  }
  private sys(body: string) {
    const msg = this.store({ at: Date.now(), seat: null, nick: "", body, sys: true }, null, null);
    for (const ws of this.members()) this.send(ws, { t: "chat", msg });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_FRAME) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const a = this.att(ws);
    if (!this.st) return this.bye(ws, "gone");
    if (msg.t === "hello") return this.hello(ws, a, msg);
    if (a.seat < 0 || !a.sidHash) return; // must say hello first
    const seat = this.st.seats[a.seat];
    if (!isHuman(seat) || seat.sidHash !== a.sidHash) return this.bye(ws, "closed");
    switch (msg.t) {
      case "chat":
        return this.chat(ws, a, seat, msg.text);
      case "name":
        return this.rename(ws, a, seat, msg.name);
      case "report":
        return this.report(ws, a, msg.id);
      case "public":
        if (a.seat !== this.st.host || typeof msg.on !== "boolean") return;
        this.st.public = msg.on;
        await this.save();
        await this.sync();
        return this.broadcastRoom();
      case "start": {
        if (a.seat !== this.st.host) return this.notice(ws, "only the host can start.");
        const g = gameInfo(this.st.game);
        if (!g.ready) return this.notice(ws, `${g.name} isn't open yet. the lobby works though.`);
        if (this.st.state !== "lobby") return;
        return this.startGame(ws, msg.opts);
      }
      case "g": {
        if (this.st.state !== "playing" || !this.st.match || !msg.x || typeof msg.x !== "object") return;
        return this.gameAction(ws, a.seat, msg.x);
      }
    }
  }

  private async hello(ws: WebSocket, a: Attach, msg: Extract<ClientMsg, { t: "hello" }>) {
    const s = this.st!;
    if (a.seat >= 0) return; // once per socket
    if (msg.v !== PROTOCOL || !isSid(msg.sid)) return this.bye(ws, "bad");
    const set = await settings(this.env);
    this.chatOffCache = set.chatOff;
    if (set.playOff) return this.bye(ws, "off");
    const sidHash = await hash(this.env, "sid", msg.sid);
    if ((s.kicked[sidHash] ?? 0) > Date.now()) return this.bye(ws, "kicked");
    if (await banned(this.env, sidHash, a.ipHash)) return this.bye(ws, "banned");

    let i = s.seats.findIndex((x) => isHuman(x) && x.sidHash === sidHash);
    const back = i >= 0;
    if (back) {
      // same session again (refresh, second tab): the newest socket gets the seat
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && this.att(other).sidHash === sidHash) {
          other.serializeAttachment({ ...this.att(other), seat: -1 });
          this.bye(other, "replaced");
        }
      }
      (s.seats[i] as Human).leftAt = null;
      (s.seats[i] as Human).ipHash = a.ipHash;
    } else {
      if (s.state !== "lobby") return this.bye(ws, "started");
      i = s.seats.findIndex((x) => x === null);
      if (i < 0) return this.bye(ws, "full");
      let nick = cleanName(msg.name);
      if (!nick || !nameAllowed(nick, set.rules)) nick = randomName();
      s.seats[i] = { bot: false, sidHash, ipHash: a.ipHash, nick: this.unique(nick, i), leftAt: null };
    }
    if (s.host < 0 || !isHuman(s.seats[s.host])) s.host = i;
    ws.serializeAttachment({ ...a, sidHash, seat: i } satisfies Attach);
    await this.save();
    const seat = s.seats[i] as Human;
    this.send(ws, { t: "welcome", you: i, name: seat.nick, room: this.view(), chat: this.recentChat() });
    this.sendGame(ws, i);
    if (!back) this.sys(`${seat.nick} joined.`);
    this.broadcastRoom();
    await this.sync();
    await this.schedule();
  }

  /** nicknames are unique per room: rusty-civic-42 → rusty-civic-42-2 */
  private unique(nick: string, seat: number) {
    const taken = (n: string) => this.st!.seats.some((x, j) => j !== seat && x && x.nick === n);
    if (!taken(nick)) return nick;
    for (let k = 2; ; k++) {
      const n = `${nick.slice(0, 20 - String(k).length - 1)}-${k}`;
      if (!taken(n)) return n;
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.left(ws);
  }
  async webSocketError(ws: WebSocket) {
    await this.left(ws);
  }
  private async left(ws: WebSocket) {
    const a = this.att(ws);
    const s = this.st;
    if (!s || a.seat < 0 || !a.sidHash) return;
    const seat = s.seats[a.seat];
    if (!isHuman(seat) || seat.sidHash !== a.sidHash) return;
    // another socket for the same session still open? then they're still here
    if (this.ctx.getWebSockets().some((o) => o !== ws && this.att(o).sidHash === a.sidHash && this.att(o).seat === a.seat)) return;
    seat.leftAt = Date.now();
    await this.save();
    this.broadcastRoom();
    await this.schedule();
  }

  // ---------------------------------------------------------------- chat

  private async chat(ws: WebSocket, a: Attach, seat: Human, text: unknown) {
    const set = await settings(this.env);
    this.chatOffCache = set.chatOff;
    if (set.chatOff) return this.notice(ws, "chat is off right now.");
    if (this.st!.muted.includes(seat.sidHash)) return this.notice(ws, "you're muted in this room.");

    const now = Date.now();
    const mine = (this.sent.get(seat.sidHash) ?? []).filter((t) => now - t < BURST_MS);
    const slow = this.slowUntil > now;
    const last = mine.at(-1) ?? 0;
    if (now - last < (slow ? SLOW_GAP_MS : GAP_MS) || mine.length >= BURST) return this.notice(ws, slow ? "slow mode. one message every 5 seconds." : "slow down.");

    const v = checkChat(text, set.rules);
    if (!v.ok) return this.notice(ws, REASON[v.reason]);

    mine.push(now);
    this.sent.set(seat.sidHash, mine);
    this.roomTimes = [...this.roomTimes.filter((t) => now - t < SLOW_WINDOW_MS), now];

    const msg = this.store({ at: now, seat: a.seat, nick: seat.nick, body: v.text }, seat.sidHash, seat.ipHash);
    for (const m of this.members()) this.send(m, { t: "chat", msg });

    if (!slow && this.roomTimes.length >= SLOW_TRIGGER) {
      this.slowUntil = now + SLOW_FOR_MS;
      this.sys("slow mode on. one message every 5 seconds.");
      this.broadcastRoom();
      await this.schedule();
    }
  }

  private async rename(ws: WebSocket, a: Attach, seat: Human, raw: unknown) {
    const now = Date.now();
    if (now - (this.lastName.get(seat.sidHash) ?? 0) < 3000) return this.notice(ws, "one name change every few seconds.");
    const nick = cleanName(raw);
    if (!nick) return this.notice(ws, "names are 2–20 letters, numbers or dashes.");
    const set = await settings(this.env);
    if (!nameAllowed(nick, set.rules)) return this.notice(ws, "name blocked.");
    if (nick === seat.nick) return this.send(ws, { t: "name", name: nick });
    if (this.st!.seats.some((x, j) => j !== a.seat && x?.nick === nick)) return this.notice(ws, "someone here already has that name.");
    this.lastName.set(seat.sidHash, now);
    const old = seat.nick;
    seat.nick = nick;
    await this.save();
    this.send(ws, { t: "name", name: nick });
    this.sys(`${old} is now ${nick}.`);
    this.broadcastRoom();
  }

  private async report(ws: WebSocket, a: Attach, id: unknown) {
    if (typeof id !== "number") return;
    const now = Date.now();
    const recent = (this.lastReport.get(a.sidHash!) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 5) return this.notice(ws, "that's a lot of reports. eddy will look.");
    const row = this.ctx.storage.sql
      .exec<{ at: number; nick: string; body: string; sys: number; sid_hash: string | null; ip_hash: string | null }>("SELECT at, nick, body, sys, sid_hash, ip_hash FROM chat WHERE id = ?", id)
      .toArray()[0];
    if (!row || row.sys || !row.sid_hash) return this.notice(ws, "that message is gone.");
    if (row.sid_hash === a.sidHash) return this.notice(ws, "you can't report yourself.");
    this.lastReport.set(a.sidHash!, [...recent, now]);
    await this.env.DB.prepare(
      "INSERT OR IGNORE INTO room_reports (code, game, nick, body, sent_at, sid_hash, ip_hash, reporter_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(this.st!.code, this.st!.game, row.nick, row.body, row.at, row.sid_hash, row.ip_hash, a.sidHash)
      .run();
    this.notice(ws, "reported. thanks.");
  }

  // ---------------------------------------------------------------- games

  private async startGame(ws: WebSocket, opts?: Record<string, unknown>) {
    const s = this.st!;
    const seed = crypto.randomUUID();
    const now = Date.now();
    const humans = s.seats.filter(isHuman).length;
    const mode = s.game === "arena" && opts?.mode === "1v1" ? "1v1" : "2v2";
    if (s.game === "arena" && mode === "1v1" && humans > 2) return this.notice(ws, "1v1 is two players. switch to 2v2.");
    // bots fill empty seats, up to a sensible table size
    const fillTo = s.game === "arena" ? (mode === "1v1" ? 2 : 4) : auction.FILL_TO;
    for (let i = 0, bots = 0; i < s.seats.length && humans + bots < fillTo; i++) {
      if (s.seats[i] === null) {
        s.seats[i] = { bot: true, nick: this.unique(randomName().replace(/-\d+$/, "-bot"), i) };
        bots++;
      }
    }
    const seats = s.seats.flatMap((x, i) => (x ? [{ seat: i, nick: x.nick, bot: x.bot }] : []));
    // FAST=1 (local testing only, never set in prod) runs the auction clock ~7× faster
    const k = this.env.DEV && this.env.FAST ? 0.15 : 1;
    s.match = s.game === "arena" ? { kind: "arena", s: arena.createArena(seats, mode, now, seed) } : { kind: "auction", s: auction.createAuction(seed, seats, now, k) };
    s.state = "playing";
    await this.save();
    await this.sync();
    this.sys(s.game === "arena" ? "match starting. write your autonomous." : "the auction is starting. good luck.");
    this.broadcastRoom();
    this.broadcastGame();
    if (s.match.kind === "arena") this.startLoop();
    await this.schedule();
  }

  // ---- arena runs on a fixed 20Hz loop while a match is live (the room can't hibernate then,
  // which is the point: it's only for the ~2.5 minutes of a match)
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastPersist = 0;
  private startLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => void this.arenaTick().catch((e) => console.error("arena tick", e)), arena.TICK_MS);
  }
  private stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }
  private async arenaTick() {
    const g = this.st?.match;
    if (!g || g.kind !== "arena" || this.st!.state !== "playing") return this.stopLoop();
    const w = g.s;
    const before = w.phase;
    arena.step(w, Date.now());
    if (w.phase === "done") {
      this.stopLoop();
      return this.endGame();
    }
    if (w.phase !== "program" || before !== w.phase) this.broadcastGame();
    // persist about once a second so a restart can pick the match back up
    if (Date.now() - this.lastPersist > 1000) {
      this.lastPersist = Date.now();
      await this.save();
    }
  }

  private async gameAction(ws: WebSocket, seat: number, x: Record<string, unknown>) {
    const g = this.st!.match!;
    if (g.kind === "auction") {
      const r = auction.act(g.s, seat, x as auction.Action, Date.now());
      if (!r.ok) return this.notice(ws, r.notice);
      await this.save();
      this.broadcastGame();
      await this.schedule();
    } else {
      const r = arena.act(g.s, seat, x as arena.ArenaAction);
      if (!r.ok) return this.notice(ws, r.notice);
      if (x.a === "prog") this.notice(ws, "program loaded.");
      if (r.changed) this.broadcastGame();
    }
  }

  private async gameTick(now: number) {
    const s = this.st!;
    const g = s.match;
    if (!g) return;
    if (g.kind === "arena") {
      // heartbeat: if the loop isn't running (the room restarted), pick the match back up
      if (!this.loop) this.startLoop();
      return;
    }
    if (g.kind === "auction" && auction.tick(g.s, now)) {
      if (g.s.phase === "done") await this.endGame();
      else {
        await this.save();
        this.broadcastGame();
      }
    }
  }

  /** back to the lobby: bots leave, the results stay up until the next start */
  private async endGame() {
    this.stopLoop();
    const s = this.st!;
    s.state = "lobby";
    s.seats = s.seats.map((x) => (x?.bot ? null : x));
    await this.save();
    await this.sync();
    this.sys(s.match?.kind === "arena" ? "match over. host can start a rematch." : "that's the last lot. host can start another round.");
    this.broadcastRoom();
    this.broadcastGame();
  }

  private gameWake(): number | null {
    const g = this.st?.match;
    if (!g || this.st!.state !== "playing") return null;
    return g.kind === "auction" ? auction.nextWake(g.s) : Date.now() + 2000;
  }

  private sendGame(ws: WebSocket, seat: number) {
    const g = this.st?.match;
    if (!g) return;
    if (g.kind === "auction") this.send(ws, { t: "game", g: auction.view(g.s, seat, Date.now()) });
    else this.send(ws, { t: "game", g: arena.snapshot(g.s) });
  }
  private broadcastGame() {
    const g = this.st?.match;
    if (g?.kind === "arena") {
      // same snapshot for everyone: build the frame once
      const frame = JSON.stringify({ t: "game", g: arena.snapshot(g.s) } satisfies ServerMsg);
      for (const ws of this.members()) {
        try {
          ws.send(frame);
        } catch {
          /* closing */
        }
      }
      return;
    }
    for (const ws of this.members()) this.sendGame(ws, this.att(ws).seat);
  }

  // ---------------------------------------------------------------- admin (rpc from admin → rooms)

  /** everything admin needs to see one room. hashes are shown shortened. */
  async peek() {
    const s = this.st;
    if (!s) return null;
    const online = new Set(this.members().map((ws) => this.att(ws).sidHash));
    return {
      code: s.code,
      game: s.game,
      public: s.public,
      state: s.state,
      host: s.host,
      createdAt: s.createdAt,
      slow: this.slowUntil > Date.now(),
      seats: s.seats.map((x) =>
        x === null ? null : x.bot ? { nick: x.nick, bot: true } : { nick: x.nick, bot: false, sid: x.sidHash, ip: x.ipHash, online: online.has(x.sidHash), muted: s.muted.includes(x.sidHash) },
      ),
      chat: this.ctx.storage.sql
        .exec<{ id: number; at: number; nick: string; body: string; sys: number; sid_hash: string | null }>("SELECT id, at, nick, body, sys, sid_hash FROM chat ORDER BY id DESC LIMIT ?", CHAT_KEEP)
        .toArray()
        .reverse(),
    };
  }

  /** mute / unmute / kick one session, or close the whole room */
  async moderate(action: "mute" | "unmute" | "kick" | "close", sidHash?: string) {
    const s = this.st;
    if (!s) return false;
    if (action === "close") {
      await this.close("closed");
      return true;
    }
    if (!sidHash) return false;
    if (action === "mute" && !s.muted.includes(sidHash)) s.muted.push(sidHash);
    if (action === "unmute") s.muted = s.muted.filter((m) => m !== sidHash);
    if (action === "kick") {
      s.kicked[sidHash] = Date.now() + KICK_MS;
      this.drop((h) => h.sidHash === sidHash, "kicked");
    }
    await this.save();
    await this.sync();
    this.broadcastRoom();
    if (!s.seats.some(isHuman)) await this.close("closed");
    else await this.schedule();
    return true;
  }

  /** a ban just landed in d1: throw out anyone matching either hash */
  async enforceBan(sidHash: string | null, ipHash: string | null) {
    const s = this.st;
    if (!s) return 0;
    const n = this.drop((h) => (!!sidHash && h.sidHash === sidHash) || (!!ipHash && h.ipHash === ipHash), "banned");
    if (!n) return 0;
    await this.save();
    await this.sync();
    this.broadcastRoom();
    if (!s.seats.some(isHuman)) await this.close("closed");
    else await this.schedule();
    return n;
  }

  private drop(match: (h: Human) => boolean, reason: ByeReason) {
    const s = this.st!;
    let n = 0;
    s.seats.forEach((seat, i) => {
      if (!isHuman(seat) || !match(seat)) return;
      for (const ws of this.ctx.getWebSockets()) {
        if (this.att(ws).sidHash === seat.sidHash) {
          ws.serializeAttachment({ ...this.att(ws), seat: -1 });
          this.bye(ws, reason);
        }
      }
      s.seats[i] = null;
      this.sys(`${seat.nick} was removed.`);
      n++;
    });
    this.fixHost();
    return n;
  }

  /** cron safety net: a room whose row looks stale makes sure its own clean-up is still scheduled */
  async check() {
    if (!this.st) {
      await this.ctx.storage.deleteAll();
      return "gone";
    }
    const connected = this.members().length > 0;
    if (!connected && !(await this.ctx.storage.getAlarm())) {
      // nobody's here and nothing will wake us: treat everyone as just left
      for (const seat of this.st.seats) if (isHuman(seat) && !seat.leftAt) seat.leftAt = Date.now();
      await this.save();
      await this.schedule();
      return "rescheduled";
    }
    return "ok";
  }

  /** settings changed in admin: pick them up now instead of in 30s */
  async refresh() {
    const set = await settings(this.env, true);
    this.chatOffCache = set.chatOff;
    if (!this.st) return;
    if (set.playOff) return this.close("off");
    this.broadcastRoom();
  }
}
