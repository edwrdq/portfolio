// daily locate: monte carlo localization as a puzzle. a 12×12 field with walls, a hidden robot
// that knows its heading (like a robot with a compass/imu) but not where it is. each turn it
// reports noisy distances to the nearest wall in 4 directions. the player guesses its cell.
//
// everything is deterministic per day: the map, the start pose, and the sensor noise for each
// step k (seeded by day + k), so a given sequence of moves always gives the same readings.
import { dailyRng, rng, type Rng } from "./core.ts";

export const W = 12;
export const H = 12;
export const GUESSES = 5;
export const SIGMA = 0.4; // sensor noise, cells
export type Dir = 0 | 1 | 2 | 3; // n e s w
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const DIR_NAME = ["north", "east", "south", "west"] as const;
export type Pose = { x: number; y: number; h: Dir };
export type Move = "fwd" | "left" | "right";
export type Reading = [number, number, number, number]; // distance north, east, south, west (cells)
export type Locate = { walls: Uint8Array; start: Pose };

export const wall = (walls: Uint8Array, x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || walls[y * W + x] === 1;

/** free cells between (x,y) and the first wall in direction d */
export function trueDist(walls: Uint8Array, x: number, y: number, d: Dir): number {
  let n = 0;
  for (let cx = x + DX[d], cy = y + DY[d]; !wall(walls, cx, cy); cx += DX[d], cy += DY[d]) n++;
  return n;
}

/** standard normal from an rng (box–muller) */
function gauss(r: Rng) {
  const u = Math.max(1e-12, r.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r.next());
}

/** the robot's reading at step k for a day: true distances + that step's fixed noise */
export function sense(walls: Uint8Array, p: Pose, day: string, k: number): Reading {
  const r = rng(`edwrdq:locate:${day}:noise:${k}`);
  return [0, 1, 2, 3].map((d) => Math.max(0, Math.round((trueDist(walls, p.x, p.y, d as Dir) + gauss(r) * SIGMA) * 10) / 10)) as Reading;
}

/** robots don't drive through walls: a blocked forward leaves it where it is */
export function step(walls: Uint8Array, p: Pose, m: Move): Pose {
  if (m === "left") return { ...p, h: ((p.h + 3) % 4) as Dir };
  if (m === "right") return { ...p, h: ((p.h + 1) % 4) as Dir };
  const x = p.x + DX[p.h];
  const y = p.y + DY[p.h];
  return wall(walls, x, y) ? p : { ...p, x, y };
}

/** replay a game: poses[k] and readings[k] after k moves */
export function replay(l: Locate, day: string, moves: Move[]) {
  const poses: Pose[] = [l.start];
  for (const m of moves) poses.push(step(l.walls, poses[poses.length - 1], m));
  return { poses, readings: poses.map((p, k) => sense(l.walls, p, day, k)) };
}

/** a guess hits if it's the robot's cell or any of the 8 around it */
export const hit = (g: { x: number; y: number }, p: Pose) => Math.max(Math.abs(g.x - p.x), Math.abs(g.y - p.y)) <= 1;
export function warmth(g: { x: number; y: number }, p: Pose): "hit" | "close" | "warm" | "cold" {
  if (hit(g, p)) return "hit";
  const d = Math.hypot(g.x - p.x, g.y - p.y);
  return d <= 3 ? "close" : d <= 6 ? "warm" : "cold";
}

// ---------------------------------------------------------------- exact bayes filter (grid)
// used to prove each day is solvable, and by the reveal to show where the robot "could be".

const lik = (reading: Reading, walls: Uint8Array, x: number, y: number) => {
  let l = 1;
  for (let d = 0; d < 4; d++) {
    const e = reading[d] - trueDist(walls, x, y, d as Dir);
    l *= Math.exp((-e * e) / (2 * SIGMA * SIGMA));
  }
  return l;
};

/** posterior over cells after the given moves + readings (heading is known, so only x,y) */
export function posterior(walls: Uint8Array, startH: Dir, moves: Move[], readings: Reading[]): Float64Array {
  let belief = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) belief[i] = walls[i] ? 0 : 1;
  let h = startH;
  for (let k = 0; k < readings.length; k++) {
    if (k > 0) {
      // motion update: every hypothesis moves the same way the robot did
      const m = moves[k - 1];
      if (m === "fwd") {
        const next = new Float64Array(W * H);
        for (let i = 0; i < W * H; i++) {
          if (!belief[i]) continue;
          const x = i % W, y = Math.floor(i / W);
          const p = step(walls, { x, y, h }, "fwd");
          next[p.y * W + p.x] += belief[i];
        }
        belief = next;
      } else h = step(walls, { x: 0, y: 0, h }, m).h;
    }
    let sum = 0;
    for (let i = 0; i < W * H; i++) if (belief[i]) (belief[i] *= lik(readings[k], walls, i % W, Math.floor(i / W))), (sum += belief[i]);
    if (sum > 0) for (let i = 0; i < W * H; i++) belief[i] /= sum;
  }
  return belief;
}

