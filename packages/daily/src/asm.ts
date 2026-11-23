// daily asm: a short x86-64 snippet (intel syntax). "what's in rax at the end?"
// a tiny emulator for the instruction subset computes the answer (and the step-by-step table
// for "show work"). generated snippets come from templates + the day's seed, easy on monday,
// hard on sunday. hand-written snippets from admin use the same parser + emulator.
import { dailyRng, weekday, type Rng } from "./core.ts";

const M = (1n << 64n) - 1n;
const SIGN = 1n << 63n;
export const u64 = (v: bigint) => v & M;
export const s64 = (v: bigint) => (v & SIGN ? (v & M) - (1n << 64n) : v & M);

export const REGS = ["rax", "rbx", "rcx", "rdx", "rsi", "rdi", "r8", "r9", "rsp"] as const;
export type Reg = (typeof REGS)[number];
export type Flags = { zf: boolean; sf: boolean; cf: boolean; of: boolean };
export type Cpu = { r: Record<Reg, bigint>; f: Flags; mem: Map<bigint, bigint> };

export type Operand = { k: "reg"; reg: Reg } | { k: "imm"; v: bigint } | { k: "mem"; base: Reg; index?: Reg; scale: bigint; disp: bigint };
export type Ins = { op: string; a?: Operand; b?: Operand; label?: string; line: number; text: string };
export type Program = { ins: Ins[]; labels: Map<string, number> };

export const OPS = ["mov", "add", "sub", "imul", "xor", "and", "or", "not", "neg", "shl", "shr", "sar", "inc", "dec", "lea", "cmp", "test", "push", "pop", "xchg", "jmp", "je", "jz", "jne", "jnz", "jl", "jle", "jg", "jge", "jb", "jbe", "ja", "jae", "js", "jns", "nop"] as const;
const JUMPS = new Set(["jmp", "je", "jz", "jne", "jnz", "jl", "jle", "jg", "jge", "jb", "jbe", "ja", "jae", "js", "jns"]);

export class AsmError extends Error {}

function parseOperand(s: string, line: number): Operand {
  s = s.trim().toLowerCase().replace(/^qword\s+(ptr\s+)?/, "");
  if ((REGS as readonly string[]).includes(s)) return { k: "reg", reg: s as Reg };
  const m = s.match(/^\[(.+)\]$/);
  if (m) {
    // [base], [base + disp], [base + index*scale + disp]
    let base: Reg | undefined, index: Reg | undefined, scale = 1n, disp = 0n;
    for (const raw of m[1].replace(/\s+/g, "").replace(/-/g, "+-").split("+").filter(Boolean)) {
      const sc = raw.match(/^([a-z0-9]+)\*(\d)$/);
      if (sc && (REGS as readonly string[]).includes(sc[1])) (index = sc[1] as Reg), (scale = BigInt(sc[2]));
      else if ((REGS as readonly string[]).includes(raw)) base ? (index = raw as Reg) : (base = raw as Reg);
      else disp += num(raw, line);
    }
    if (!base) throw new AsmError(`line ${line}: memory operand needs a base register`);
    if (![1n, 2n, 4n, 8n].includes(scale)) throw new AsmError(`line ${line}: scale must be 1, 2, 4 or 8`);
    return { k: "mem", base, index, scale, disp };
  }
  return { k: "imm", v: num(s, line) };
}

function num(s: string, line: number): bigint {
  const t = s.trim().toLowerCase();
  const neg = t.startsWith("-");
  const body = neg ? t.slice(1) : t;
  if (!/^(0x[0-9a-f_]+|0b[01_]+|\d[\d_]*)$/.test(body)) throw new AsmError(`line ${line}: can't read "${s}"`);
  const v = BigInt(body.replace(/_/g, ""));
  return neg ? -v : v;
}

