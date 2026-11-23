import { test } from "node:test";
import assert from "node:assert/strict";
import { rng } from "../src/core.ts";
import { contiguous, gbm, logReturns, makeDay, makeRound, mean, normalize, std, usable, type Series } from "../src/rr.ts";

const fakeSeries = (id: string, n = 3000): Series => {
  const r = rng(id);
  const v = gbm(r, n, 50, 0.0002, 0.015);
  return { id, name: id, unit: "$", source: "test", url: "https://example.com", dates: v.map((_, i) => new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10)), values: v };
};

test("gbm matches the drift and volatility it was given", () => {
  const v = gbm(rng("g"), 20_000, 100, 0.0003, 0.012);
  const lr = logReturns(v);
  assert.ok(Math.abs(mean(lr) - 0.0003) < 0.0003, `mean ${mean(lr)}`);
  assert.ok(Math.abs(std(lr) - 0.012) < 0.0005, `sd ${std(lr)}`);
});

test("usable rejects flat, pegged and negative windows", () => {
  assert.ok(!usable([1, 1, 1, 1, 1, 1, 1, 1]));
  assert.ok(!usable([10, 11, -5, 12]));
  assert.ok(!usable([10, 10.5, 10.5, 10.5, 10.5, 10.5, 10.5, 11, 10]));
  assert.ok(usable(gbm(rng("u"), 100, 10, 0, 0.02)));
});

test("rounds: normalized to 100, same length, fake stats match the real segment", () => {
  const s = fakeSeries("s1");
  const r = makeRound(rng("r"), s)!;
  assert.ok(r);
  assert.equal(r.a[0], 100);
  assert.equal(r.b[0], 100);
  assert.equal(r.a.length, r.b.length);
  const real = r.real === "a" ? r.a : r.b;
  const fake = r.real === "a" ? r.b : r.a;
  const sr = std(logReturns(real)), sf = std(logReturns(fake));
  assert.ok(sf / sr > 0.6 && sf / sr < 1.6, `vol ratio ${sf / sr}`);
  assert.ok(r.from < r.to);
  assert.deepEqual(normalize([5, 10]), [100, 200]);
});

test("a day has 5 rounds, deterministic, mostly different series, real side balanced", () => {
  const series = ["a", "b", "c", "d", "e", "f"].map((x) => fakeSeries(x));
  const d = makeDay("2026-11-23", series);
  assert.equal(d.rounds.length, 5);
  assert.deepEqual(d, makeDay("2026-11-23", series));
  assert.ok(new Set(d.rounds.map((r) => r.series.id)).size >= 4);
  let a = 0;
  for (let i = 0; i < 60; i++) a += makeDay(`2027-01-${String((i % 28) + 1).padStart(2, "0")}-${i}`, series).rounds.filter((r) => r.real === "a").length;
  assert.ok(a > 110 && a < 190, `real on the left ${a}/300`);
});

test("windows with data holes are skipped", () => {
  assert.ok(contiguous(["2026-01-02", "2026-01-05", "2026-01-06"]));
  assert.ok(!contiguous(["2026-01-02", "2026-01-20"]));
});

test("real dates in a round span about the right time", () => {
  const s = fakeSeries("span");
  // make the series weekly in the middle — rounds must avoid that stretch
  s.dates = s.dates.map((d, i) => (i > 1000 && i < 2000 ? new Date(Date.UTC(2000, 0, 1 + 1000 + (i - 1000) * 7)).toISOString().slice(0, 10) : d));
  for (let k = 0; k < 30; k++) {
    const r = makeRound(rng(`span${k}`), s);
    if (!r) continue;
    const days = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000;
    assert.ok(days <= r.a.length * 6, `${r.from} → ${r.to} for ${r.a.length} points`);
  }
});
