// daily logic. generated format: knights & knaves (knights always tell the truth, knaves always
// lie). statements are small logic trees; a brute-force solver checks all 2^n assignments and
// only puzzles with exactly one consistent assignment are used. curated formats (order the proof,
// spot the bad step) come from admin and just need checking, no solving.
import { dailyRng, weekday, type Rng } from "./core.ts";

export type S =
  | { t: "is"; who: number; knight: boolean }
  | { t: "same"; a: number; b: number }
  | { t: "diff"; a: number; b: number }
  | { t: "count"; op: "exactly" | "atleast" | "atmost"; k: number; knight: boolean; among: number[] }
  | { t: "and" | "or" | "if"; p: S; q: S };

export type KK = { names: string[]; says: S[]; solution: boolean[] };

const NAMES = ["ana", "bo", "cy", "dee", "eli", "fay", "gus", "hal", "ivy", "jo", "kai", "lu", "max", "nia", "oz", "pia", "rex", "sol", "tia", "vic"];

export function evaluate(s: S, kn: boolean[]): boolean {
  switch (s.t) {
    case "is":
      return kn[s.who] === s.knight;
    case "same":
      return kn[s.a] === kn[s.b];
    case "diff":
      return kn[s.a] !== kn[s.b];
    case "count": {
      const n = s.among.filter((i) => kn[i] === s.knight).length;
      return s.op === "exactly" ? n === s.k : s.op === "atleast" ? n >= s.k : n <= s.k;
    }
    case "and":
      return evaluate(s.p, kn) && evaluate(s.q, kn);
    case "or":
      return evaluate(s.p, kn) || evaluate(s.q, kn);
    case "if":
      return !evaluate(s.p, kn) || evaluate(s.q, kn);
  }
}

/** every assignment where each person's statement is true exactly when they're a knight */
export function solutions(says: S[]): boolean[][] {
  const n = says.length;
  const out: boolean[][] = [];
  for (let m = 0; m < 1 << n; m++) {
    const kn = Array.from({ length: n }, (_, i) => !!(m & (1 << i)));
    if (says.every((s, i) => evaluate(s, kn) === kn[i])) out.push(kn);
  }
  return out;
}

const kind = (k: boolean) => (k ? "a knight" : "a knave");
const plural = (k: boolean) => (k ? "knights" : "knaves");

/** english for a statement, from the speaker's point of view ("i", "me") */
export function say(s: S, speaker: number, names: string[]): string {
  const who = (i: number) => (i === speaker ? "i" : names[i]);
  const be = (i: number) => (i === speaker ? "am" : "is");
  switch (s.t) {
    case "is":
      return `${who(s.who)} ${be(s.who)} ${kind(s.knight)}`;
    case "same":
    case "diff": {
      // "kai and i", never "i and kai"
      const [x, y] = s.a === speaker ? [s.b, s.a] : [s.a, s.b];
      return `${names[x]} and ${who(y)} are ${s.t === "same" ? "the same kind" : "different kinds"}`;
    }
    case "count": {
      const all = s.among.length === names.length;
      const group = all ? "of us" : `of ${s.among.map((i) => (i === speaker ? "me" : names[i])).join(", ").replace(/, ([^,]*)$/, " and $1")}`;
      const op = s.op === "exactly" ? "exactly" : s.op === "atleast" ? "at least" : "at most";
      return `${op} ${s.k} ${group} ${s.k === 1 ? "is" : "are"} ${s.k === 1 ? kind(s.knight) : plural(s.knight)}`;
    }
    case "and":
      return `${say(s.p, speaker, names)}, and ${say(s.q, speaker, names)}`;
    case "or":
      return `${say(s.p, speaker, names)}, or ${say(s.q, speaker, names)}`;
    case "if":
      return `if ${say(s.p, speaker, names)}, then ${say(s.q, speaker, names)}`;
  }
}

function atom(r: Rng, n: number, speaker: number): S {
  const other = () => {
    let i = r.int(0, n - 1);
    if (i === speaker && r.chance(0.7)) i = (i + 1 + r.int(0, n - 2)) % n;
    return i;
  };
  const roll = r.next();
  if (roll < 0.4) return { t: "is", who: other(), knight: r.chance(0.5) };
  if (roll < 0.65) {
    const a = other();
    let b = other();
    if (b === a) b = (a + 1) % n;
    return { t: r.chance(0.5) ? "same" : "diff", a, b };
  }
  const among = r.chance(0.6) ? Array.from({ length: n }, (_, i) => i) : r.shuffle(Array.from({ length: n }, (_, i) => i)).slice(0, r.int(2, n - 1)).sort();
  return { t: "count", op: r.pick(["exactly", "atleast", "atmost"] as const), k: r.int(1, Math.max(1, among.length - 1)), knight: r.chance(0.5), among };
}

function statement(r: Rng, n: number, speaker: number, hard: boolean): S {
  if (hard && r.chance(0.35)) return { t: r.pick(["and", "or", "if"] as const), p: atom(r, n, speaker), q: atom(r, n, speaker) };
  return atom(r, n, speaker);
}

export function generateKK(r: Rng, n: number, hard: boolean): KK {
  for (;;) {
    const names = r.shuffle([...NAMES]).slice(0, n);
    const says = Array.from({ length: n }, (_, i) => statement(r, n, i, hard));
    const sol = solutions(says);
    // exactly one answer, and not "everyone's a knight"/"everyone's a knave" every time
    if (sol.length === 1 && sol[0].some(Boolean) && !sol[0].every(Boolean)) return { names, says, solution: sol[0] };
  }
}

/** mon–thu: 3 people, fri–sun: 4 (and compound statements on the weekend) */
export function dailyKK(day: string): KK {
  const wd = weekday(day);
  const n = wd >= 1 && wd <= 4 ? 3 : 4;
  return generateKK(dailyRng("logic", day), n, wd === 0 || wd === 6);
}

// ---------------------------------------------------------------- curated formats (from admin)

/** order the proof: steps in the right order; the page shuffles them with the day's seed */
export type OrderProof = { kind: "order"; claim: string; steps: string[]; explain?: string };
/** spot the bad step: one step (0-based `bad`) doesn't follow */
export type BadStep = { kind: "badstep"; claim: string; steps: string[]; bad: number; explain: string };
export type CuratedLogic = OrderProof | BadStep;

export function validCurated(x: unknown): x is CuratedLogic {
  const o = x as CuratedLogic;
  if (!o || typeof o.claim !== "string" || !Array.isArray(o.steps) || o.steps.length < 3 || o.steps.some((s) => typeof s !== "string" || !s.trim())) return false;
  if (o.kind === "order") return o.steps.length <= 10;
  if (o.kind === "badstep") return Number.isInteger(o.bad) && o.bad >= 0 && o.bad < o.steps.length && typeof o.explain === "string";
  return false;
}
