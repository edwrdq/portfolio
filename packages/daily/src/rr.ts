// daily real or random: two unlabeled charts, one real price history, one random walk.
// fakes are geometric brownian motion with the drift and volatility of the real segment they're
// paired with, so you can't tell them apart by how much they move — only by how they move.
// rounds are precomputed by scripts/real-or-random.mjs and stored in kv; this file is the math.
import { rng, type Rng } from "./core.ts";

export const ROUNDS = 5;
export type SeriesMeta = { id: string; name: string; unit: string; source: string; url: string };
export type Series = SeriesMeta & { dates: string[]; values: number[] };
export type Round = {
  a: number[];
  b: number[];
  real: "a" | "b";
  series: SeriesMeta;
  from: string;
  to: string;
  first: number;
  last: number;
};
export type RRDay = { rounds: Round[] };

const LENGTHS = [60, 90, 120, 180, 250]; // trading days ≈ 3, 4, 6, 9, 12 months

function gauss(r: Rng) {
  const u = Math.max(1e-12, r.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r.next());
}

export function logReturns(v: number[]) {
  const out: number[] = [];
  for (let i = 1; i < v.length; i++) out.push(Math.log(v[i] / v[i - 1]));
  return out;
}
export const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
export const std = (x: number[]) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, x.length - 1));
};

/** gbm path of n points from `start`, with daily log-return mean mu and sd sigma */
export function gbm(r: Rng, n: number, start: number, mu: number, sigma: number) {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * Math.exp(mu + sigma * gauss(r)));
  return out;
}

/** start at 100 so no prices leak; 4 decimals is plenty for a chart */
export const normalize = (v: number[]) => v.map((x) => Math.round((x / v[0]) * 100 * 1e4) / 1e4);

/** a usable real window: all positive, actually moves, no stretch of identical prints (pegs, holidays) */
export function usable(v: number[]) {
  if (v.some((x) => !(x > 0))) return false;
  const lr = logReturns(v);
  if (std(lr) < 0.002) return false; // basically flat
  let run = 0;
  for (const x of lr) {
    run = x === 0 ? run + 1 : 0;
    if (run > 4) return false;
  }
  return true;
}

/** real daily data: no hole longer than a long weekend (some sources thin out to weekly in places) */
export function contiguous(dates: string[]) {
  for (let i = 1; i < dates.length; i++) if (Date.parse(dates[i]) - Date.parse(dates[i - 1]) > 6 * 86_400_000) return false;
  return true;
}

/** one round from a series, or null if no usable window was found */
export function makeRound(r: Rng, s: Series): Round | null {
  for (let t = 0; t < 40; t++) {
    const len = r.pick(LENGTHS);
    if (s.values.length < len + 1) continue;
    const i = r.int(0, s.values.length - len);
    const v = s.values.slice(i, i + len);
    if (!usable(v) || !contiguous(s.dates.slice(i, i + len))) continue;
    const lr = logReturns(v);
    const fake = gbm(r, len, v[0], mean(lr), std(lr));
    const realFirst = r.chance(0.5);
    const { dates, values, ...meta } = s;
    return {
      a: normalize(realFirst ? v : fake),
      b: normalize(realFirst ? fake : v),
      real: realFirst ? "a" : "b",
      series: meta,
      from: dates[i],
      to: dates[i + len - 1],
      first: v[0],
      last: v[len - 1],
    };
  }
  return null;
}

/** a day's five rounds, each from a different series where possible */
export function makeDay(day: string, series: Series[]): RRDay {
  const r = rng(`edwrdq:rr:${day}`);
  const order = r.shuffle([...series]);
  const rounds: Round[] = [];
  for (let k = 0; rounds.length < ROUNDS && k < order.length * 3; k++) {
    const round = makeRound(r, order[k % order.length]);
    if (round) rounds.push(round);
  }
  return { rounds };
}
