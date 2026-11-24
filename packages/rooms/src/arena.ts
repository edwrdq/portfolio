// arena: a vex-style top-down robot game. this module is shared: the room's durable object runs
// the real match (authoritative, fixed 20Hz tick), and the browser runs the same driveStep() to
// predict your own robot between snapshots.
//
// units are inches on a 144×144 field (6×6 tiles of 24, like a real vex field). heading is radians,
// 0 = facing right (+x), positive = clockwise on screen (y grows downward).
import { rng } from "@edwrdq/daily";

export const FIELD = 144;
export const TILE = 24;
export const TICK_MS = 50;
export const ROBOT_R = 9; // robots collide as circles
export const ROBOT_SIZE = 16; // drawn as squares
export const BLOCK_R = 3;
export const HOLD_MAX = 2;
export const MAX_SPEED = 54; // in/s
export const ACCEL = 220; // in/s²
export const TURN_RATE = Math.PI; // rad/s (180°/s)
export const PTS = { block: 3, auton: 8, park: 6 } as const;
export const T = { program: 45_000, auton: 15_000, driver: 105_000 } as const;

export type Team = "acid" | "bone";
export type Rect = { x: number; y: number; w: number; h: number };
export const GOALS: Record<Team, Rect[]> = {
  acid: [
    { x: 0, y: 0, w: 24, h: 24 },
    { x: 0, y: 120, w: 24, h: 24 },
  ],
  bone: [
    { x: 120, y: 0, w: 24, h: 24 },
    { x: 120, y: 120, w: 24, h: 24 },
  ],
};
export const PARK: Record<Team, Rect> = { acid: { x: 0, y: 60, w: 20, h: 24 }, bone: { x: 124, y: 60, w: 20, h: 24 } };
const inside = (r: Rect, x: number, y: number, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

// blocks: mirrored left/right so neither side is favored
const HALF: [number, number][] = [
  [48, 72], [54, 48], [54, 96], [60, 24], [60, 120], [40, 36], [40, 108], [66, 60], [66, 84],
];
export const START_BLOCKS: [number, number][] = [[72, 72], [72, 30], [72, 114], ...HALF.flatMap(([x, y]) => [[x, y], [FIELD - x, y]] as [number, number][])];

// starting spots: two per team, facing the middle
const STARTS: Record<Team, { x: number; y: number; h: number }[]> = {
  acid: [
    { x: 30, y: 44, h: 0 },
    { x: 30, y: 100, h: 0 },
  ],
  bone: [
    { x: 114, y: 44, h: Math.PI },
    { x: 114, y: 100, h: Math.PI },
  ],
};

// ------------------------------------------------------------------ driving

export type Input = { th: number; tu: number }; // throttle −1..1 (forward +), turn −1..1 (clockwise +)
export type Robot = {
  seat: number;
  nick: string;
  team: Team;
  bot: boolean;
  x: number;
  y: number;
  h: number;
  v: number; // forward speed, in/s
  held: number;
  scored: number;
  autonScored: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp1 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, -1, 1) : 0);
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** motion + walls for one robot. the browser runs exactly this to predict its own robot. */
export function driveStep(r: Pick<Robot, "x" | "y" | "h" | "v">, input: Input, dt: number) {
  const target = clamp1(input.th) * MAX_SPEED;
  const dv = target - r.v;
  r.v += clamp(dv, -ACCEL * dt, ACCEL * dt);
  // turning slows you down a little, like a real drivetrain
  const turn = clamp1(input.tu) * TURN_RATE * (1 - 0.35 * Math.abs(r.v) / MAX_SPEED);
  r.h = wrap(r.h + turn * dt);
  r.x = clamp(r.x + Math.cos(r.h) * r.v * dt, ROBOT_R, FIELD - ROBOT_R);
  r.y = clamp(r.y + Math.sin(r.h) * r.v * dt, ROBOT_R, FIELD - ROBOT_R);
}

const front = (r: Robot) => ({ x: r.x + Math.cos(r.h) * (ROBOT_R + 1), y: r.y + Math.sin(r.h) * (ROBOT_R + 1) });

// ------------------------------------------------------------------ autonomous programs

