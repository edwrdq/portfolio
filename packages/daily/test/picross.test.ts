import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, LAUNCH } from "../src/core.ts";
import { SITE_ICONS, clue, clues, dailyPicross, fromRows, lineSolve, N } from "../src/picross.ts";

test("clues", () => {
  assert.deepEqual(clue([true, true, false, true, false, false, true, true]), [2, 1, 2]);
  assert.deepEqual(clue(new Array(8).fill(false)), [0]);
  assert.deepEqual(clue(new Array(8).fill(true)), [8]);
});

test("line solver solves a known icon and rejects an ambiguous one", () => {
  // the "box" icon is solvable by pure line logic
  const g = fromRows(["..####..", ".#....#.", "########", "#......#", "#..##..#", "#......#", "#......#", "########"]);
  const c = clues(g);
  assert.deepEqual(lineSolve(c.rows, c.cols), g);
  // a 2×2 checker inside an empty board has two answers — must not solve
  const amb = new Array(N * N).fill(false);
  amb[0] = amb[N + 1] = true;
  const ca = clues(amb);
  assert.equal(lineSolve(ca.rows, ca.cols), null);
});

test("some site icons are usable", () => {
  assert.ok(SITE_ICONS.length >= 5, `only ${SITE_ICONS.length}: ${SITE_ICONS}`);
});

test("three years of dailies: deterministic, fair, unique, not boring", () => {
  const seen = new Set<string>();
  let site = 0;
  for (let i = 0; i < 365 * 3; i++) {
    const day = addDays(LAUNCH, i);
    const p = dailyPicross(day);
    assert.deepEqual(p, dailyPicross(day), "same day → same puzzle");
    const solved = lineSolve(p.rows, p.cols);
    assert.ok(solved, `${day} needs guessing`);
    assert.deepEqual(solved, p.grid, `${day} solver disagrees`);
    if (p.name) site++;
    else {
      assert.ok(p.filled >= 22 && p.filled <= 44, `${day} filled ${p.filled}`);
      seen.add(p.grid.map((v) => (v ? 1 : 0)).join(""));
    }
  }
  assert.ok(site > 250 && site < 500, `site icon days: ${site}`);
  assert.ok(seen.size > 600, `generated repeats: ${seen.size} distinct`);
});
