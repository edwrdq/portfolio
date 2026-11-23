// the shared daily system: one puzzle per game per day, the same for everyone.
// days roll over at midnight america/new_york. puzzles come from a seeded rng (seed = game + date),
// so nothing is stored. erasable typescript only, so node can run the tests directly.

/** #001 */
export const LAUNCH = "2026-11-23";
export const TZ = "America/New_York";

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** the daily date ("YYYY-MM-DD") in new york for a moment in time */
export function dayKey(at: Date | number = Date.now()): string {
  return ymd.format(typeof at === "number" ? new Date(at) : at);
}

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** whole days between two day keys (b - a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** puzzle number: launch day is 1 */
export const puzzleNumber = (day: string) => daysBetween(LAUNCH, day) + 1;
export const padNum = (n: number) => `#${String(n).padStart(3, "0")}`;

/** playable: launch day … today (no peeking ahead) */
export const playable = (day: string, today = dayKey()) => isDay(day) && day >= LAUNCH && day <= today;

/** 0 = sunday … 6 = saturday, for a day key */
export const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** ms until the next new-york midnight (for the "next puzzle in" countdown) */
export function msToNextDay(now = Date.now()): number {
  const today = dayKey(now);
  // binary search for the moment the new-york date flips (dst-safe, no tz math)
  let lo = now;
  let hi = now + 26 * 3_600_000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKey(mid) === today) lo = mid;
    else hi = mid;
  }
  return hi - now;
}

// ---------------------------------------------------------------- rng

/** 128-bit string hash (cyrb128) → four 32-bit seeds */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export type Rng = {
  /** [0, 1) */
  next(): number;
  /** integer in [lo, hi] */
  int(lo: number, hi: number): number;
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(xs: T[]): T[];
};

/** sfc32, seeded from a string. same seed → same sequence on every device. */
export function rng(seed: string): Rng {
  let [a, b, c, d] = cyrb128(seed);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next(); // warm up
  const r: Rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
    shuffle: (xs) => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [xs[i], xs[j]] = [xs[j], xs[i]];
      }
      return xs;
    },
  };
  return r;
}

/** the rng for one game on one day */
export const dailyRng = (game: string, day: string) => rng(`edwrdq:${game}:${day}`);

// ---------------------------------------------------------------- games

export type GameId = "picross";
export const GAMES: { id: GameId; name: string; blurb: string; href: string }[] = [
  { id: "picross", name: "picross", blurb: "an 8×8 nonogram. the answer is a pixel icon.", href: "/daily/picross" },
];
export const isGame = (s: unknown): s is GameId => GAMES.some((g) => g.id === s);