export type Cmd = { op: "forward" | "back"; tiles: number } | { op: "turn"; deg: number } | { op: "intake" | "release" } | { op: "wait"; s: number };
export const PROGRAM_MAX = 24;
export const PROGRAM_HELP = ["forward 2      drive 2 tiles (a tile is 24in)", "back 1.5       reverse", "turn 90        turn right 90° (negative = left)", "intake         grab a block in front", "release        drop what you hold (in your goal = points)", "wait 0.5       pause, in seconds"];

/** parse a program. returns commands, or the first error with its line number. */
export function parseProgram(src: string): { ok: true; cmds: Cmd[] } | { ok: false; line: number; error: string } {
  const cmds: Cmd[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/(#|\/\/).*/, "").trim().toLowerCase();
    if (!line) continue;
    if (cmds.length >= PROGRAM_MAX) return { ok: false, line: i + 1, error: `${PROGRAM_MAX} commands max` };
    const [op, arg, extra] = line.split(/\s+/);
    const n = Number(arg);
    if (extra !== undefined) return { ok: false, line: i + 1, error: "one number per command" };
    if (op === "forward" || op === "fwd" || op === "back" || op === "backward") {
      if (!(n > 0 && n <= 6)) return { ok: false, line: i + 1, error: `${op} needs tiles, 0–6` };
      cmds.push({ op: op.startsWith("f") ? "forward" : "back", tiles: n });
    } else if (op === "turn") {
      if (!Number.isFinite(n) || Math.abs(n) > 360 || n === 0) return { ok: false, line: i + 1, error: "turn needs degrees, −360 to 360" };
      cmds.push({ op: "turn", deg: n });
    } else if (op === "left" || op === "right") {
      if (!(n > 0 && n <= 360)) return { ok: false, line: i + 1, error: `${op} needs degrees` };
      cmds.push({ op: "turn", deg: op === "left" ? -n : n });
    } else if (op === "intake" || op === "release") {
      if (arg !== undefined) return { ok: false, line: i + 1, error: `${op} takes no number` };
      cmds.push({ op });
    } else if (op === "wait") {
      if (!(n > 0 && n <= 15)) return { ok: false, line: i + 1, error: "wait needs seconds, 0–15" };
      cmds.push({ op: "wait", s: n });
    } else return { ok: false, line: i + 1, error: `unknown command "${op}"` };
  }
  return { ok: true, cmds };
}

type Runner = { cmds: Cmd[]; i: number; start: { x: number; y: number; h: number } | null; t: number };
const newRunner = (cmds: Cmd[]): Runner => ({ cmds, i: 0, start: null, t: 0 });

/** one tick of a program: returns the drive input, and whether to fire the action */
function runAuton(run: Runner, r: Robot, dt: number): { input: Input; act: "intake" | "release" | null } {
  const idle = { input: { th: 0, tu: 0 }, act: null };
  const c = run.cmds[run.i];
  if (!c) return idle;
  const next = () => {
    run.i++;
    run.start = null;
    run.t = 0;
  };
  run.start ??= { x: r.x, y: r.y, h: r.h };
  run.t += dt;
  if (c.op === "intake" || c.op === "release") {
    next();
    return { input: { th: 0, tu: 0 }, act: c.op };
  }
  if (c.op === "wait") {
    if (run.t >= c.s) next();
    return idle;
  }
  if (c.op === "forward" || c.op === "back") {
    const want = c.tiles * TILE;
    const done = Math.hypot(r.x - run.start.x, r.y - run.start.y);
    // stuck on a wall or a robot: give up on this command after a while
    if (done >= want - 0.5 || run.t > want / MAX_SPEED + 1.5) {
      next();
      return idle;
    }
    const slow = clamp((want - done) / 10, 0.25, 1);
    return { input: { th: (c.op === "forward" ? 1 : -1) * slow, tu: 0 }, act: null };
  }
  // turn: relative to where this command started
  if (c.op !== "turn") return idle;
  const target = wrap(run.start.h + (c.deg * Math.PI) / 180);
  const err = wrap(target - r.h);
  if (Math.abs(err) < 0.03 || run.t > Math.abs(c.deg) / 180 + 1.5) {
    next();
    return idle;
  }
  return { input: { th: 0, tu: clamp(err * 2.5, -1, 1) }, act: null };
}

// ------------------------------------------------------------------ bots

const BOT_PROGRAMS: string[] = [
  "forward 1.5\nintake\nturn 180\nforward 1\nrelease",
  "forward 1\nturn -30\nforward 1\nintake\nback 1\nturn -150\nforward 1.5\nrelease",
  "turn 30\nforward 1.2\nintake\nforward 0.5\nintake",
];

function botInput(w: ArenaState, r: Robot): { input: Input; act: boolean } {
  const goals = GOALS[r.team];
  const late = w.phase === "driver" && w.ends - w.now < 9000;
  let tx: number, ty: number, act = false;
  const near = (x: number, y: number) => Math.hypot(x - r.x, y - r.y);
  const defender = r.seat % 2 === 1 && w.blocks.length < 8;
  if (late) {
    // park for the bonus
    const p = PARK[r.team];
    tx = p.x + p.w / 2;
    ty = p.y + p.h / 2;
  } else if (r.held >= HOLD_MAX || (r.held > 0 && w.blocks.length === 0)) {
    const g = goals.map((g) => ({ g, d: near(g.x + g.w / 2, g.y + g.h / 2) })).sort((a, b) => a.d - b.d)[0].g;
    tx = g.x + g.w / 2;
    ty = g.y + g.h / 2;
    if (inside(g, r.x, r.y, 2)) act = true;
  } else if (defender) {
    const foe = w.robots.filter((o) => o.team !== r.team).sort((a, b) => b.held - a.held || near(a.x, a.y) - near(b.x, b.y))[0];
    tx = foe?.x ?? FIELD / 2;
    ty = foe?.y ?? FIELD / 2;
  } else {
    const b = [...w.blocks].sort((a, b2) => near(a[0], a[1]) - near(b2[0], b2[1]))[0];
    if (!b) return { input: { th: 0, tu: 0 }, act: false };
    [tx, ty] = b;
    const f = front(r);
    if (Math.hypot(f.x - tx, f.y - ty) < 8) act = true;
  }
  const err = wrap(Math.atan2(ty - r.y, tx - r.x) - r.h);
  const dist = near(tx, ty);
  return { input: { th: Math.abs(err) < 0.6 ? clamp(dist / 20, 0.35, 0.9) : 0.1, tu: clamp(err * 2, -1, 1) }, act };
}

// ------------------------------------------------------------------ the match

export type Phase = "program" | "auton" | "driver" | "done";
export type ArenaState = {
  mode: "1v1" | "2v2";
  phase: Phase;
  now: number;
  ends: number;
  tick: number;
  robots: Robot[];
  blocks: [number, number][];
  score: Record<Team, number>;
  autonBonus: Team | null;
  park: Record<Team, number>;
  programs: Record<number, string>;
  ready: Record<number, boolean>;
  inputs: Record<number, Input>;
  acts: Record<number, boolean>;
  runners: Record<number, Runner>;
};

export function createArena(seats: { seat: number; nick: string; bot: boolean }[], mode: "1v1" | "2v2", now: number, seed: string): ArenaState {
  const r = rng(`edwrdq:arena:${seed}`);
  // humans first, alternating teams, so two friends end up on opposite sides unless there are more
  const order = [...seats.filter((s) => !s.bot), ...seats.filter((s) => s.bot)].slice(0, mode === "1v1" ? 2 : 4);
  const count: Record<Team, number> = { acid: 0, bone: 0 };
  const robots = order.map((s, i) => {
    const team: Team = i % 2 === 0 ? "acid" : "bone";
    const st = STARTS[team][mode === "1v1" ? 0 : count[team]++];
    const y = mode === "1v1" ? FIELD / 2 : st.y;
    return { seat: s.seat, nick: s.nick, team, bot: s.bot, x: st.x, y, h: st.h, v: 0, held: 0, scored: 0, autonScored: 0 };
  });
  const programs: Record<number, string> = {};
  for (const ro of robots) if (ro.bot) programs[ro.seat] = r.pick(BOT_PROGRAMS);
  return {
    mode,
    phase: "program",
    now,
    ends: now + T.program,
    tick: 0,
    robots,
    blocks: START_BLOCKS.map(([x, y]) => [x, y] as [number, number]),
    score: { acid: 0, bone: 0 },
    autonBonus: null,
    park: { acid: 0, bone: 0 },
    programs,
    ready: Object.fromEntries(robots.filter((x) => x.bot).map((x) => [x.seat, true])),
    inputs: {},
    acts: {},
    runners: {},
  };
}

export type ArenaAction = { a: "prog"; text: string } | { a: "ready"; on: boolean } | { a: "in"; th: number; tu: number; act?: boolean };

export function act(w: ArenaState, seat: number, x: ArenaAction): { ok: true; changed: boolean } | { ok: false; notice: string } {
  const r = w.robots.find((o) => o.seat === seat);
  if (!r) return { ok: false, notice: "you're watching this one." };
  if (x.a === "prog") {
    if (w.phase !== "program") return { ok: false, notice: "programs lock when the match starts." };
    if (typeof x.text !== "string" || x.text.length > 2000) return { ok: false, notice: "program's too long." };
    const p = parseProgram(x.text);
    if (!p.ok) return { ok: false, notice: `line ${p.line}: ${p.error}` };
    w.programs[seat] = x.text;
    return { ok: true, changed: false };
  }
  if (x.a === "ready") {
    if (w.phase !== "program") return { ok: true, changed: false };
    w.ready[seat] = !!x.on;
    return { ok: true, changed: true };
  }
  if (x.a === "in") {
    if (w.phase !== "driver") return { ok: true, changed: false };
    w.inputs[seat] = { th: clamp1(x.th), tu: clamp1(x.tu) };
    if (x.act) w.acts[seat] = true;
    return { ok: true, changed: false };
  }
  return { ok: false, notice: "unknown action." };
}

/** intake if a block is in front and there's room; otherwise release (scores in your own goal) */
function doAction(w: ArenaState, r: Robot, want: "intake" | "release" | "auto") {
  const f = front(r);
  if (want !== "release" && r.held < HOLD_MAX) {
    const i = w.blocks.findIndex(([x, y]) => Math.hypot(x - f.x, y - f.y) < 7);
    const inGoal = GOALS[r.team].some((g) => inside(g, r.x, r.y, 2));
    if (i >= 0 && !(want === "auto" && inGoal && r.held > 0)) {
      w.blocks.splice(i, 1);
      r.held++;
      return;
    }
    if (want === "intake") return;
  }
  if (r.held === 0) return;
  if (GOALS[r.team].some((g) => inside(g, r.x, r.y, 2))) {
    const pts = r.held * PTS.block;
    w.score[r.team] += pts;
    r.scored += r.held;
    if (w.phase === "auton") r.autonScored += r.held;
    r.held = 0;
  } else {
    // drop them in front
    for (let k = 0; k < r.held; k++) {
      const side = (k - (r.held - 1) / 2) * 7;
      w.blocks.push([clamp(f.x + Math.cos(r.h) * 3 - Math.sin(r.h) * side, BLOCK_R, FIELD - BLOCK_R), clamp(f.y + Math.sin(r.h) * 3 + Math.cos(r.h) * side, BLOCK_R, FIELD - BLOCK_R)]);
    }
    r.held = 0;
  }
}

function collide(w: ArenaState) {
  const rs = w.robots;
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const overlap = ROBOT_R * 2 - d;
      if (overlap <= 0) continue;
      // the faster robot pushes harder
      const sa = Math.abs(a.v) + 1, sb = Math.abs(b.v) + 1;
      const pa = sb / (sa + sb), pb = sa / (sa + sb);
      a.x = clamp(a.x - (dx / d) * overlap * pa, ROBOT_R, FIELD - ROBOT_R);
      a.y = clamp(a.y - (dy / d) * overlap * pa, ROBOT_R, FIELD - ROBOT_R);
      b.x = clamp(b.x + (dx / d) * overlap * pb, ROBOT_R, FIELD - ROBOT_R);
      b.y = clamp(b.y + (dy / d) * overlap * pb, ROBOT_R, FIELD - ROBOT_R);
      a.v *= 0.85;
      b.v *= 0.85;
    }
  // robots shove loose blocks
  for (const r of rs)
    for (const blk of w.blocks) {
      const dx = blk[0] - r.x, dy = blk[1] - r.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const overlap = ROBOT_R + BLOCK_R - d;
      if (overlap > 0) {
        blk[0] = clamp(blk[0] + (dx / d) * overlap, BLOCK_R, FIELD - BLOCK_R);
        blk[1] = clamp(blk[1] + (dy / d) * overlap, BLOCK_R, FIELD - BLOCK_R);
      }
    }
}

