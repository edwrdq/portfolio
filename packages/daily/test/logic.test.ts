import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, LAUNCH } from "../src/core.ts";
import { dailyKK, evaluate, say, solutions, validCurated, type S } from "../src/logic.ts";

test("classic puzzle: a says 'we are both knaves' → a knave, b knight", () => {
  const says: S[] = [{ t: "count", op: "exactly", k: 2, knight: false, among: [0, 1] }, { t: "is", who: 1, knight: true }];
  // b's statement "i am a knight" is true for both kinds when b is a knight, consistent either way for b? b: knight→true ok, knave→claims knight, false ok
  const sols = solutions(says);
  assert.ok(sols.some((s) => !s[0] && s[1]));
  assert.ok(sols.every((s) => !s[0]), "a must be a knave");
});

test("evaluate basics", () => {
  assert.equal(evaluate({ t: "same", a: 0, b: 1 }, [true, true]), true);
  assert.equal(evaluate({ t: "if", p: { t: "is", who: 0, knight: true }, q: { t: "is", who: 1, knight: false } }, [true, true]), false);
  assert.equal(evaluate({ t: "count", op: "atleast", k: 1, knight: false, among: [0, 1, 2] }, [true, true, false]), true);
});

test("english reads right", () => {
  const n = ["ana", "bo", "cy"];
  assert.equal(say({ t: "is", who: 1, knight: false }, 0, n), "bo is a knave");
  assert.equal(say({ t: "is", who: 0, knight: true }, 0, n), "i am a knight");
  assert.equal(say({ t: "count", op: "exactly", k: 1, knight: true, among: [0, 1, 2] }, 2, n), "exactly 1 of us is a knight");
  assert.equal(say({ t: "same", a: 1, b: 0 }, 0, n), "bo and i are the same kind");
  assert.equal(say({ t: "diff", a: 0, b: 2 }, 0, n), "cy and i are different kinds");
});

test("a year of dailies: exactly one solution each, deterministic", () => {
  for (let i = 0; i < 365; i++) {
    const day = addDays(LAUNCH, i);
    const p = dailyKK(day);
    assert.equal(solutions(p.says).length, 1, day);
    assert.deepEqual(solutions(p.says)[0], p.solution);
    assert.deepEqual(p, dailyKK(day));
    assert.equal(new Set(p.names).size, p.names.length);
  }
});

test("curated validation", () => {
  assert.ok(validCurated({ kind: "order", claim: "x", steps: ["a", "b", "c"] }));
  assert.ok(validCurated({ kind: "badstep", claim: "x", steps: ["a", "b", "c"], bad: 2, explain: "y" }));
  assert.ok(!validCurated({ kind: "badstep", claim: "x", steps: ["a", "b", "c"], bad: 3, explain: "y" }));
  assert.ok(!validCurated({ kind: "order", claim: "x", steps: ["a"] }));
});
