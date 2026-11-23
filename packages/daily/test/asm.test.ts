import { test } from "node:test";
import assert from "node:assert/strict";
import { AsmError, acceptable, answer, dailyAsm, difficultyFor, hex, parse, parseGuess, run, s64, u64 } from "../src/asm.ts";
import { addDays, LAUNCH } from "../src/core.ts";

const go = (src: string) => run(parse(src)).cpu;
const MAX = (1n << 64n) - 1n;

test("mov / add / sub wrap at 64 bits", () => {
  let c = go("mov rax, 0xffffffffffffffff\nadd rax, 1");
  assert.equal(c.r.rax, 0n);
  assert.ok(c.f.zf && c.f.cf && !c.f.of && !c.f.sf);
  c = go("mov rax, 0\nsub rax, 1");
  assert.equal(c.r.rax, MAX);
  assert.ok(c.f.cf && c.f.sf && !c.f.zf && !c.f.of);
  c = go("mov rax, 0x7fffffffffffffff\nadd rax, 1");
  assert.equal(c.r.rax, 1n << 63n);
  assert.ok(c.f.of && c.f.sf && !c.f.cf);
  c = go("mov rax, 0x8000000000000000\nsub rax, 1");
  assert.ok(c.f.of && !c.f.sf && !c.f.cf);
  c = go("mov rax, -5");
  assert.equal(c.r.rax, MAX - 4n);
});

test("cmp sets flags without writing; jcc follow them (signed vs unsigned)", () => {
  const c = go("mov rax, 3\nmov rbx, 5\ncmp rax, rbx");
  assert.equal(c.r.rax, 3n);
  assert.ok(c.f.cf && c.f.sf && !c.f.zf);
  // -1 vs 1: signed less, unsigned above
  const br = (j: string) => go(`mov rax, -1\nmov rbx, 1\nmov rcx, 0\ncmp rax, rbx\n${j} yes\njmp end\nyes:\nmov rcx, 1\nend:`).r.rcx;
  assert.equal(br("jl"), 1n);
  assert.equal(br("jg"), 0n);
  assert.equal(br("jb"), 0n);
  assert.equal(br("ja"), 1n);
  assert.equal(br("jle"), 1n);
  assert.equal(br("jae"), 1n);
  assert.equal(br("jne"), 1n);
  assert.equal(br("je"), 0n);
  assert.equal(br("js"), 1n);
  assert.equal(go("mov rax, 4\ncmp rax, 4\nmov rbx, 0\njbe t\njmp e\nt:\nmov rbx, 9\ne:").r.rbx, 9n);
});

test("logic ops clear cf/of; not leaves flags alone", () => {
  let c = go("mov rax, 0b1100\nand rax, 0b1010");
  assert.equal(c.r.rax, 8n);
  assert.ok(!c.f.cf && !c.f.of);
  c = go("mov rax, 5\nxor rax, rax");
  assert.ok(c.f.zf && c.r.rax === 0n);
  c = go("mov rax, 1\nsub rax, 2\nnot rax");
  assert.equal(c.r.rax, 0n);
  assert.ok(c.f.cf, "not must not touch flags");
  assert.equal(go("mov rax, 0x10\nor rax, 3").r.rax, 0x13n);
});

test("inc/dec keep cf; neg flags", () => {
  let c = go("mov rax, 0\nsub rax, 1\ninc rax");
  assert.equal(c.r.rax, 0n);
  assert.ok(c.f.zf && c.f.cf, "inc keeps cf from the sub");
  c = go("mov rax, 0x7fffffffffffffff\ninc rax");
  assert.ok(c.f.of);
  c = go("mov rax, 5\nneg rax");
  assert.equal(s64(c.r.rax), -5n);
  assert.ok(c.f.cf && c.f.sf);
  c = go("mov rax, 0\nneg rax");
  assert.ok(!c.f.cf && c.f.zf);
  c = go("mov rax, 0x8000000000000000\nneg rax");
  assert.ok(c.f.of && c.r.rax === 1n << 63n);
});