/** intel syntax, one instruction per line, `label:` lines, `;` comments */
export function parse(src: string): Program {
  const ins: Ins[] = [];
  const labels = new Map<string, number>();
  src.split("\n").forEach((rawLine, i) => {
    const line = i + 1;
    let s = rawLine.replace(/;.*$/, "").trim();
    const lab = s.match(/^([a-z_.][a-z0-9_.]*):\s*(.*)$/i);
    if (lab) {
      labels.set(lab[1].toLowerCase(), ins.length);
      s = lab[2].trim();
    }
    if (!s) return;
    const sp = s.search(/\s/);
    const op = (sp < 0 ? s : s.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? "" : s.slice(sp + 1).trim();
    if (!(OPS as readonly string[]).includes(op)) throw new AsmError(`line ${line}: "${op}" isn't supported`);
    if (JUMPS.has(op)) return void ins.push({ op, label: rest.toLowerCase(), line, text: s });
    const parts = rest ? rest.split(",").map((x) => x.trim()) : [];
    ins.push({ op, a: parts[0] ? parseOperand(parts[0], line) : undefined, b: parts[1] ? parseOperand(parts[1], line) : undefined, line, text: s.replace(/\s+/g, " ") });
  });
  for (const x of ins) if (x.label !== undefined && !labels.has(x.label)) throw new AsmError(`line ${x.line}: no label "${x.label}"`);
  return { ins, labels };
}

export const STACK_TOP = 0x7fff0000n;
export const freshCpu = (): Cpu => ({
  r: Object.fromEntries(REGS.map((r) => [r, r === "rsp" ? STACK_TOP : 0n])) as Record<Reg, bigint>,
  f: { zf: false, sf: false, cf: false, of: false },
  mem: new Map(),
});

const addr = (c: Cpu, o: Extract<Operand, { k: "mem" }>) => u64(c.r[o.base] + (o.index ? c.r[o.index] * o.scale : 0n) + o.disp);
function read(c: Cpu, o: Operand | undefined, line: number): bigint {
  if (!o) throw new AsmError(`line ${line}: missing operand`);
  if (o.k === "reg") return c.r[o.reg];
  if (o.k === "imm") return u64(o.v);
  return c.mem.get(addr(c, o)) ?? 0n;
}
function write(c: Cpu, o: Operand | undefined, v: bigint, line: number) {
  if (!o || o.k === "imm") throw new AsmError(`line ${line}: can't write to that`);
  if (o.k === "reg") c.r[o.reg] = u64(v);
  else c.mem.set(addr(c, o), u64(v));
}
const zs = (c: Cpu, v: bigint) => {
  c.f.zf = u64(v) === 0n;
  c.f.sf = (u64(v) & SIGN) !== 0n;
};

export type Step = { line: number; text: string; regs: Record<Reg, bigint>; flags: Flags; mem: [bigint, bigint][] };

/** run a program. throws AsmError on bad code or when it runs too long. */
export function run(p: Program, maxSteps = 500, init?: (c: Cpu) => void): { cpu: Cpu; steps: Step[] } {
  const c = freshCpu();
  init?.(c);
  const steps: Step[] = [];
  let pc = 0;
  while (pc < p.ins.length) {
    if (steps.length >= maxSteps) throw new AsmError(`ran more than ${maxSteps} steps`);
    const x = p.ins[pc];
    let next = pc + 1;
    const A = () => read(c, x.a, x.line);
    const B = () => read(c, x.b, x.line);
    switch (x.op) {
      case "mov": {
        if (x.a?.k === "mem" && x.b?.k === "mem") throw new AsmError(`line ${x.line}: mov can't do memory to memory`);
        write(c, x.a, B(), x.line);
        break;
      }
      case "add": {
        const a = A(), b = B(), r = u64(a + b);
        c.f.cf = a + b > M;
        c.f.of = (a & SIGN) === (b & SIGN) && (r & SIGN) !== (a & SIGN);
        zs(c, r);
        write(c, x.a, r, x.line);
        break;
      }
      case "sub":
      case "cmp": {
        const a = A(), b = B(), r = u64(a - b);
        c.f.cf = a < b;
        c.f.of = (a & SIGN) !== (b & SIGN) && (r & SIGN) !== (a & SIGN);
        zs(c, r);
        if (x.op === "sub") write(c, x.a, r, x.line);
        break;
      }
      case "imul": {
        const full = s64(A()) * s64(B());
        const r = u64(full);
        c.f.cf = c.f.of = s64(r) !== full;
        zs(c, r); // undefined on real hardware; we set them like most emulators do
        write(c, x.a, r, x.line);
        break;
      }
      case "and":
      case "or":
      case "xor":
      case "test": {
        const a = A(), b = B();
        const r = x.op === "or" ? a | b : x.op === "xor" ? a ^ b : a & b;
        c.f.cf = c.f.of = false;
        zs(c, r);
        if (x.op !== "test") write(c, x.a, r, x.line);
        break;
      }
      case "not":
        write(c, x.a, ~A(), x.line);
        break;
      case "neg": {
        const a = A(), r = u64(-a);
        c.f.cf = a !== 0n;
        c.f.of = a === SIGN;
        zs(c, r);
        write(c, x.a, r, x.line);
        break;
      }
      case "inc":
      case "dec": {
        const a = A(), r = u64(x.op === "inc" ? a + 1n : a - 1n);
        c.f.of = x.op === "inc" ? a === SIGN - 1n : a === SIGN;
        zs(c, r); // cf untouched
        write(c, x.a, r, x.line);
        break;
      }
      case "shl":
      case "shr":
      case "sar": {
        const a = A();
        const n = B() & 63n;
        if (n === 0n) break; // count 0: nothing, flags untouched
        let r: bigint;
        if (x.op === "shl") {
          r = u64(a << n);
          c.f.cf = ((a >> (64n - n)) & 1n) === 1n;
          c.f.of = ((r & SIGN) !== 0n) !== c.f.cf;
        } else if (x.op === "shr") {
          r = a >> n;
          c.f.cf = ((a >> (n - 1n)) & 1n) === 1n;
          c.f.of = (a & SIGN) !== 0n;
        } else {
          r = u64(s64(a) >> n);
          c.f.cf = ((s64(a) >> (n - 1n)) & 1n) === 1n;
          c.f.of = false;
        }
        zs(c, r);
        write(c, x.a, r, x.line);
        break;
      }
      case "lea": {
        if (x.b?.k !== "mem") throw new AsmError(`line ${x.line}: lea needs [address]`);
        write(c, x.a, addr(c, x.b), x.line);
        break;
      }
      case "push":
        c.r.rsp = u64(c.r.rsp - 8n);
        c.mem.set(c.r.rsp, A());
        break;
      case "pop":
        write(c, x.a, c.mem.get(c.r.rsp) ?? 0n, x.line);
        c.r.rsp = u64(c.r.rsp + 8n);
        break;
      case "xchg": {
        const a = A(), b = B();
        write(c, x.a, b, x.line);
        write(c, x.b, a, x.line);
        break;
      }
      case "nop":
        break;
      default: {
        const { zf, sf, cf, of } = c.f;
        const take =
          x.op === "jmp" ? true
          : x.op === "je" || x.op === "jz" ? zf
          : x.op === "jne" || x.op === "jnz" ? !zf
          : x.op === "jl" ? sf !== of
          : x.op === "jle" ? zf || sf !== of
          : x.op === "jg" ? !zf && sf === of
          : x.op === "jge" ? sf === of
          : x.op === "jb" ? cf
          : x.op === "jbe" ? cf || zf
          : x.op === "ja" ? !cf && !zf
          : x.op === "jae" ? !cf
          : x.op === "js" ? sf
          : !sf; // jns
        if (take) next = p.labels.get(x.label!)!;
      }
    }
    steps.push({ line: x.line, text: x.text, regs: { ...c.r }, flags: { ...c.f }, mem: [...c.mem.entries()] });
    pc = next;
  }
  return { cpu: c, steps };
}

// ---------------------------------------------------------------- the question

export type Target = { k: "reg"; reg: Reg } | { k: "flag"; flag: keyof Flags } | { k: "mem"; addr: string };
export type AsmPuzzle = { src: string; target: Target; difficulty: number; source: "generated" | "curated" };

export const targetLabel = (t: Target) => (t.k === "reg" ? t.reg : t.k === "flag" ? `the ${t.flag.toUpperCase()} flag (0 or 1)` : `the qword at ${t.addr}`);

export function answer(p: AsmPuzzle): bigint {
  const { cpu } = run(parse(p.src));
  if (p.target.k === "reg") return cpu.r[p.target.reg];
  if (p.target.k === "flag") return cpu.f[p.target.flag] ? 1n : 0n;
  const o = parseOperand(p.target.addr, 0);
  if (o.k !== "mem") throw new AsmError("memory target must be [address]");
  return cpu.mem.get(addr(cpu, o)) ?? 0n;
}

/** player input → u64: decimal (negative ok, two's complement) or 0x hex */
export function parseGuess(s: string): bigint | null {
  const t = s.trim().toLowerCase().replace(/_/g, "");
  try {
    if (/^-?0x[0-9a-f]+$/.test(t)) return u64(t.startsWith("-") ? -BigInt(t.slice(1)) : BigInt(t));
    if (/^-?\d+$/.test(t)) {
      const v = BigInt(t);
      if (v >= 1n << 64n || v < -(1n << 63n)) return null;
      return u64(v);
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

export const hex = (v: bigint) => `0x${u64(v).toString(16)}`;

// ---------------------------------------------------------------- generator

const GP: Reg[] = ["rax", "rbx", "rcx", "rdx", "rsi", "rdi"];

/** monday 1 … sunday 7 */
export const difficultyFor = (day: string) => [7, 1, 2, 3, 4, 5, 6][weekday(day)];

function block(r: Rng, d: number, regs: Reg[]): string[] {
  const a = r.pick(regs), b = r.pick(regs.filter((x) => x !== a));
  const small = () => r.int(1, d < 3 ? 20 : 255);
  const kinds = [
    () => [`add ${a}, ${small()}`],
    () => [`sub ${a}, ${small()}`],
    () => [`add ${a}, ${b}`],
    () => [`sub ${a}, ${b}`],
    () => [`inc ${a}`],
    () => [`dec ${a}`],
    () => [`xor ${a}, ${r.int(1, 15)}`],
    () => [`and ${a}, ${r.pick([0xf, 0x3f, 0xff, 0xf0, 7])}`],
    () => [`or ${a}, ${r.pick([1, 2, 4, 8, 0x10, 0x80])}`],
  ];
  if (d >= 2) kinds.push(() => [`shl ${a}, ${r.int(1, 4)}`], () => [`shr ${a}, ${r.int(1, 3)}`], () => [`imul ${a}, ${r.int(2, 9)}`]);
  if (d >= 3) kinds.push(() => [`lea ${a}, [${b} + ${b}*${r.pick([2, 4, 8])} + ${r.int(1, 9)}]`], () => [`xchg ${a}, ${b}`], () => [`imul ${a}, ${b}`], () => [`push ${a}`, `pop ${b}`]);
  if (d >= 4) kinds.push(() => [`neg ${a}`], () => [`not ${a}`, `inc ${a}`], () => [`sar ${a}, ${r.int(1, 3)}`]);
  return r.pick(kinds)();
}

function generateOnce(r: Rng, d: number): AsmPuzzle {
  const regs = GP.slice(0, d < 3 ? 2 : d < 5 ? 3 : 4);
  const lines: string[] = regs.map((x) => `mov ${x}, ${r.int(1, d < 3 ? 30 : d < 5 ? 200 : 1000)}`);
  const want = d <= 2 ? r.int(4, 7) : d <= 4 ? r.int(6, 9) : r.int(8, 12);
  // branchy / loopy shapes for the harder days
  if (d >= 5 && r.chance(0.55)) {
    const n = r.int(3, 6);
    const acc = r.pick(regs.filter((x) => x !== "rcx"));
    if (!regs.includes("rcx")) lines.push(`mov rcx, ${n}`);
    else lines[regs.indexOf("rcx")] = `mov rcx, ${n}`;
    lines.push("loop:", ...block(r, Math.min(d, 3), [acc]), `add ${acc}, rcx`, "dec rcx", "jnz loop");
  } else if (d >= 4 && r.chance(0.6)) {
    const [a, b] = r.shuffle([...regs]).slice(0, 2);
    const jcc = r.pick(d >= 6 ? ["jl", "jg", "jb", "ja", "jle", "jae"] : ["je", "jne", "jl", "jg"]);
    lines.push(`cmp ${a}, ${b}`, `${jcc} skip`, ...block(r, d, regs), "skip:");
  }
  while (lines.filter((l) => !l.endsWith(":")).length < want) lines.push(...block(r, d, regs));
  const target: Target =
    d >= 6 && r.chance(0.2) ? { k: "flag", flag: r.pick(["zf", "cf", "sf"] as const) } : d >= 5 && r.chance(0.15) ? { k: "reg", reg: r.pick(regs.filter((x) => x !== "rax")) } : { k: "reg", reg: "rax" };
  return { src: lines.map((l) => (l.endsWith(":") ? l : `  ${l}`)).join("\n"), target, difficulty: d, source: "generated" };
}

/** rejects: too long to run, too many lines, and answers you could guess without reading */
export function acceptable(p: AsmPuzzle): boolean {
  let res: bigint;
  try {
    const prog = parse(p.src);
    if (prog.ins.length < 4 || prog.ins.length > 12) return false;
    const { steps } = run(prog, 80);
    if (steps.length > 60) return false;
    res = answer(p);
  } catch {
    return false;
  }
  if (p.target.k === "flag") return true;
  if (res === 0n) return false;
  const imms = new Set([...p.src.matchAll(/-?\b\d+\b/g)].map((m) => BigInt(m[0])));
  if (imms.has(s64(res))) return false; // the answer is just a number already on screen
  if (s64(res) > 1_000_000_000n || s64(res) < -1_000_000n) return false; // keep it typeable
  return true;
}

export function dailyAsm(day: string): AsmPuzzle {
  const r = dailyRng("asm", day);
  const d = difficultyFor(day);
  for (let i = 0; i < 500; i++) {
    const p = generateOnce(r, d);
    if (acceptable(p)) return p;
  }
  return { src: "  mov rax, 6\n  mov rbx, 7\n  imul rax, rbx\n  add rax, 0x10", target: { k: "reg", reg: "rax" }, difficulty: 1, source: "generated" };
}
