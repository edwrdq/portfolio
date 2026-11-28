#!/usr/bin/env node
// open graph cards → apps/site/public/og/*.png (1200×630). runs before every site build.
//   og/index.png           homepage (also the fallback)
//   og/<section>.png       each section in index.yml
//   og/blog.png            blog index
//   og/blog/<slug>.png     each published post
// generated output — don't edit by hand, don't commit.

import { readFile, readdir, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import sharp from "sharp";
import { parse as yaml } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "apps/site");
const OUT = join(SITE, "public/og");
const W = 1200;
const H = 630;

// ---- tokens (colors live in tokens.css only)
const tokensCss = await readFile(join(ROOT, "packages/ui/src/styles/tokens.css"), "utf8");
const t = (name) => {
  const m = tokensCss.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!m) throw new Error(`token --${name} missing`);
  return m[1];
};
const C = { bg: t("bg"), seam: t("seam"), bone: t("bone"), text: t("text"), dim1: t("dim-1"), dim2: t("dim-2"), dim3: t("dim-3"), acid: t("acid") };

// ---- fonts (satori wants woff/ttf, not woff2)
const font = (pkg, file) => readFile(join(ROOT, "node_modules/@fontsource", pkg, "files", file));
const fonts = [
  { name: "Inter Tight", weight: 700, style: "normal", data: await font("inter-tight", "inter-tight-latin-700-normal.woff") },
  { name: "Inter Tight", weight: 800, style: "normal", data: await font("inter-tight", "inter-tight-latin-800-normal.woff") },
  { name: "JetBrains Mono", weight: 400, style: "normal", data: await font("jetbrains-mono", "jetbrains-mono-latin-400-normal.woff") },
];

// tiny hyperscript so we don't need jsx
const h = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children: children.flat() } });
const mono = (size, color, extra = {}) => ({ fontFamily: "JetBrains Mono", fontSize: size, color, ...extra });
const label = (text, color = C.dim2) => h("div", mono(20, color, { letterSpacing: 4.4, textTransform: "uppercase" }), text);

// the raw seam: full-bleed line, second line 4px below starting at 40%
const seam = () =>
  h("div", { flexDirection: "column", width: W, flexShrink: 0 },
    h("div", { width: W, height: 1, backgroundColor: C.seam }),
    h("div", { width: W * 0.6, height: 1, marginTop: 4, marginLeft: W * 0.4, backgroundColor: C.seam }),
  );

const fit = (text, max, min, perChar) => Math.max(min, Math.min(max, Math.floor(perChar / Math.max(text.length, 1))));

function card({ kicker, title, upper = false, second, sub, foot, art }) {
  const size = upper ? fit(title, 200, 110, 1200) : fit(title, 170, 72, 1700);
  return h("div", { width: W, height: H, flexDirection: "column", backgroundColor: C.bg, fontFamily: "Inter Tight", position: "relative" },

    // top bar
    h("div", { justifyContent: "space-between", alignItems: "center", height: 84, flexShrink: 0, paddingLeft: 64, paddingRight: 64 },
      label("EDWRDQ", C.text), label("FW—26", C.acid)),
    seam(),
    // body
    h("div", { flexDirection: "column", flexGrow: 1, paddingLeft: 64, paddingRight: 64, paddingTop: 56 },
      kicker ? label(kicker) : null,
      h("div", {
        marginTop: kicker ? 28 : 0,
        fontSize: size,
        fontWeight: upper ? 800 : 700,
        letterSpacing: size * (upper ? -0.065 : -0.055),
        lineHeight: 0.86,
        color: C.bone,
      }, title),
      h("div", { width: 72, height: 6, marginTop: 30, backgroundColor: C.acid }),
      second
        ? h("div", { marginTop: 22, marginLeft: W * 0.4 - 64, fontSize: 84, fontWeight: 700, letterSpacing: 84 * -0.055, lineHeight: 0.9, color: C.bone }, second)
        : null,
      sub ? h("div", mono(26, C.dim1, art ? { marginTop: 30, maxWidth: 440, lineHeight: 1.45 } : { marginTop: 30, marginLeft: W * 0.4 - 64, maxWidth: 620, lineHeight: 1.45 }), sub) : null,
    ),
    // foot
    h("div", { justifyContent: "space-between", alignItems: "center", height: 72, flexShrink: 0, paddingLeft: 64, paddingRight: 64 },
      label(foot ?? "EDWRDQ.COM", C.dim3), label("DORAL / FLORIDA", C.dim3)),
    // optional dithered art, pinned right of the title
    art ? { type: "img", props: { src: art.src, width: art.w, height: art.h, style: { position: "absolute", right: 64, top: 140, imageRendering: "pixelated" } } } : null,
  );
}

async function render(path, node) {
  const svg = await satori(node, { width: W, height: H, fonts });
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const dest = join(OUT, `${path}.png`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, png);
  return dest;
}

// ---- content
const index = yaml(await readFile(join(SITE, "src/content/index.yml"), "utf8"));
const pad = (n) => String(n).padStart(3, "0");

