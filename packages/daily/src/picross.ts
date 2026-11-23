// daily picross: an 8×8 nonogram whose answer is a pixel icon. some days it's one of the site's
// icons, other days a random mirror-symmetric one (so it never runs out). every puzzle is checked
// with a line solver: if pure row/column logic can't finish it, it isn't used. that also means the
// answer is unique.
import { icons, type IconName } from "@edwrdq/ui/icons";
import { dailyRng, type Rng } from "./core.ts";

export const N = 8;
export type Grid = boolean[]; // N*N, row-major
export type Picross = { grid: Grid; rows: number[][]; cols: number[][]; name: IconName | null; filled: number };

export const fromRows = (rows: readonly string[]): Grid => rows.join("").split("").map((c) => c === "#");

/** clue for one line: run lengths, or [0] for an empty line */
export function clue(line: boolean[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const v of line) {
    if (v) run++;
    else if (run) out.push(run), (run = 0);
  }
  if (run) out.push(run);
  return out.length ? out : [0];
}

const row = (g: Grid, y: number) => g.slice(y * N, y * N + N);
const col = (g: Grid, x: number) => Array.from({ length: N }, (_, y) => g[y * N + x]);
export const clues = (g: Grid) => ({ rows: Array.from({ length: N }, (_, y) => clue(row(g, y))), cols: Array.from({ length: N }, (_, x) => clue(col(g, x))) });

// every 8-cell pattern, grouped by its clue — the line solver just filters these
const PATTERNS = new Map<string, number[]>();
for (let m = 0; m < 1 << N; m++) {
  const line = Array.from({ length: N }, (_, i) => !!(m & (1 << i)));
  const k = clue(line).join(",");
  (PATTERNS.get(k) ?? PATTERNS.set(k, []).get(k)!).push(m);
}

/** cell states while solving: 1 filled, 0 empty, -1 unknown */
type Cell = 1 | 0 | -1;

/** solve one line: keep patterns that agree with what's known, fix cells they all agree on */
function solveLine(cells: Cell[], c: number[]): Cell[] | null {
  const fits = (PATTERNS.get(c.join(",")) ?? []).filter((m) => cells.every((v, i) => v === -1 || v === ((m >> i) & 1)));
  if (!fits.length) return null; // contradiction
  return cells.map((v, i) => {
    if (v !== -1) return v;
    const bit = (fits[0] >> i) & 1;
    return fits.every((m) => ((m >> i) & 1) === bit) ? (bit as Cell) : -1;
  });
}

/** pure line logic. returns the grid if it fully solves, else null (ambiguous or needs guessing). */
export function lineSolve(rows: number[][], cols: number[][]): Grid | null {
  const s: Cell[] = new Array(N * N).fill(-1);
  for (let changed = true; changed; ) {
    changed = false;
    for (let y = 0; y < N; y++) {
      const before = s.slice(y * N, y * N + N);
      const after = solveLine(before, rows[y]);
      if (!after) return null;
      after.forEach((v, x) => v !== before[x] && ((s[y * N + x] = v), (changed = true)));
    }
    for (let x = 0; x < N; x++) {
      const before = Array.from({ length: N }, (_, y) => s[y * N + x]);
      const after = solveLine(before, cols[x]);
      if (!after) return null;
      after.forEach((v, y) => v !== before[y] && ((s[y * N + x] = v), (changed = true)));
    }
  }
  return s.includes(-1) ? null : s.map((v) => v === 1);
}

const make = (grid: Grid, name: IconName | null): Picross => ({ grid, ...clues(grid), name, filled: grid.filter(Boolean).length });

/** a puzzle is fair if line logic alone gets the exact answer */
export const solvable = (p: Picross) => {
  const s = lineSolve(p.rows, p.cols);
  return !!s && s.every((v, i) => v === p.grid[i]);
};

/** the site's icons that make fair puzzles */
export const SITE_ICONS = (Object.keys(icons) as IconName[]).filter((n) => solvable(make(fromRows(icons[n]), n)));

/** random mirror-symmetric icon (left/right, sometimes top/bottom too), retried until it's fair */
export function generate(r: Rng): Picross {
  for (let tries = 0; tries < 2000; tries++) {
    const density = 0.42 + r.next() * 0.2;
    const both = r.chance(0.25);
    const g: Grid = new Array(N * N).fill(false);
    for (let y = 0; y < (both ? N / 2 : N); y++)
      for (let x = 0; x < N / 2; x++) {
        const v = r.next() < density;
        g[y * N + x] = g[y * N + (N - 1 - x)] = v;
        if (both) g[(N - 1 - y) * N + x] = g[(N - 1 - y) * N + (N - 1 - x)] = v;
      }
    const p = make(g, null);
    const empties = [...p.rows, ...p.cols].filter((c) => c[0] === 0).length;
    if (p.filled < 22 || p.filled > 44 || empties > 1) continue;
    if (solvable(p)) return p;
  }
  // unreachable in practice (tested); fall back to a site icon so a day is never broken
  return make(fromRows(icons[SITE_ICONS[0]]), SITE_ICONS[0]);
}

/** the picross for a day: about a third of days are one of the site's icons */
export function dailyPicross(day: string): Picross {
  const r = dailyRng("picross", day);
  if (SITE_ICONS.length && r.chance(0.35)) {
    const name = r.pick(SITE_ICONS);
    return make(fromRows(icons[name]), name);
  }
  return generate(r);
}