/** one fixed tick (TICK_MS). advances phases too. */
export function step(w: ArenaState, now: number) {
  w.now = now;
  const dt = TICK_MS / 1000;
  if (w.phase === "program") {
    const allReady = w.robots.every((r) => w.ready[r.seat]);
    if (now >= w.ends || allReady) {
      w.phase = "auton";
      w.ends = now + T.auton;
      for (const r of w.robots) {
        const p = parseProgram(w.programs[r.seat] ?? "");
        w.runners[r.seat] = newRunner(p.ok ? p.cmds : []);
      }
    }
    return;
  }
  if (w.phase === "done") return;
  w.tick++;
  for (const r of w.robots) {
    let input: Input = { th: 0, tu: 0 };
    let action: "intake" | "release" | "auto" | null = null;
    if (w.phase === "auton") {
      const o = runAuton(w.runners[r.seat], r, dt);
      input = o.input;
      action = o.act;
    } else if (r.bot) {
      const o = botInput(w, r);
      input = o.input;
      if (o.act) action = "auto";
    } else {
      input = w.inputs[r.seat] ?? input;
      if (w.acts[r.seat]) action = "auto";
      w.acts[r.seat] = false;
    }
    driveStep(r, input, dt);
    if (action) doAction(w, r, action);
  }
  collide(w);
  if (now >= w.ends) {
    if (w.phase === "auton") {
      w.autonBonus = w.score.acid > w.score.bone ? "acid" : w.score.bone > w.score.acid ? "bone" : null;
      if (w.autonBonus) w.score[w.autonBonus] += PTS.auton;
      w.phase = "driver";
      w.ends = now + T.driver;
      for (const r of w.robots) r.v = 0;
    } else if (w.phase === "driver") {
      for (const r of w.robots)
        if (inside(PARK[r.team], r.x, r.y)) {
          w.park[r.team]++;
          w.score[r.team] += PTS.park;
        }
      w.phase = "done";
    }
  }
}

