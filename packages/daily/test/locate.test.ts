import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, LAUNCH } from "../src/core.ts";
import { dailyLocate, fair, posterior, replay, sense, step, trueDist, wall, W, H, massNear, type Move } from "../src/locate.ts";

test("distances and blocked moves", () => {
  const walls = new Uint8Array(W * H);
  walls[5 * W + 8] = 1;
  assert.equal(trueDist(walls, 2, 5, 1), 5); // east: cells 3..7 free, 8 is a wall
  assert.equal(trueDist(walls, 0, 0, 0), 0); // north edge
  assert.equal(trueDist(walls, 0, 0, 2), H - 1);
  const p = { x: 7, y: 5, h: 1 as const };
  assert.deepEqual(step(walls, p, "fwd"), p, "bumping a wall leaves it in place");
  assert.equal(step(walls, p, "left").h, 0);
  assert.equal(step(walls, { x: 0, y: 0, h: 0 }, "left").h, 3);
});

test("sensor noise is fixed per day+step and small", () => {
  const l = dailyLocate(LAUNCH);
  const a = sense(l.walls, l.start, LAUNCH, 0);
  assert.deepEqual(a, sense(l.walls, l.start, LAUNCH, 0));
  for (let d = 0; d < 4; d++) assert.ok(Math.abs(a[d] - trueDist(l.walls, l.start.x, l.start.y, d as 0)) < 2);
});

test("a year of maps: deterministic, connected-ish, start is free, fair", () => {
  for (let i = 0; i < 120; i++) {
    const day = addDays(LAUNCH, i);
    const l = dailyLocate(day);
    assert.ok(!wall(l.walls, l.start.x, l.start.y));
    assert.ok(fair(l, day));
    assert.deepEqual(l, dailyLocate(day));
  }
});

test("the filter actually narrows down with good moves", () => {
  const day = LAUNCH;
  const l = dailyLocate(day);
  const moves: Move[] = ["fwd", "fwd", "right", "fwd"];
  const { poses, readings } = replay(l, day, moves);
  const b = posterior(l.walls, l.start.h, moves, readings);
  const sum = b.reduce((a, x) => a + x, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const end = poses[poses.length - 1];
  assert.ok(massNear(b, end.x, end.y) > 0.2, "truth keeps real probability");
});