/** probability mass within one cell (chebyshev) of a point */
export function massNear(b: Float64Array, x: number, y: number) {
  let m = 0;
  for (let i = 0; i < W * H; i++) if (Math.max(Math.abs((i % W) - x), Math.abs(Math.floor(i / W) - y)) <= 1) m += b[i];
  return m;
}

// ---------------------------------------------------------------- generation

function connected(walls: Uint8Array) {
  const start = walls.indexOf(0);
  if (start < 0) return false;
  const seen = new Uint8Array(W * H);
  const stack = [start];
  seen[start] = 1;
  let n = 1;
  while (stack.length) {
    const i = stack.pop()!;
    for (let d = 0; d < 4; d++) {
      const x = (i % W) + DX[d], y = Math.floor(i / W) + DY[d];
      const j = y * W + x;
      if (!wall(walls, x, y) && !seen[j]) (seen[j] = 1), n++, stack.push(j);
    }
  }
  return n === walls.length - walls.reduce((a, b) => a + b, 0);
}

function genMap(r: Rng): Uint8Array {
  for (;;) {
    const w = new Uint8Array(W * H);
    const segs = r.int(6, 9);
    for (let s = 0; s < segs; s++) {
      const horiz = r.chance(0.5);
      const len = r.int(2, 4);
      const x0 = r.int(1, W - 2 - (horiz ? len : 0));
      const y0 = r.int(1, H - 2 - (horiz ? 0 : len));
      for (let k = 0; k < len; k++) w[(y0 + (horiz ? 0 : k)) * W + x0 + (horiz ? k : 0)] = 1;
    }
    for (let s = r.int(2, 4); s > 0; s--) w[r.int(1, H - 2) * W + r.int(1, W - 2)] = 1;
    const free = W * H - w.reduce((a, b) => a + b, 0);
    if (free >= 100 && free <= 128 && connected(w)) return w;
  }
}

/** the reference policy used to prove a day is fair: drive forward, turn right at walls */
export const policy = (walls: Uint8Array, p: Pose): Move => (step(walls, p, "fwd") === p ? "right" : "fwd");

/** fair = not obvious from the first reading, but pinned down by the last guess with the reference policy */
export function fair(l: Locate, day: string) {
  const moves: Move[] = [];
  let p = l.start;
  for (let k = 0; k < GUESSES - 1; k++) {
    const m = policy(l.walls, p);
    moves.push(m);
    p = step(l.walls, p, m);
  }
  const { poses, readings } = replay(l, day, moves);
  const first = posterior(l.walls, l.start.h, [], readings.slice(0, 1));
  if (massNear(first, l.start.x, l.start.y) > 0.5) return false;
  const last = posterior(l.walls, l.start.h, moves, readings);
  const end = poses[poses.length - 1];
  let best = 0;
  for (let i = 1; i < W * H; i++) if (last[i] > last[best]) best = i;
  return massNear(last, end.x, end.y) >= 0.6 && hit({ x: best % W, y: Math.floor(best / W) }, end);
}

export function dailyLocate(day: string): Locate {
  const r = dailyRng("locate", day);
  for (;;) {
    const walls = genMap(r);
    for (let t = 0; t < 40; t++) {
      const x = r.int(0, W - 1), y = r.int(0, H - 1);
      if (wall(walls, x, y)) continue;
      const l: Locate = { walls, start: { x, y, h: r.int(0, 3) as Dir } };
      if (fair(l, day)) return l;
    }
  }
}