async function posts() {
  const dir = join(SITE, "src/content/blog");
  const out = [];
  const walk = async (d) => {
    for (const ent of await readdir(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if ([".md", ".mdx"].includes(extname(ent.name))) {
        const src = await readFile(p, "utf8");
        const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const data = fm ? yaml(fm[1]) : {};
        if (data.draft) continue;
        // matches the glob loader's id: path without extension, lowercased
        const slug = relative(dir, p).replace(/\.(md|mdx)$/, "").toLowerCase();
        out.push({ slug, ...data });
      }
    }
  };
  await walk(dir).catch(() => {});
  return out;
}

// ---- go
await rm(OUT, { recursive: true, force: true });
const jobs = [
  ["index", card({ title: "EDWARD", upper: true, second: "quintero" })],
];
index.forEach((s, i) => {
  if (s.id === "blog") {
    jobs.push(["blog", card({ kicker: `${pad(i + 1)} — NOTES`, title: "blog", sub: "notes. mostly for me, maybe useful to you." })]);
  } else {
    jobs.push([s.id, card({ kicker: `${pad(i + 1)} — ${s.desc}`, title: s.title, sub: s.intro })]);
  }
});
// public tools (pages outside the index). art = a dithered image shown on the card
const sampleArt = `data:image/png;base64,${(await readFile(join(SITE, "public/img/dither-sample.png"))).toString("base64")}`;
const TOOLS = [
  { path: "dither", kicker: "T01 — TOOL / IMAGE", title: "dither", sub: "free online image dithering. runs in your browser.", foot: "EDWRDQ.COM/DITHER", art: { src: sampleArt, w: 576, h: 384 } },
];
// an 8×8 icon as acid squares on a faint grid (picross-style) → png data uri
async function iconArt(name, px = 40) {
  const src = await readFile(join(ROOT, "packages/ui/src/icons.ts"), "utf8");
  const m = src.match(new RegExp(`\\b${name}: \\[([^\\]]+)\\]`));
  const rows = JSON.parse(`[${m[1]}]`);
  const size = px * 8;
  let rects = "";
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    rects += `<rect x="${x * px + 1}" y="${y * px + 1}" width="${px - 2}" height="${px - 2}" fill="${c === "#" ? C.acid : "#141414"}"/>`;
  }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" shape-rendering="crispEdges">${rects}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { src: `data:image/png;base64,${png.toString("base64")}`, w: size, h: size };
}
const carArt = await iconArt("car");
const dailyCard = async (n, id, sub, icon) => ({ path: `daily/${id}`, kicker: `${n} — DAILY / ${id.toUpperCase()}`, title: id, sub, foot: `EDWRDQ.COM/DAILY/${id.toUpperCase()}`, art: await iconArt(icon) });
TOOLS.push(
  { path: "daily", kicker: "D00 — DAILY / PUZZLES", title: "daily", sub: "a new puzzle every day. the same for everyone.", foot: "EDWRDQ.COM/DAILY", art: carArt },
  { path: "daily/picross", kicker: "D01 — DAILY / PICROSS", title: "picross", sub: "an 8×8 nonogram, new every day.", foot: "EDWRDQ.COM/DAILY/PICROSS", art: carArt },
  await dailyCard("D02", "locate", "find a hidden robot from noisy sensors.", "signal"),
  await dailyCard("D03", "asm", "read some x86-64. what's in rax?", "chip"),
  await dailyCard("D04", "diagnose", "what's wrong with the car? fewest clues wins.", "car"),
  await dailyCard("D05", "logic", "knights, knaves, and proofs.", "pen"),
  { ...(await dailyCard("D06", "real-or-random", "one chart is real. one is a random walk.", "chart")), title: "real or random", kicker: "D06 — DAILY / REAL OR RANDOM" },
  await dailyCard("D07", "estimate", "one fermi question. get within 2×.", "dither"),
);
TOOLS.push(
  { path: "play/auction", kicker: "P01 — PLAY / AUCTION", title: "auction", sub: "buy wrecked cars. flip them. best profit wins.", foot: "EDWRDQ.COM/PLAY/AUCTION", art: carArt },
  { path: "play/arena", kicker: "P02 — PLAY / ARENA", title: "arena", sub: "program your autonomous. then drive.", foot: "EDWRDQ.COM/PLAY/ARENA", art: await iconArt("chip") },
);
TOOLS.push({ path: "stats", kicker: "S01 — NOW / STATS", title: "stats", sub: "hours coding, gaming and listening this week.", foot: "EDWRDQ.COM/STATS", art: await iconArt("chart") });
for (const t of TOOLS) jobs.push([t.path, card(t)]);

for (const p of await posts()) {
  const d = p.date ? new Date(p.date).toISOString().slice(0, 10).replace(/-/g, ".") : "";
  jobs.push([`blog/${p.slug}`, card({ kicker: `BLOG — ${d}`, title: p.title ?? p.slug, sub: p.summary, foot: `EDWRDQ.COM/BLOG/${p.slug.toUpperCase()}` })]);
}

const t0 = Date.now();
await Promise.all(jobs.map(([path, node]) => render(path, node)));
console.log(`og: ${jobs.length} cards → ${relative(ROOT, OUT)}/ (${Date.now() - t0}ms)`);
