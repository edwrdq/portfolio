// pixel side-view of a car (front faces right) with the damage zone lit in acid. svg, crisp pixels.
import type { Body, Damage } from "@edwrdq/rooms/auction";

const W = 32;
const H = 12;
type Px = "." | "b" | "g" | "w"; // empty, body, glass, wheel

function blank(): Px[][] {
  return Array.from({ length: H }, () => Array<Px>(W).fill("."));
}
const span = (g: Px[][], y: number, x0: number, x1: number, c: Px) => {
  for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) g[y][x] = c;
};
function wheel(g: Px[][], cx: number) {
  span(g, 8, cx - 1, cx + 1, "w");
  span(g, 9, cx - 2, cx + 2, "w");
  span(g, 10, cx - 2, cx + 2, "w");
  span(g, 11, cx - 1, cx + 1, "w");
}

function draw(body: Body) {
  const g = blank();
  if (body === "truck") {
    for (let y = 2; y <= 5; y++) span(g, y, 17 - (y === 2 ? 0 : 0), 24 - (y === 2 ? 1 : 0), "b");
    span(g, 3, 18, 22, "g");
    span(g, 4, 18, 22, "g");
    g[3][20] = g[4][20] = "b";
    span(g, 5, 1, 16, "b"); // bed rail
    span(g, 5, 25, 30, "b"); // hood
    for (let y = 6; y <= 9; y++) span(g, y, 1, 30, "b");
    wheel(g, 6);
    wheel(g, 25);
  } else if (body === "suv") {
    span(g, 2, 6, 20, "b");
    for (let y = 3; y <= 5; y++) span(g, y, 5, 21 + (y - 3), "b");
    span(g, 3, 7, 19, "g");
    span(g, 4, 7, 20, "g");
    g[3][12] = g[4][12] = g[3][16] = g[4][16] = "b";
    span(g, 5, 2, 30, "b");
    for (let y = 6; y <= 9; y++) span(g, y, 1, 30, "b");
    wheel(g, 7);
    wheel(g, 25);
  } else if (body === "coupe") {
    span(g, 3, 11, 17, "b");
    span(g, 4, 10, 19, "b");
    span(g, 4, 12, 17, "g");
    span(g, 5, 3, 29, "b");
    for (let y = 6; y <= 9; y++) span(g, y, 1, 30, "b");
    g[5][9] = "b";
    wheel(g, 7);
    wheel(g, 24);
  } else {
    span(g, 2, 11, 18, "b");
    span(g, 3, 10, 19, "b");
    span(g, 4, 9, 20, "b");
    span(g, 3, 11, 18, "g");
    span(g, 4, 10, 19, "g");
    g[3][15] = g[4][15] = "b";
    span(g, 5, 2, 29, "b");
    for (let y = 6; y <= 9; y++) span(g, y, 1, 30, "b");
    wheel(g, 7);
    wheel(g, 24);
  }
  return g;
}

function hit(damage: Damage, x: number, y: number, g: Px[][]) {
  if (g[y][x] === ".") return false;
  switch (damage) {
    case "front":
      return x >= 24 && y <= 9;
    case "rear":
      return x <= 7 && y <= 9;
    case "side":
      return x >= 10 && x <= 21 && y >= 5 && y <= 9;
    case "flood":
      return y >= 7;
    case "hail": {
      const top = g.findIndex((row) => row[x] !== ".");
      return y === top && x % 2 === 0 && g[y][x] !== "w";
    }
    case "mechanical":
      return x >= 23 && x <= 29 && y >= 5 && y <= 7;
    case "runs":
      return (y === 7 && (x === 12 || x === 13 || x === 19)) || (y === 8 && x === 27);
  }
}

const COLOR: Record<Exclude<Px, ".">, string> = { b: "var(--dim-2)", g: "var(--seam)", w: "var(--dim-1)" };

export function carSvg(body: Body, damage: Damage) {
  const g = draw(body);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${body}, ${damage} damage highlighted`);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = g[y][x];
      if (c === ".") continue;
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", String(x));
      r.setAttribute("y", String(y));
      r.setAttribute("width", "1");
      r.setAttribute("height", "1");
      r.setAttribute("fill", hit(damage, x, y, g) ? "var(--acid)" : COLOR[c]);
      svg.append(r);
    }
  if (damage === "flood") {
    const line = document.createElementNS(ns, "rect");
    Object.entries({ x: "0", y: "6.85", width: String(W), height: "0.15", fill: "var(--acid)" }).forEach(([k, v]) => line.setAttribute(k, v));
    svg.append(line);
  }
  return svg;
}
