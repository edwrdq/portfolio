// load the agent-written starter content into d1: diagnose cases, estimate questions, example
// logic proofs. everything goes in as author 'agent', status 'unverified', unscheduled, so none of
// it reaches the site until eddy approves + schedules it in admin → daily. safe to re-run: rows
// that already exist (same question / same case / same title) are skipped.
//   node scripts/seed-daily.mjs > /tmp/seed.sql && wrangler d1 execute edwrdq-db --file /tmp/seed.sql [--local|--remote]
import { checkDiagnose, checkEstimate, checkOverride, diagnoseToRow } from "../packages/daily/src/curated.ts";
import diagnose from "./seeds/diagnose.mjs";
import estimate from "./seeds/estimate.mjs";
import logic from "./seeds/logic.mjs";

const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const out = [];
const bad = [];

diagnose.forEach((c, i) => {
  const e = checkDiagnose(c);
  if (e.length) return bad.push(`diagnose #${i + 1}: ${e.join("; ")}`);
  const r = diagnoseToRow(c);
  const cols = Object.keys(r);
  out.push(
    `INSERT INTO diagnose_cases (${cols.join(", ")}, author, status) SELECT ${cols.map((k) => q(r[k])).join(", ")}, 'agent', 'unverified' WHERE NOT EXISTS (SELECT 1 FROM diagnose_cases WHERE complaint = ${q(r.complaint)} AND answer = ${q(r.answer)});`,
  );
});
estimate.forEach((x, i) => {
  const e = checkEstimate(x);
  if (e.length) return bad.push(`estimate #${i + 1}: ${e.join("; ")}`);
  out.push(
    `INSERT INTO estimate_questions (question, answer, unit, reasoning, source_url, flags, author, status) SELECT ${[x.question, x.answer, x.unit, x.reasoning, x.source_url, JSON.stringify(x.flags ?? [])].map(q).join(", ")}, 'agent', 'unverified' WHERE NOT EXISTS (SELECT 1 FROM estimate_questions WHERE question = ${q(x.question)});`,
  );
});
logic.forEach((o, i) => {
  const e = checkOverride(o.game, o.kind, o.data);
  if (e.length) return bad.push(`logic #${i + 1}: ${e.join("; ")}`);
  out.push(
    `INSERT INTO daily_overrides (game, kind, data, title, author, status) SELECT ${[o.game, o.kind, JSON.stringify(o.data), o.title].map(q).join(", ")}, 'agent', 'unverified' WHERE NOT EXISTS (SELECT 1 FROM daily_overrides WHERE game = ${q(o.game)} AND kind = ${q(o.kind)} AND title = ${q(o.title)});`,
  );
});

if (bad.length) {
  console.error(bad.join("\n"));
  process.exit(1);
}
console.log(out.join("\n"));
console.error(`seed: ${diagnose.length} diagnose, ${estimate.length} estimate, ${logic.length} logic → sql`);
