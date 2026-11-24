import { test } from "node:test";
import assert from "node:assert/strict";
import { act, BANKROLL, createAuction, fees, makeLots, maxBid, nextWake, outcome, tick, view, carName, type AuctionState } from "../src/auction.ts";

function play(seed: string, humans = 0) {
  const seats = Array.from({ length: 5 }, (_, i) => ({ seat: i, nick: `p${i}`, bot: i >= humans }));
  let now = 1_000_000;
  const s = createAuction(seed, seats, now);
  let steps = 0;
  while (s.phase !== "done" && steps++ < 5000) {
    now = nextWake(s)!;
    tick(s, now);
  }
  return { s, ms: now - 1_000_000 };
}

test("same seed, same cars", () => {
  assert.deepEqual(makeLots("abc"), makeLots("abc"));
  assert.notDeepEqual(makeLots("abc"), makeLots("abd"));
});

test("lots are believable", () => {
  for (let i = 0; i < 300; i++) {
    for (const l of makeLots(`s${i}`)) {
      const o = outcome(l);
      assert.ok(l.retail >= 2500 && l.retail <= 60_000, `retail ${l.retail}`);
      assert.ok(l.open >= 100 && l.open < l.retail, `open ${l.open}`);
      assert.ok(o.repairs > 0 && o.repairs < 20_000, `repairs ${o.repairs} ${carName(l)} ${l.damage}`);
      assert.ok(o.resale > 0 && o.resale <= l.retail, "resale under clean retail");
      assert.ok(o.days >= 1 && o.days < 40, `days ${o.days}`);
      assert.equal(l.items.filter((x) => x.hidden).length, 3);
      for (const it of l.items) for (const ln of it.lines) assert.ok(ln.parts >= 0 && ln.labor >= 0 && Number.isInteger(ln.parts));
    }
  }
});

test("fees scale with price and cash covers bid + fees", () => {
  assert.ok(fees(300).total < fees(3000).total && fees(3000).total < fees(20000).total);
  for (const cash of [500, 5000, 25000]) {
    const m = maxBid(cash);
    assert.ok(m + fees(m).total <= cash && m + 1 + fees(m + 1).total > cash);
  }
});

test("bidding rules: increments, cash, self-outbid, anti-snipe", () => {
  const seats = [0, 1].map((i) => ({ seat: i, nick: `h${i}`, bot: false }));
  const s: AuctionState = createAuction("rules", seats, 0);
  tick(s, s.ends); // → preview
  const hidden = s.lots[0].items.findIndex((x) => x.hidden);
  assert.equal(act(s, 0, { a: "inspect", item: hidden }, 1).ok, true);
  assert.equal(act(s, 0, { a: "inspect", item: hidden }, 1).ok, false, "one inspection per lot");
  assert.equal(view(s, 0, 1).lot.items[hidden].text !== null, true, "you see what you paid for");
  assert.equal(view(s, 1, 1).lot.items[hidden].text, null, "nobody else does");
  assert.equal(act(s, 0, { a: "bid", inc: 100 }, 1).ok, false, "no bids in preview");
  tick(s, s.ends); // → bidding
  const t0 = s.ends - 20_000;
  assert.equal(act(s, 0, { a: "bid", inc: 100 }, t0).ok, true);
  assert.equal(s.high!.amount, s.lots[0].open);
  assert.equal(act(s, 0, { a: "bid", inc: 100 }, t0).ok, false, "can't outbid yourself");
  assert.equal(act(s, 1, { a: "bid", inc: 333 }, t0).ok, false, "fixed increments");
  assert.equal(act(s, 1, { a: "bid", inc: 500 }, t0).ok, true);
  const late = s.ends - 1000;
  act(s, 0, { a: "bid", inc: 250 }, late);
  assert.equal(s.ends, late + 5000, "late bid extends the clock");
  s.players[1].cash = 100;
  assert.equal(act(s, 1, { a: "bid", inc: 100 }, late).ok, false, "can't bid past your cash");
  tick(s, s.ends);
  const sale = s.sales[0];
  assert.equal(sale.seat, 0);
  assert.equal(s.players[0].cash, BANKROLL - s.lots[0].items[hidden].cost - sale.price - sale.fees - sale.repairs + sale.resale);
  assert.equal(sale.profit, sale.resale - sale.price - sale.fees - sale.repairs);
  assert.ok(view(s, 1, s.ends).lot.items.every((x) => x.text !== null), "everything revealed after the hammer");
});

test("bots-only games finish in a sensible time with sensible money", () => {
  let mins = 0, sold = 0, total = 0, profits: number[] = [];
  const N = 200;
  for (let i = 0; i < N; i++) {
    const { s, ms } = play(`sim${i}`);
    mins += ms / 60_000;
    sold += s.sales.filter((x) => x.seat !== null).length;
    total += s.sales.length;
    for (const x of s.sales) if (x.seat !== null) profits.push(x.profit);
  }
  profits.sort((a, b) => a - b);
  const q = (f: number) => profits[Math.floor(profits.length * f)];
  console.log(`avg game ${(mins / N).toFixed(1)} min · ${((sold / total) * 100).toFixed(0)}% of lots sold · profit/car p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)}`);
  assert.ok(mins / N > 5 && mins / N < 9, "about 6–8 minutes");
  assert.ok(sold / total > 0.6, "bots buy most cars");
  assert.ok(q(0.5) > -3000 && q(0.5) < 5000, "median flip is in a sane range");
  assert.ok(q(0.1) < 0, "some buys go badly");
});
