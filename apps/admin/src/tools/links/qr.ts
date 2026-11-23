// qr codes in the site style: square modules, bone on black, optional pixel-font label.
// pure function → svg string, so the same output feeds the preview and both downloads.
import { encode } from "uqr";

// 5×7 pixel glyphs for the label
const GLYPHS: Record<string, string[]> = {
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
};

const QUIET = 4; // modules of margin a scanner needs
const LABEL_PX = 0.5; // one label pixel = half a module

export function qrSvg(text: string, opts: { fg: string; bg: string; label?: string | null }) {
  const qr = encode(text, { ecc: "M", border: 0 });
  const n = qr.size;
  const label = opts.label ? opts.label.toUpperCase().split("").filter((c) => GLYPHS[c]) : [];

  const w = n + QUIET * 2;
  const labelH = label.length ? 7 * LABEL_PX : 0;
  const h = label.length ? QUIET + n + 1.5 + labelH + 2.5 : w;

  let d = "";
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (qr.data[y][x]) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;

  if (label.length) {
    const lw = (label.length * 6 - 1) * LABEL_PX;
    const x0 = (w - lw) / 2;
    const y0 = QUIET + n + 1.5;
    label.forEach((c, i) =>
      GLYPHS[c].forEach((row, gy) =>
        [...row].forEach((p, gx) => {
          if (p === "#") d += `M${x0 + (i * 6 + gx) * LABEL_PX} ${y0 + gy * LABEL_PX}h${LABEL_PX}v${LABEL_PX}h-${LABEL_PX}z`;
        }),
      ),
    );
  }

  return {
    width: w,
    height: h,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 10}" height="${h * 10}" shape-rendering="crispEdges">` +
      `<rect width="${w}" height="${h}" fill="${opts.bg}"/><path d="${d}" fill="${opts.fg}"/></svg>`,
  };
}
