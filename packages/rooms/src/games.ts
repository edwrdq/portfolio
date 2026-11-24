// the multiplayer games and their seat counts. rooms read this; so do the pages.
export type GameId = "auction" | "arena";

export type GameInfo = {
  id: GameId;
  name: string;
  blurb: string;
  href: string;
  /** players a room holds. bots fill empty seats when the host starts. */
  max: number;
  /** humans needed to start (bots fill the rest) */
  min: number;
  /** false until the game itself ships: the lobby works, start stays off */
  ready: boolean;
};

export const GAMES: GameInfo[] = [
  { id: "auction", name: "auction", blurb: "buy wrecked cars, find out what they need, flip them.", href: "/play/auction", max: 8, min: 1, ready: true },
  { id: "arena", name: "arena", blurb: "program your robot's autonomous, then drive. 2v2.", href: "/play/arena", max: 4, min: 1, ready: true },
];

export const isGame = (g: unknown): g is GameId => GAMES.some((x) => x.id === g);
export const gameInfo = (g: GameId) => GAMES.find((x) => x.id === g)!;

/** room codes: 4 chars, no lookalikes (0/o, 1/i/l, 5/s, 2/z) */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXY346789";
export const CODE_LEN = 4;
export const isCode = (c: unknown): c is string => typeof c === "string" && c.length === CODE_LEN && [...c].every((ch) => CODE_ALPHABET.includes(ch));
export function newCode(rand: () => number = Math.random) {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}
