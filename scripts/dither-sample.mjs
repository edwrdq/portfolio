// generates the public dither tool's sample: a drawn landscape (no licensing questions) as a
// colour jpg the tool loads, plus a pre-dithered png the page shows before js runs.
// run: node scripts/dither-sample.mjs   (outputs are committed; re-run only to change the sample)
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { DEFAULTS, ditherWidth, hexToRgb, run } from "../packages/dither/src/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/site/public/img");
const W = 960;
const H = 640;

// layered ridges: deterministic wobble so re-runs give the same picture
const ridge = (base, amp, seed, step = 24) => {
  let d = `M0 ${H} L0 ${base}`;
  for (let x = 0; x <= W; x += step) {
    const y = base - amp * (0.55 * Math.sin(x / 97 + seed) + 0.3 * Math.sin(x / 41 + seed * 2.3) + 0.15 * Math.sin(x / 13 + seed * 5.1));
    d += ` L${x} ${y.toFixed(1)}`;
  }
  return `${d} L${W} ${H} Z`;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b1b3a"/><stop offset="0.45" stop-color="#7a3b6b"/><stop offset="0.75" stop-color="#e2774a"/><stop offset="1" stop-color="#f6c26b"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff6d6"/><stop offset="0.55" stop-color="#ffd27a"/><stop offset="1" stop-color="#ffb35a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8c4a6a"/><stop offset="1" stop-color="#4a2a4a"/></linearGradient>
    <linearGradient id="m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2f52"/><stop offset="1" stop-color="#2a1a30"/></linearGradient>
    <linearGradient id="m3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c1a2e"/><stop offset="1" stop-color="#0d0a12"/></linearGradient>
    <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0a860"/><stop offset="0.4" stop-color="#7a3b6b"/><stop offset="1" stop-color="#140f1e"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="600" cy="330" r="150" fill="url(#sun)"/>
  <circle cx="600" cy="330" r="62" fill="#fff1c9"/>
  <path d="${ridge(360, 70, 1.3)}" fill="url(#m1)"/>
  <path d="${ridge(410, 60, 4.1)}" fill="url(#m2)"/>
  <rect y="455" width="${W}" height="${H - 455}" fill="url(#lake)"/>
  <rect x="560" y="462" width="80" height="4" fill="#fff1c9" opacity="0.8"/>
  <rect x="540" y="478" width="120" height="3" fill="#ffd27a" opacity="0.6"/>
  <rect x="575" y="494" width="50" height="3" fill="#ffd27a" opacity="0.5"/>
  <path d="${ridge(520, 90, 7.7, 16)}" fill="url(#m3)"/>
</svg>`;

await mkdir(OUT, { recursive: true });
const color = sharp(Buffer.from(svg));
await color.clone().jpeg({ quality: 86, mozjpeg: true }).toFile(join(OUT, "dither-sample.jpg"));

// pre-dithered version, exactly what the tool's defaults produce
const tokens = await readFile(join(ROOT, "packages/ui/src/styles/tokens.css"), "utf8");
const tok = (n) => hexToRgb(tokens.match(new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, "i"))[1]);
const colors = { bone: tok("bone"), acid: tok("acid"), bg: tok("bg") };
const dw = ditherWidth(DEFAULTS, W);
const { data, info } = await color.clone().resize({ width: dw }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const out = run(data, info.width, info.height, 3, DEFAULTS, colors, 3);
await sharp(Buffer.from(out.data), { raw: { width: out.width, height: out.height, channels: 3 } })
  .png({ palette: true, colors: 2, compressionLevel: 9 })
  .toFile(join(OUT, "dither-sample.png"));
console.log(`sample: ${W}×${H} jpg + ${out.width}×${out.height} dithered png → apps/site/public/img/`);
