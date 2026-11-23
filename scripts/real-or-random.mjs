// builds the daily "real or random" rounds. run it once in a while (it fills days ahead), then
// upload the output to kv. visitors only ever read one precomputed kv key per day.
//
//   node scripts/real-or-random.mjs [--start YYYY-MM-DD] [--days 400] [--out raw/rr/kv.json]
//   cd apps/site && npx wrangler kv bulk put ../../raw/rr/kv.json --binding STATS --remote
//
// data comes straight from the publishers (public domain, cited on every reveal):
//   eia — u.s. energy information administration, daily spot prices
//   federal reserve board — h.10 foreign exchange rates (noon buying rates in new york)
// not fred: fred's terms forbid caching. not stocks/indices: those are licensed.
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, dayKey } from "../packages/daily/src/core.ts";
import { makeDay, ROUNDS } from "../packages/daily/src/rr.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "raw/rr");
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const START = arg("start", dayKey());
const DAYS = Number(arg("days", 400));
const OUT = resolve(ROOT, arg("out", "raw/rr/kv.json"));

const EIA = "U.S. Energy Information Administration";
const FED = "Board of Governors of the Federal Reserve System (H.10)";
const SERIES = [
  { id: "wti", name: "wti crude oil (cushing, ok)", unit: "$/barrel", source: EIA, url: "https://www.eia.gov/dnav/pet/hist/RWTCD.htm", kind: "eia" },
  { id: "brent", name: "brent crude oil (europe)", unit: "$/barrel", source: EIA, url: "https://www.eia.gov/dnav/pet/hist/RBRTED.htm", kind: "eia" },
  { id: "natgas", name: "henry hub natural gas", unit: "$/mmbtu", source: EIA, url: "https://www.eia.gov/dnav/ng/hist/rngwhhdD.htm", kind: "eia" },
  { id: "eur", name: "euro (usd per eur)", unit: "$", source: FED, url: "https://www.federalreserve.gov/releases/h10/hist/dat00_eu.htm", kind: "fed" },
  { id: "jpy", name: "japanese yen (jpy per usd)", unit: "¥", source: FED, url: "https://www.federalreserve.gov/releases/h10/hist/dat00_ja.htm", kind: "fed" },
  { id: "gbp", name: "british pound (usd per gbp)", unit: "$", source: FED, url: "https://www.federalreserve.gov/releases/h10/hist/dat00_uk.htm", kind: "fed" },
  { id: "cad", name: "canadian dollar (cad per usd)", unit: "c$", source: FED, url: "https://www.federalreserve.gov/releases/h10/hist/dat00_ca.htm", kind: "fed" },
  { id: "mxn", name: "mexican peso (mxn per usd)", unit: "mx$", source: FED, url: "https://www.federalreserve.gov/releases/h10/hist/dat00_mx.htm", kind: "fed" },
  { id: "chf", name: "swiss franc (chf per usd)", unit: "chf", source: FED, url: "https://www.federalreserve.gov/releases/h10/hist/dat00_sz.htm", kind: "fed" },
];

const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
const rows = (html) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1])));

/** eia weekly table: "1986 Jan- 6 to Jan-10" then mon…fri values */
function parseEia(html) {
  const out = [];
  for (const r of rows(html)) {
    const m = r[0]?.match(/^(\d{4})\s+([A-Za-z]{3})-\s*(\d+)\s+to/);
    if (!m) continue;
    const start = new Date(Date.UTC(+m[1], MON[m[2].toUpperCase()], +m[3]));
    for (let k = 0; k < 5; k++) {
      const v = parseFloat(r[k + 1]);
      if (Number.isFinite(v)) out.push([new Date(start.getTime() + k * 86_400_000).toISOString().slice(0, 10), v]);
    }
  }
  return out;
}
/** fed h.10 history: "3-JAN-00" then a rate ("ND" = no data) */
function parseFed(html) {
  const out = [];
  for (const r of rows(html)) {
    const m = r[0]?.match(/^(\d{1,2})-([A-Z]{3})-(\d{2})$/);
    if (!m) continue;
    const v = parseFloat(r[1]);
    if (!Number.isFinite(v)) continue;
    const yy = +m[3];
    out.push([iso(yy < 70 ? 2000 + yy : 1900 + yy, MON[m[2]], +m[1]), v]);
  }
  return out;
}

async function fetchCached(s) {
  const file = join(RAW, `${s.id}.html`);
  const fresh = await stat(file).then((x) => Date.now() - x.mtimeMs < 7 * 86_400_000, () => false);
  if (fresh) return readFile(file, "utf8");
  const res = await fetch(s.url, { headers: { "user-agent": "edwrdq-site data refresh (+https://edwrdq.com)" } });
  if (!res.ok) throw new Error(`${s.id}: ${res.status}`);
  const html = await res.text();
  await writeFile(file, html);
  return html;
}

await mkdir(RAW, { recursive: true });
const series = [];
for (const s of SERIES) {
  const pts = (s.kind === "eia" ? parseEia : parseFed)(await fetchCached(s)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (pts.length < 1000) throw new Error(`${s.id}: only ${pts.length} points — did the page format change?`);
  const { kind, ...meta } = s;
  series.push({ ...meta, dates: pts.map((p) => p[0]), values: pts.map((p) => p[1]) });
  console.error(`${s.id}: ${pts.length} days, ${pts[0][0]} → ${pts[pts.length - 1][0]}`);
}

const out = [];
let last = START;
for (let i = 0; i < DAYS; i++) {
  const day = addDays(START, i);
  const d = makeDay(day, series);
  if (d.rounds.length < ROUNDS) throw new Error(`${day}: only ${d.rounds.length} rounds`);
  out.push({ key: `rr:${day}`, value: JSON.stringify(d) });
  last = day;
}
out.push({ key: "rr:meta", value: JSON.stringify({ last, generated: new Date().toISOString(), series: SERIES.map((s) => s.id) }) });
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out));
console.error(`rr: ${DAYS} days (${START} → ${last}) → ${OUT.replace(ROOT + "/", "")}`);
