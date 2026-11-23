// browser side of the daily system: per-day saves, stats + streaks (localStorage, never trusted to
// exist), share text, and the anonymous "x% solved today" counter.
import { GAMES, LAUNCH, addDays, dayKey, isDay, padNum, puzzleNumber, type GameId } from "./core.ts";

export type DayRecord<S = unknown> = {
  /** finished (solved or out of tries) */
  done: boolean;
  solved: boolean;
  /** played on the day itself, not from the archive — only these count for streaks */
  live: boolean;
  /** short result, e.g. "1:42 · 2 mistakes" */
  result?: string;
  /** the game's own in-progress state */
  state?: S;
  /** counter events already sent */
  sent?: { play?: boolean; solve?: boolean };
};

type Store = Partial<Record<GameId, Record<string, DayRecord>>>;
const KEY = "edwrdq-daily-v1";

function read(): Store {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function write(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode / full / blocked: the game still works, it just won't remember */
  }
}

export function getDay<S>(game: GameId, day: string): DayRecord<S> | null {
  return (read()[game]?.[day] as DayRecord<S> | undefined) ?? null;
}

export function putDay<S>(game: GameId, day: string, rec: DayRecord<S>) {
  const s = read();
  (s[game] ??= {})[day] = rec;
  write(s);
}

export type Stats = { played: number; solved: number; streak: number; best: number };

/** streak = consecutive days solved on the day, ending today (or yesterday if today's still open) */
function streaks(solvedDays: Set<string>, today: string) {
  let streak = 0;
  let d = solvedDays.has(today) ? today : addDays(today, -1);
  while (solvedDays.has(d)) streak++, (d = addDays(d, -1));
  let best = 0;
  let run = 0;
  let prev = "";
  for (const day of [...solvedDays].sort()) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return { streak, best };
}

export function stats(game: GameId, today = dayKey()): Stats {
  const days = Object.entries(read()[game] ?? {});
  const live = new Set(days.filter(([, r]) => r.solved && r.live).map(([d]) => d));
  return { played: days.filter(([, r]) => r.done).length, solved: days.filter(([, r]) => r.solved).length, ...streaks(live, today) };
}

/** across all games: a day counts if any daily was solved on the day */
export function overallStreak(today = dayKey()) {
  const s = read();
  const days = new Set<string>();
  for (const g of GAMES) for (const [d, r] of Object.entries(s[g.id] ?? {})) if (r.solved && r.live) days.add(d);
  return streaks(days, today);
}

// ---------------------------------------------------------------- share

export function shareText(game: GameId, day: string, headline: string, line?: string) {
  const name = GAMES.find((g) => g.id === game)?.name ?? game;
  return [`edwrdq daily · ${name} ${padNum(puzzleNumber(day))} · ${headline}`, line, "edwrdq.com/daily"].filter(Boolean).join("\n");
}

/** native share sheet on phones, clipboard elsewhere. returns what happened. */
export async function share(text: string): Promise<"shared" | "copied" | "failed"> {
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.share) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "failed";
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

// ---------------------------------------------------------------- counter

/** count a play/solve for today's puzzle. once per device per day, archive days never count. */
export function report(game: GameId, day: string, event: "play" | "solve") {
  if (day !== dayKey()) return;
  const rec = getDay(game, day);
  if (!rec || rec.sent?.[event]) return;
  putDay(game, day, { ...rec, sent: { ...rec.sent, [event]: true } });
  fetch("/api/daily", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game, date: day, event }),
    keepalive: true,
  }).catch(() => {});
}

/** { plays, solves } for a day, or null */
export async function solveRate(game: GameId, day: string): Promise<{ plays: number; solves: number } | null> {
  try {
    const res = await fetch(`/api/daily?game=${game}&date=${day}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { plays: number; solves: number };
    return typeof j.plays === "number" ? j : null;
  } catch {
    return null;
  }
}

/** "1:42" */
export const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/** ?day=YYYY-MM-DD when playing from the archive, else today */
export function dayFromUrl(today = dayKey()): { day: string; archive: boolean } {
  const q = new URLSearchParams(location.search).get("day");
  return isDay(q) && q < today && q >= LAUNCH ? { day: q, archive: true } : { day: today, archive: false };
}
