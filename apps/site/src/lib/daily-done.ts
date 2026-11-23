// fills <DailyDone>: result, share, stats, "x% solved today", countdown to the next puzzle.
import { GAMES, msToNextDay, type GameId } from "@edwrdq/daily";
import { clock, share, shareText, solveRate, stats } from "@edwrdq/daily/client";

export type DoneOpts = {
  game: GameId;
  day: string;
  archive: boolean;
  solved: boolean;
  /** text or nodes for the reveal block */
  reveal: (string | Node)[];
  score: string;
  /** share headline (after "edwrdq daily · game #001 · ") and the plain-character line */
  headline: string;
  line?: string;
};

const ticks = new WeakMap<Element, number>();

export async function showDone(scope: HTMLElement, o: DoneOpts) {
  const $ = <T extends HTMLElement>(s: string) => scope.querySelector<T>(s)!;
  $("[data-done]").hidden = false;
  $("[data-done-label]").textContent = o.solved ? "SOLVED" : "OUT OF TRIES";
  $("[data-reveal]").replaceChildren(...o.reveal.map((x) => (typeof x === "string" ? Object.assign(document.createElement("p"), { textContent: x }) : x)));
  $("[data-score]").textContent = o.score;
  const text = shareText(o.game, o.day, o.headline, o.line);
  $("[data-share-preview]").textContent = text;
  $("[data-share]").onclick = async () => {
    const r = await share(text);
    $("[data-shared]").textContent = r === "copied" ? "copied." : r === "shared" ? "" : "couldn't share. copy it from below.";
  };
  const s = stats(o.game);
  const dl = $("[data-stats]");
  const stat = (k: string, v: string | number) => [Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: String(v) })];
  dl.replaceChildren(...stat("played", s.played), ...stat("solved", s.solved), ...stat("streak", s.streak), ...stat("best", s.best));
  const next = $("[data-next]");
  clearInterval(ticks.get(next));
  if (o.archive) next.textContent = "archive puzzles don't count toward your streak.";
  else {
    const name = GAMES.find((g) => g.id === o.game)?.name ?? o.game;
    const tick = () => (next.textContent = `next ${name} in ${clock(msToNextDay())}`);
    tick();
    ticks.set(next, window.setInterval(tick, 1000));
  }
  const rate = await solveRate(o.game, o.day);
  if (rate && rate.plays >= 5) dl.append(...stat("solved today", `${Math.round((rate.solves / rate.plays) * 100)}%`));
}

/** p, with optional class */
export const para = (text: string, cls?: string) => Object.assign(document.createElement("p"), { textContent: text, className: cls ?? "" });
