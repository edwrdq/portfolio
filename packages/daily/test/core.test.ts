import { test } from "node:test";
import assert from "node:assert/strict";
import { LAUNCH, addDays, dayKey, msToNextDay, puzzleNumber, playable, rng } from "../src/core.ts";

test("day rolls over at new york midnight (est and edt)", () => {
  // winter, utc-5
  assert.equal(dayKey(Date.parse("2026-11-24T04:59:59Z")), "2026-11-23");
  assert.equal(dayKey(Date.parse("2026-11-24T05:00:00Z")), "2026-11-24");
  // summer, utc-4
  assert.equal(dayKey(Date.parse("2027-07-04T03:59:59Z")), "2027-07-03");
  assert.equal(dayKey(Date.parse("2027-07-04T04:00:00Z")), "2027-07-04");
});

test("ms to next day lands on the flip, across dst", () => {
  for (const t of ["2026-11-23T18:30:00Z", "2027-03-14T03:00:00Z", "2027-11-07T01:00:00Z"]) {
    const now = Date.parse(t);
    const ms = msToNextDay(now);
    assert.notEqual(dayKey(now + ms), dayKey(now));
    assert.equal(dayKey(now + ms - 1500), dayKey(now));
  }
});

test("puzzle numbers + playable window", () => {
  assert.equal(puzzleNumber(LAUNCH), 1);
  assert.equal(puzzleNumber(addDays(LAUNCH, 11)), 12);
  assert.ok(playable(LAUNCH, LAUNCH));
  assert.ok(!playable(addDays(LAUNCH, 1), LAUNCH), "no future days");
  assert.ok(!playable(addDays(LAUNCH, -1), LAUNCH), "nothing before launch");
  assert.ok(!playable("nope", LAUNCH));
});

test("rng is deterministic and spread out", () => {
  const a = rng("x"), b = rng("x"), c = rng("y");
  const sa = Array.from({ length: 50 }, () => a.next());
  assert.deepEqual(sa, Array.from({ length: 50 }, () => b.next()));
  assert.notDeepEqual(sa, Array.from({ length: 50 }, () => c.next()));
  const r = rng("dist");
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 100_000; i++) buckets[Math.floor(r.next() * 10)]++;
  for (const n of buckets) assert.ok(n > 9_500 && n < 10_500, `bucket ${n}`);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(3, 7);
    assert.ok(v >= 3 && v <= 7 && Number.isInteger(v));
  }
});
