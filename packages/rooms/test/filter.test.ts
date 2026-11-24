import { test } from "node:test";
import assert from "node:assert/strict";
import { bannedHit, checkChat, cleanText, compile, hasLink, hasPersonal, nameAllowed } from "../src/filter.ts";
import { cleanName, randomName, NAME_MAX } from "../src/names.ts";

// placeholder words stand in for the real list (which lives in d1)
const rules = compile(`
# comment line
ass
*badword*
kill yourself
x
`);

test("compile skips comments, blanks and 1-letter rules", () => {
  assert.equal(rules.length, 3);
  assert.deepEqual(rules.map((r) => r.anywhere), [false, true, true]);
});

test("whole-word rules catch tricks but not innocent words", () => {
  for (const s of ["ass", "ASS", "a$$", "4ss", "a s s", "a.s.s", "assss", "аss" /* cyrillic а */, "ás​s" /* accent + zero-width */, "you a s s hat"])
    assert.ok(bannedHit(s, rules), `should block: ${s}`);
  for (const s of ["class", "pass the salt", "assassin", "as", "455 bucks", "bass guitar"])
    assert.equal(bannedHit(s, rules), null, `should allow: ${s}`);
});

test("anywhere rules and phrases", () => {
  assert.ok(bannedHit("totallybadwordhere", rules));
  assert.ok(bannedHit("b4dw0rd", rules));
  assert.ok(bannedHit("b a d w o r d", rules));
  assert.ok(bannedHit("just kill    your self", rules));
  assert.ok(bannedHit("k1ll y0urs3lf", rules));
  assert.equal(bannedHit("kill the engine yourself", rules), null);
});

test("links are blocked in all the usual disguises", () => {
  for (const s of ["https://x.y", "go to www.site", "edwrdq.com", "discord dot gg/abc", "join discord.gg", "my site (dot) com", "example . io", "t.me/whatever"])
    assert.ok(hasLink(s), s);
  for (const s of ["e.g. this", "lol.ok", "nice bid", "3.5k", "the v8 is a 5.0", "node js"]) assert.equal(hasLink(s), false, s);
});

test("personal info: emails and phone numbers", () => {
  for (const s of ["me@mail.com", "me (at) mail dot com", "call 555-867-5309 now", "+1 (555) 867 5309"]) assert.ok(hasPersonal(s), s);
  for (const s of ["bid 25000", "lot 4 of 6", "$9,500"]) assert.equal(hasPersonal(s), false, s);
});

test("checkChat cleans, limits and reports why", () => {
  assert.deepEqual(checkChat("  hi\n\tthere  ", rules), { ok: true, text: "hi there" });
  assert.deepEqual(checkChat("   ", rules), { ok: false, reason: "empty" });
  assert.deepEqual(checkChat("a".repeat(201), rules), { ok: false, reason: "long" });
  assert.deepEqual(checkChat("a".repeat(200), rules).ok, true);
  assert.deepEqual(checkChat("a$$", rules), { ok: false, reason: "blocked" });
  assert.deepEqual(checkChat("go.to/site.com", rules), { ok: false, reason: "link" });
  assert.equal(cleanText("a‮b​c"), "abc");
  assert.equal(cleanText("q\u0301\u0301\u0301\u0301"), "q\u0301\u0301");
});

test("nicknames", () => {
  for (let i = 0; i < 500; i++) {
    const n = randomName();
    assert.ok(n.length <= NAME_MAX && cleanName(n) === n, n);
  }
  assert.equal(cleanName("  Rusty Civic  42 "), "rusty-civic-42");
  assert.equal(cleanName("<script>"), "script");
  assert.equal(cleanName("a"), null);
  assert.equal(cleanName("x".repeat(40))!.length, NAME_MAX);
  assert.equal(nameAllowed("quiet-piston-7", rules), true);
  assert.equal(nameAllowed("big-a-s-s", rules), false);
  assert.equal(nameAllowed("badword-99", rules), false);
});