/** a seat leaving mid-match: a bot drives it */
export function botify(w: ArenaState, seat: number) {
  const r = w.robots.find((o) => o.seat === seat);
  if (r) {
    r.bot = true;
    w.ready[seat] = true;
  }
}

// ------------------------------------------------------------------ snapshots

const r1 = (n: number) => Math.round(n * 10) / 10;
export type ArenaView = {
  now: number;
  phase: Phase;
  ends: number;
  tick: number;
  mode: "1v1" | "2v2";
  score: Record<Team, number>;
  /** [seat, x, y, heading, held, speed] */
  bots: [number, number, number, number, number, number][];
  robots: { seat: number; nick: string; team: Team; bot: boolean; scored: number; autonScored: number }[];
  blocks: [number, number][];
  autonBonus: Team | null;
  park: Record<Team, number>;
  ready: number[];
};

/** everyone sees the same thing in arena, so one snapshot serves all seats */
export function snapshot(w: ArenaState): ArenaView {
  return {
    now: w.now,
    phase: w.phase,
    ends: w.ends,
    tick: w.tick,
    mode: w.mode,
    score: w.score,
    bots: w.robots.map((r) => [r.seat, r1(r.x), r1(r.y), Math.round(r.h * 100) / 100, r.held, r1(r.v)]),
    robots: w.robots.map((r) => ({ seat: r.seat, nick: r.nick, team: r.team, bot: r.bot, scored: r.scored, autonScored: r.autonScored })),
    blocks: w.blocks.map(([x, y]) => [r1(x), r1(y)]),
    autonBonus: w.autonBonus,
    park: w.park,
    ready: Object.entries(w.ready).filter(([, v]) => v).map(([k]) => Number(k)),
  };
}
