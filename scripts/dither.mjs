#!/usr/bin/env node
// pnpm dither — raw/ photos → 1-bit dithered pngs, bone on black.
// the pipeline lives in packages/dither — the admin dither tool uses the same code,
// so images from here and from the tool match.
//
//   pnpm dither                 every image in raw/
//   pnpm dither civic.jpg       just that one (name or path inside raw/)
//   pnpm dither --width 1000    output width in px (default 640 — the entry column; shown 1:1, never scaled)
//   pnpm dither --force         redo files that are already up to date
//   --algo atkinson|floyd|bayer4|bayer8|threshold   (default atkinson)
//   --scale 1|2|3               dot size (default 1)
//   --palette bone|acid|invert  (default bone)
//   --in <dir> --out <dir>      override raw/ and apps/site/public/img/
//
// output keeps the base name: raw/civic.jpg → apps/site/public/img/civic.png
// metadata (exif, gps) is never copied over.

import { readdir, readFile, stat, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { clean, ditherWidth, hexToRgb, run } from "../packages/dither/src/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff", ".heic", ".heif", ".gif"]);

// ---- args
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const bool = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const width = Number(flag("width", "640"));
const params = clean({
  width,
  algo: flag("algo", "atkinson"),
  scale: Number(flag("scale", "1")),
  palette: flag("palette", "bone"),
});
const inDir = resolve(ROOT, flag("in", "raw"));
const outDir = resolve(ROOT, flag("out", "apps/site/public/img"));
const force = bool("force");
const only = args.filter((a) => !a.startsWith("--")).map((a) => basename(a));

if (!Number.isInteger(width) || width < 16 || width > 4000) {
  console.error("--width must be a whole number between 16 and 4000");
  process.exit(1);
}

// ---- colors come from the design tokens, not from here
const css = await readFile(join(ROOT, "packages/ui/src/styles/tokens.css"), "utf8");
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!m) throw new Error(`token --${name} not found in tokens.css`);
  return hexToRgb(m[1]);
};
const colors = { bone: token("bone"), acid: token("acid"), bg: token("bg") };

async function dither(src, dest) {
  const img = sharp(src).rotate(); // respect exif orientation before it's dropped
  const { width: srcW = width } = await img.metadata();
  const { data, info } = await img
    .resize({ width: ditherWidth(params, srcW), withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // grayscale → normalise → adjust → dither → palette (packages/dither)
  const out = run(data, info.width, info.height, 3, params, colors, 3);
  await sharp(Buffer.from(out.data.buffer), { raw: { width: out.width, height: out.height, channels: 3 } })
    .png({ palette: true, colours: 2, compressionLevel: 9, effort: 10 })
    .toFile(dest);
  return { width: out.width, height: out.height };
}

// ---- run
let files;
try {
  files = (await readdir(inDir)).filter((f) => EXTS.has(extname(f).toLowerCase()) && !f.startsWith("."));
} catch {
  console.error(`no ${inDir}/ — make it and drop photos in.`);
  process.exit(1);
}
if (only.length) {
  const missing = only.filter((o) => !files.includes(o));
  if (missing.length) console.error(`not in ${inDir}: ${missing.join(", ")}`);
  files = files.filter((f) => only.includes(f));
}
if (!files.length) {
  console.log(`nothing to dither in ${inDir}`);
  process.exit(0);
}

await mkdir(outDir, { recursive: true });
let done = 0;
let skipped = 0;
let failed = 0;
for (const f of files.sort()) {
  const src = join(inDir, f);
  const dest = join(outDir, `${basename(f, extname(f))}.png`);
  if (!force) {
    const [s, d] = await Promise.all([stat(src), stat(dest).catch(() => null)]);
    if (d && d.mtimeMs >= s.mtimeMs) {
      skipped++;
      continue;
    }
  }
  try {
    const info = await dither(src, dest);
    const kb = ((await stat(dest)).size / 1024).toFixed(1);
    console.log(`  ${f} → ${dest.replace(ROOT + "/", "")}  ${info.width}×${info.height}  ${kb}kb`);
    done++;
  } catch (e) {
    console.error(`  ${f} ✕ ${e.message}`);
    failed++;
  }
}
console.log(`dithered ${done}${skipped ? `, ${skipped} already up to date (--force to redo)` : ""}${failed ? `, ${failed} failed` : ""}.`);
process.exit(failed ? 1 : 0);
