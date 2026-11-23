// 8×8 grids as boolean[64], row-major. shared by the api and the editor.
export type Grid = boolean[];
export const N = 8;

export const empty = (): Grid => Array(N * N).fill(false);
export const fromRows = (rows: readonly string[]): Grid => rows.flatMap((r) => [...r.padEnd(N, ".").slice(0, N)].map((c) => c === "#"));
export const toRows = (g: Grid): string[] => Array.from({ length: N }, (_, y) => g.slice(y * N, y * N + N).map((b) => (b ? "#" : ".")).join(""));

/** accepts the site's format (["…", …]), a json array, or 8 plain lines of . and # */
export function parseGrid(text: string): Grid | null {
  const rows = text.match(/[.#]{8}/g);
  if (!rows || rows.length !== N) return null;
  return fromRows(rows);
}

export const validRows = (rows: unknown): rows is string[] =>
  Array.isArray(rows) && rows.length === N && rows.every((r) => typeof r === "string" && /^[.#]{8}$/.test(r));

export function svg(g: Grid, size = 16) {
  let rects = "";
  g.forEach((on, i) => {
    if (on) rects += `<rect x="${i % N}" y="${Math.floor(i / N)}" width="1" height="1"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 8 8" shape-rendering="crispEdges" fill="currentColor">${rects}</svg>`;
}

// transforms (pure)
export const invert = (g: Grid) => g.map((b) => !b);
export const flipH = (g: Grid) => g.map((_, i) => g[Math.floor(i / N) * N + (N - 1 - (i % N))]);
export const flipV = (g: Grid) => g.map((_, i) => g[(N - 1 - Math.floor(i / N)) * N + (i % N)]);
export const rotate = (g: Grid) => g.map((_, i) => g[(N - 1 - (i % N)) * N + Math.floor(i / N)]); // 90° clockwise
export const shift = (g: Grid, dx: number, dy: number) =>
  g.map((_, i) => {
    const x = (((i % N) - dx) % N + N) % N;
    const y = ((Math.floor(i / N) - dy) % N + N) % N;
    return g[y * N + x];
  });
