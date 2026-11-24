// random nicknames: <adjective>-<car part>-<number>, e.g. rusty-civic-42, quiet-piston-7.
// generated in the browser, kept in localStorage, checked by the server like chat.
const ADJ = [
  "rusty", "quiet", "loud", "dusty", "shiny", "bent", "lowered", "lifted", "stock", "boosted",
  "salty", "sleepy", "spicy", "cold", "hot", "lucky", "dented", "clean", "rapid", "slow",
  "turbo", "greasy", "polished", "matte", "neon", "faded", "tiny", "big", "brave", "sly",
];
const NOUN = [
  "civic", "piston", "camshaft", "gasket", "tacoma", "miata", "corolla", "wrench", "socket", "ratchet",
  "rotor", "caliper", "axle", "spark", "valve", "crank", "bumper", "fender", "hubcap", "muffler",
  "radiator", "clutch", "torque", "diesel", "wagon", "coupe", "pickup", "sedan", "hatch", "bolt",
];

export const NAME_MAX = 20;

export function randomName(rand: () => number = Math.random) {
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  for (;;) {
    const n = `${pick(ADJ)}-${pick(NOUN)}-${Math.floor(rand() * 99) + 1}`;
    if (n.length <= NAME_MAX) return n;
  }
}

/** trim, squash whitespace to "-", keep letters/digits/-/_ only. null if nothing usable. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, NAME_MAX);
  return s.length >= 2 ? s : null;
}