test("shifts: results, carry out, sar sign, count masking, count 0", () => {
  let c = go("mov rax, 0b1011\nshl rax, 2");
  assert.equal(c.r.rax, 0b101100n);
  assert.ok(!c.f.cf);
  c = go("mov rax, 0x8000000000000001\nshl rax, 1");
  assert.equal(c.r.rax, 2n);
  assert.ok(c.f.cf && c.f.of === true); // msb(result)=0 xor cf=1
  c = go("mov rax, 0b1011\nshr rax, 1");
  assert.equal(c.r.rax, 0b101n);
  assert.ok(c.f.cf);
  c = go("mov rax, -16\nsar rax, 2");
  assert.equal(s64(c.r.rax), -4n);
  c = go("mov rax, -16\nshr rax, 60");
  assert.equal(c.r.rax, 0xfn);
  c = go("mov rax, 1\nshl rax, 65"); // count & 63 = 1
  assert.equal(c.r.rax, 2n);
  c = go("mov rax, 1\nsub rax, 2\nshl rax, 0"); // count 0: flags untouched
  assert.ok(c.f.cf && c.r.rax === MAX);
});

test("imul truncates and flags overflow", () => {
  let c = go("mov rax, -3\nimul rax, 7");
  assert.equal(s64(c.r.rax), -21n);
  assert.ok(!c.f.cf && !c.f.of);
  c = go("mov rax, 0x100000000\nimul rax, 0x100000000");
  assert.equal(c.r.rax, 0n);
  assert.ok(c.f.cf && c.f.of);
  c = go("mov rax, 6\nmov rbx, 7\nimul rax, rbx");
  assert.equal(c.r.rax, 42n);
});

test("lea doesn't touch memory or flags", () => {
  const c = go("mov rbx, 10\nmov rcx, 3\ncmp rbx, rbx\nlea rax, [rbx + rcx*8 + 5]");
  assert.equal(c.r.rax, 39n);
  assert.ok(c.f.zf);
  assert.equal(go("mov rbx, 10\nlea rax, [rbx - 4]").r.rax, 6n);
});

test("push/pop/xchg/memory", () => {
  let c = go("mov rax, 1\nmov rbx, 2\npush rax\npush rbx\npop rax\npop rbx");
  assert.deepEqual([c.r.rax, c.r.rbx], [2n, 1n]);
  assert.equal(c.r.rsp, 0x7fff0000n);
  c = go("mov rax, 7\nmov rbx, 9\nxchg rax, rbx");
  assert.deepEqual([c.r.rax, c.r.rbx], [9n, 7n]);
  c = go("mov rax, 5\npush rax\nmov qword [rsp], 11\nadd qword [rsp], 1\npop rbx");
  assert.equal(c.r.rbx, 12n);
  assert.equal(answer({ src: "mov rax, 3\npush rax\nadd rax, 1\npush rax", target: { k: "mem", addr: "[rsp+8]" }, difficulty: 1, source: "curated" }), 3n);
});

test("loops run and long loops are caught", () => {
  assert.equal(go("mov rcx, 5\nmov rax, 0\nl:\nadd rax, rcx\ndec rcx\njnz l").r.rax, 15n);
  assert.throws(() => run(parse("l:\njmp l"), 100), AsmError);
});

test("parser errors are friendly", () => {
  assert.throws(() => parse("movx rax, 1"), /isn't supported/);
  assert.throws(() => parse("jmp nowhere"), /no label/);
  assert.throws(() => parse("mov rax, [rbx*3]"), AsmError);
  assert.equal(parse("  mov rax, 1 ; comment\n\nx: add rax, 2").ins.length, 2);
});

test("guess parsing: decimal, negative, hex", () => {
  assert.equal(parseGuess("42"), 42n);
  assert.equal(parseGuess("0x2A"), 42n);
  assert.equal(parseGuess("-1"), MAX);
  assert.equal(parseGuess("0xffffffffffffffff"), MAX);
  assert.equal(parseGuess("1_000"), 1000n);
  assert.equal(parseGuess("nope"), null);
  assert.equal(parseGuess(""), null);
  assert.equal(hex(255n), "0xff");
  assert.equal(u64(-1n), MAX);
});

test("a year of generated snippets: valid, sized, non-trivial, ramped", () => {
  const byD = new Map<number, number[]>();
  for (let i = 0; i < 365; i++) {
    const day = addDays(LAUNCH, i);
    const p = dailyAsm(day);
    assert.deepEqual(p, dailyAsm(day));
    assert.ok(acceptable(p), `${day}:\n${p.src}`);
    assert.equal(p.difficulty, difficultyFor(day));
    const n = parse(p.src).ins.length;
    byD.set(p.difficulty, [...(byD.get(p.difficulty) ?? []), n]);
  }
  const avg = (d: number) => byD.get(d)!.reduce((a, b) => a + b, 0) / byD.get(d)!.length;
  assert.ok(avg(1) < avg(7), `mon ${avg(1)} vs sun ${avg(7)}`);
});
