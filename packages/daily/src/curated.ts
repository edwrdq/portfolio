// curated daily content: shapes, validation, and db row ↔ object conversion. shared by the admin
// `daily` tool (editing) and the site's puzzle api (serving).
import { parse, AsmError, answer, type AsmPuzzle } from "./asm.ts";
import { validCurated, type CuratedLogic } from "./logic.ts";

export type Choice = { id: string; label: string };
export type DiagnoseCase = {
  vehicle: { year: number; make: string; model: string; engine: string; miles?: number };
  complaint: string;
  symptoms: string[];
  codes: { code: string; desc: string; status: "stored" | "pending" | "permanent" }[];
  live: { label: string; value: string; unit: string; note?: string }[];
  test: { name: string; result: string };
  answer: string;
  choices: Choice[];
  explanation: string;
  clues: string[]; // 5 notes: how each clue pointed to the answer
  flags: string[]; // things to double-check before approving
};

export type EstimateQuestion = { question: string; answer: number; unit: string; reasoning: string; source_url: string; flags: string[] };

export type AsmOverride = { src: string; target: AsmPuzzle["target"] };

export type Status = "unverified" | "approved";
export type Meta = { id: number; status: Status; author: "eddy" | "agent"; scheduled_for: string | null };

const str = (v: unknown, max = 2000) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const arr = (v: unknown) => Array.isArray(v);

/** returns a list of problems (empty = ok) */
export function checkDiagnose(x: unknown): string[] {
  const c = x as DiagnoseCase;
  const e: string[] = [];
  if (!c || typeof c !== "object") return ["not an object"];
  if (!c.vehicle || !Number.isInteger(c.vehicle.year) || !str(c.vehicle.make, 40) || !str(c.vehicle.model, 60) || !str(c.vehicle.engine, 80)) e.push("vehicle needs year, make, model, engine");
  if (!str(c.complaint, 300)) e.push("complaint");
  if (!arr(c.symptoms) || !c.symptoms.length || !c.symptoms.every((s) => str(s, 300))) e.push("symptoms: at least one");
  if (!arr(c.codes) || !c.codes.every((k) => /^[PBCU][0-9A-F]{4}$/.test(k?.code ?? "") && str(k.desc, 120) && ["stored", "pending", "permanent"].includes(k.status))) e.push("codes: [{code like P0171, desc, status stored|pending|permanent}] (empty list is ok)");
  if (!arr(c.live) || !c.live.length || !c.live.every((r) => str(r?.label, 40) && str(r.value, 20) && typeof r.unit === "string")) e.push("live: [{label, value, unit}]");
  if (!c.test || !str(c.test.name, 80) || !str(c.test.result, 400)) e.push("test: {name, result}");
  if (!arr(c.choices) || c.choices.length < 4 || c.choices.length > 10 || !c.choices.every((k) => str(k?.id, 40) && str(k.label, 80))) e.push("choices: 4–10 of {id, label}");
  else if (new Set(c.choices.map((k) => k.id)).size !== c.choices.length) e.push("choice ids must be unique");
  if (!arr(c.choices) || !c.choices.some((k) => k?.id === c.answer)) e.push("answer must be one of the choice ids");
  if (!str(c.explanation, 3000)) e.push("explanation");
  if (!arr(c.clues) || c.clues.length !== 5 || !c.clues.every((s) => str(s, 600))) e.push("clues: exactly 5 notes");
  if (c.flags !== undefined && (!arr(c.flags) || !c.flags.every((s) => typeof s === "string"))) e.push("flags: string[]");
  return e;
}

export function checkEstimate(x: unknown): string[] {
  const q = x as EstimateQuestion;
  const e: string[] = [];
  if (!q || typeof q !== "object") return ["not an object"];
  if (!str(q.question, 400)) e.push("question");
  if (typeof q.answer !== "number" || !(q.answer > 0) || !Number.isFinite(q.answer)) e.push("answer: a positive number");
  if (typeof q.unit !== "string" || q.unit.length > 40) e.push("unit");
  if (!str(q.reasoning, 3000)) e.push("reasoning");
  if (!/^https?:\/\/\S+$/.test(q.source_url ?? "")) e.push("source_url: a real link");
  return e;
}

