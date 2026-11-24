import { test } from "node:test";
import assert from "node:assert/strict";
import { act, createArena, driveStep, FIELD, parseProgram, snapshot, step, T, TICK_MS, type ArenaState } from "../src/arena.ts";

const seats = (humans: number, n = 4) => Array.from({ length: n }, (_, i) => ({ seat: i, nick: `p${i}`, bot: i >= humans }));
function run(w: ArenaState, t0: number, until: (w: ArenaState) => boolean) {
  let now = t0;
  for (let i = 0; i < 10_000 && !until(w); i++) step(w, (now += TICK_MS));
  return now;
}

test("programs parse, with friendly errors", () => {
  const p = parseProgram("forward 3\nturn 90\n# a comment\nintake\nforward 2 // also a comment\nrelease\nleft 45\nwait 0.5\nback 1");
  assert.ok(p.ok && p.cmds.length === 8);
  assert.deepEqual(parseProgram("forwrd 2"), { ok: false, line: 1, error: 'unknown command "forwrd"' });
  assert.equal((parseProgram("forward") as any).line, 1);
  assert.equal((parseProgram("\n\nturn 900") as any).line, 3);
  assert.equal(parseProgram("intake 2").ok, false);
  assert.equal(parseProgram(Array(30).fill("wait 0.1").join("\n")).ok, false);
});

test("drive step: speed, turning, walls", () => {
  const r = { x: 72, y: 72, h: 0, v: 0 };
  for (let i = 0; i < 40; i++) driveStep(r, { th: 1, tu: 0 }, 0.05);
  assert.ok(r.x > 72 + 60 && Math.abs(r.y - 72) < 0.001, "drives straight");
  for (let i = 0; i < 100; i++) driveStep(r, { th: 1, tu: 0 }, 0.05);
  assert.ok(r.x <= FIELD - 9 + 1e-9, "stops at the wall");
  const t = { x: 72, y: 72, h: 0, v: 0 };
  for (let i = 0; i < 10; i++) driveStep(t, { th: 0, tu: 1 }, 0.05);
  assert.ok(Math.abs(t.h - Math.PI / 2) < 0.01, "turns 90° in half a second");
});

test("autonomous runs the program: drive to a block, grab it, score it", () => {
  const w = createArena(seats(2, 2), "1v1", 0, "auton");
  const me = w.robots[0];
  // 1v1: acid starts at (30,72) facing right, a block sits at (48,72). grab it, drive home, drop.
  act(w, 0, { a: "prog", text: "forward 0.4\nintake\nturn 135\nforward 3\nrelease" });
  act(w, 0, { a: "ready", on: true });
  act(w, 1, { a: "ready", on: true });
  let now = run(w, 0, (w) => w.phase !== "program");
  assert.equal(w.phase, "auton");
  now = run(w, now, (w) => w.phase !== "auton");
  assert.ok(me.autonScored >= 1, `scored in auton (held ${me.held}, at ${me.x.toFixed(0)},${me.y.toFixed(0)})`);
  assert.equal(w.autonBonus, "acid");
  assert.equal(w.score.acid, me.autonScored * 3 + 8);
});

test("bad programs are refused and the robot just sits", () => {
  const w = createArena(seats(1, 2), "1v1", 0, "bad");
  assert.equal(act(w, 0, { a: "prog", text: "fly 3" }).ok, false);
});

test("bots-only matches: everyone scores something, nothing breaks", () => {
  let total = 0;
  const N = 20;
  for (let k = 0; k < N; k++) {
    const w = createArena(seats(0), "2v2", 0, `sim${k}`);
    run(w, 0, (w) => w.phase === "done");
    assert.equal(w.phase, "done");
    for (const r of w.robots) {
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && r.x >= 0 && r.x <= FIELD && r.y >= 0 && r.y <= FIELD);
    }
    const s = snapshot(w);
    assert.ok(JSON.stringify(s).length < 3000, "snapshot stays small");
    total += w.score.acid + w.score.bone;
    if (k === 0) console.log("sample:", JSON.stringify(w.score), "parked", JSON.stringify(w.park), "blocks left", w.blocks.length, "per robot", w.robots.map((r) => r.scored).join(","));
  }
  console.log("avg total points", (total / N).toFixed(1));
  assert.ok(total / N > 15, "bots actually play");
});

test("match length: program window + 15s auton + 1:45 driver", () => {
  const w = createArena(seats(1, 2), "1v1", 0, "len");
  const t1 = run(w, 0, (w) => w.phase === "auton");
  assert.equal(t1, T.program, "program window waits for the human");
  const t2 = run(w, t1, (w) => w.phase === "done");
  assert.ok(Math.abs(t2 - t1 - T.auton - T.driver) <= TICK_MS);
});
