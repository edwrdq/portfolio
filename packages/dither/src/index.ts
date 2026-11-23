// the dither pipeline, shared by scripts/dither.mjs (node + sharp) and the admin dither tool
// (browser canvas). both resize first, then hand raw pixels to `run`, so output matches.
// erasable typescript only — node runs this file directly.

export type Algo = "atkinson" | "floyd" | "bayer4" | "bayer8" | "threshold";
export type Palette = "bone" | "acid" | "invert";
export type Params = {
  algo: Algo;
  width: number; // final output width in px
  brightness: number; // -100 … 100
  contrast: number; // -100 … 100
  gamma: number; // 0.2 … 3
  threshold: number; // 0 … 255 (threshold mode)
  scale: number; // 1 | 2 | 3 — dot size; dithers at width/scale, then upscales
  palette: Palette;
  normalize: boolean; // stretch 1st–99th percentile (sharp's normalise)
};

/** same as the old script: atkinson, 640 wide, normalised, bone on black */
export const DEFAULTS: Params = {
  algo: "atkinson",
  width: 640,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  threshold: 128,
  scale: 1,
  palette: "bone",
  normalize: true,
};

export const ALGOS: Algo[] = ["atkinson", "floyd", "bayer4", "bayer8", "threshold"];
export const WIDTHS = [320, 480, 640, 960, 1280];

export type RGB = [number, number, number];
export type Colors = { bone: RGB; acid: RGB; bg: RGB };

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.trim().replace(/^#/, ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** merge user params over defaults and clamp everything */
export function clean(p: Partial<Params> | null | undefined): Params {
  const x = { ...DEFAULTS, ...(p ?? {}) };
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    algo: ALGOS.includes(x.algo) ? x.algo : DEFAULTS.algo,
    width: Math.round(num(x.width, 16, 4000, DEFAULTS.width)),
    brightness: num(x.brightness, -100, 100, 0),
    contrast: num(x.contrast, -100, 100, 0),
    gamma: num(x.gamma, 0.2, 3, 1),
    threshold: Math.round(num(x.threshold, 0, 255, 128)),
    scale: [1, 2, 3].includes(x.scale) ? x.scale : 1,
    palette: (["bone", "acid", "invert"] as Palette[]).includes(x.palette) ? x.palette : "bone",
    normalize: x.normalize !== false,
  };
}

/** width to dither at (before the dot-scale upscale) */
export const ditherWidth = (p: Params, sourceWidth: number) => Math.max(1, Math.min(sourceWidth, Math.round(p.width / p.scale)));

/** rgb(a) → luminance (rec. 709) */
export function toGray(px: ArrayLike<number>, channels: number, n: number): Float32Array {
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.2126 * px[i * channels] + 0.7152 * px[i * channels + 1] + 0.0722 * px[i * channels + 2];
  return g;
}

/** normalise (1–99th percentile stretch), then brightness, contrast, gamma. in place. */
export function adjust(g: Float32Array, p: Params) {
  if (p.normalize) {
    const hist = new Uint32Array(256);
    for (const v of g) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
    const lo = g.length * 0.01;
    const hi = g.length * 0.99;
    let acc = 0;
    let min = 0;
    let max = 255;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc <= lo) min = i;
      if (acc < hi) max = i + 1;
    }
    const span = Math.max(1, max - min);
    for (let i = 0; i < g.length; i++) g[i] = ((g[i] - min) / span) * 255;
  }
  const b = (p.brightness / 100) * 255;
  const c = p.contrast >= 0 ? 1 + (p.contrast / 100) * 3 : 1 + p.contrast / 100; // 0…4×
  const inv = 1 / p.gamma;
  for (let i = 0; i < g.length; i++) {
    let v = (g[i] - 128) * c + 128 + b;
    v = Math.max(0, Math.min(255, v));
    if (p.gamma !== 1) v = 255 * Math.pow(v / 255, inv);
    g[i] = v;
  }
}

// bayer matrices, built recursively from the 2×2 base: M(2n) = [[4M, 4M+2], [4M+3, 4M+1]]
function bayer(n: number): number[] {
  if (n === 2) return [0, 2, 3, 1];
  const half = n / 2;
  const m = bayer(half);
  const out: number[] = new Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const base = 4 * m[(y % half) * half + (x % half)];
      const q = (y < half ? 0 : 2) + (x < half ? 0 : 1); // quadrant: tl, tr, bl, br
      out[y * n + x] = base + [0, 2, 3, 1][q];
    }
  return out;
}
const BAYER4 = bayer(4);
const BAYER8 = bayer(8);

/** grayscale → 1 bit per pixel (1 = ink) */
export function dither(g: Float32Array, w: number, h: number, algo: Algo, threshold = 128): Uint8Array {
  const out = new Uint8Array(w * h);
  if (algo === "threshold") {
    for (let i = 0; i < g.length; i++) out[i] = g[i] >= threshold ? 1 : 0;
    return out;
  }
  if (algo === "bayer4" || algo === "bayer8") {
    const size = algo === "bayer4" ? 4 : 8;
    const m = algo === "bayer4" ? BAYER4 : BAYER8;
    const levels = size * size;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = ((m[(y % size) * size + (x % size)] + 0.5) / levels) * 255;
        out[y * w + x] = g[y * w + x] >= t ? 1 : 0;
      }
    return out;
  }
  const px = Float32Array.from(g);
  const push = (x: number, y: number, e: number) => {
    if (x >= 0 && x < w && y < h) px[y * w + x] += e;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const on = px[i] >= 128;
      out[i] = on ? 1 : 0;
      const err = px[i] - (on ? 255 : 0);
      if (algo === "atkinson") {
        const e = err / 8;
        push(x + 1, y, e), push(x + 2, y, e), push(x - 1, y + 1, e), push(x, y + 1, e), push(x + 1, y + 1, e), push(x, y + 2, e);
      } else {
        push(x + 1, y, (err * 7) / 16), push(x - 1, y + 1, (err * 3) / 16), push(x, y + 1, (err * 5) / 16), push(x + 1, y + 1, err / 16);
      }
    }
  return out;
}

/** bits → pixels, with each dot scaled up `scale`× (nearest) */
export function paint(bits: Uint8Array, w: number, h: number, p: Params, colors: Colors, channels: 3 | 4) {
  const [ink, paper] =
    p.palette === "acid" ? [colors.acid, colors.bg] : p.palette === "invert" ? [colors.bg, colors.bone] : [colors.bone, colors.bg];
  const s = p.scale;
  const W = w * s;
  const H = h * s;
  const out = new Uint8ClampedArray(W * H * channels);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = bits[Math.floor(y / s) * w + Math.floor(x / s)] ? ink : paper;
      const o = (y * W + x) * channels;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      if (channels === 4) out[o + 3] = 255;
    }
  return { data: out, width: W, height: H };
}

/** the whole thing, from already-resized raw pixels */
export function run(px: ArrayLike<number>, w: number, h: number, channels: 3 | 4, params: Partial<Params>, colors: Colors, outChannels: 3 | 4 = channels) {
  const p = clean(params);
  const g = toGray(px, channels, w * h);
  adjust(g, p);
  return paint(dither(g, w, h, p.algo, p.threshold), w, h, p, colors, outChannels);
}