export function checkOverride(game: string, kind: string, data: unknown): string[] {
  if (game === "asm" && kind === "asm") {
    const a = data as AsmOverride;
    if (!a || !str(a.src, 2000) || !a.target) return ["asm: {src, target: {k:'reg', reg:'rax'} | {k:'flag', flag:'zf'} | {k:'mem', addr:'[rsp]'}}"];
    try {
      const n = parse(a.src).ins.length;
      if (n < 1 || n > 30) return ["asm: 1–30 instructions"];
      answer({ ...a, difficulty: 0, source: "curated" });
      return [];
    } catch (err) {
      return [`asm: ${err instanceof AsmError ? err.message : String(err)}`];
    }
  }
  if (game === "logic" && (kind === "order" || kind === "badstep")) return validCurated({ ...(data as object), kind }) ? [] : [`logic ${kind}: {claim, steps[3+]${kind === "badstep" ? ", bad (0-based index), explain" : ""}}`];
  return [`unknown override: ${game}/${kind}`];
}

// ---------------------------------------------------------------- db rows

const j = <T>(s: unknown, d: T): T => {
  try {
    return typeof s === "string" ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};

export function diagnoseFromRow(r: Record<string, unknown>): DiagnoseCase & Meta {
  return {
    id: r.id as number,
    status: r.status as Status,
    author: r.author as Meta["author"],
    scheduled_for: (r.scheduled_for as string) ?? null,
    vehicle: j(r.vehicle, { year: 0, make: "", model: "", engine: "" }),
    complaint: r.complaint as string,
    symptoms: j(r.symptoms, []),
    codes: j(r.codes, []),
    live: j(r.live_data, []),
    test: j(r.test_result, { name: "", result: "" }),
    answer: r.answer as string,
    choices: j(r.choices, []),
    explanation: r.explanation as string,
    clues: j(r.clue_notes, []),
    flags: j(r.flags, []),
  };
}

export const diagnoseToRow = (c: DiagnoseCase) => ({
  vehicle: JSON.stringify(c.vehicle),
  complaint: c.complaint.trim(),
  symptoms: JSON.stringify(c.symptoms),
  codes: JSON.stringify(c.codes),
  live_data: JSON.stringify(c.live),
  test_result: JSON.stringify(c.test),
  answer: c.answer,
  choices: JSON.stringify(c.choices),
  explanation: c.explanation.trim(),
  clue_notes: JSON.stringify(c.clues),
  flags: JSON.stringify(c.flags ?? []),
});

export function estimateFromRow(r: Record<string, unknown>): EstimateQuestion & Meta {
  return {
    id: r.id as number,
    status: r.status as Status,
    author: r.author as Meta["author"],
    scheduled_for: (r.scheduled_for as string) ?? null,
    question: r.question as string,
    answer: r.answer as number,
    unit: r.unit as string,
    reasoning: r.reasoning as string,
    source_url: r.source_url as string,
    flags: j(r.flags, []),
  };
}

export type Override = Meta & { game: string; kind: string; title: string; data: unknown };
export const overrideFromRow = (r: Record<string, unknown>): Override => ({
  id: r.id as number,
  status: r.status as Status,
  author: r.author as Meta["author"],
  scheduled_for: (r.scheduled_for as string) ?? null,
  game: r.game as string,
  kind: r.kind as string,
  title: (r.title as string) ?? "",
  data: j(r.data, null),
});

/** what the public puzzle api hands a game for a date */
export type Served =
  | { kind: "asm"; data: AsmOverride }
  | { kind: "order" | "badstep"; data: CuratedLogic }
  | { kind: "diagnose"; data: Omit<DiagnoseCase, "flags"> & { id: number } }
  | { kind: "estimate"; data: Omit<EstimateQuestion, "flags"> & { id: number } };
