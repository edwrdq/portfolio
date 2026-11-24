// what goes over the room websocket. json, one object per frame, `t` says which.
// clients never see session ids or hashes — only seat numbers and nicknames.
import type { GameId } from "./games.ts";

export const PROTOCOL = 1;

export type SeatView = { nick: string; bot: boolean; online: boolean } | null;
export type RoomView = {
  code: string;
  game: GameId;
  public: boolean;
  state: "lobby" | "playing";
  host: number;
  seats: SeatView[];
  slow: boolean;
  chat: boolean;
};
export type ChatMsg = { id: number; at: number; seat: number | null; nick: string; body: string; sys?: boolean };

export type ClientMsg =
  | { t: "hello"; v: number; sid: string; name: string }
  | { t: "name"; name: string }
  | { t: "chat"; text: string }
  | { t: "report"; id: number }
  | { t: "public"; on: boolean }
  | { t: "start"; opts?: Record<string, unknown> }
  /** a game action: the game decides what's in it */
  | { t: "g"; x: Record<string, unknown> };

export type ByeReason = "gone" | "full" | "started" | "kicked" | "banned" | "off" | "replaced" | "closed" | "bad";

export type ServerMsg =
  | { t: "welcome"; you: number; name: string; room: RoomView; chat: ChatMsg[] }
  | { t: "room"; room: RoomView }
  | { t: "chat"; msg: ChatMsg }
  | { t: "name"; name: string }
  | { t: "notice"; text: string }
  /** this seat's view of the running (or just finished) game */
  | { t: "game"; g: unknown }
  | { t: "bye"; reason: ByeReason };

export const BYE_TEXT: Record<ByeReason, string> = {
  gone: "this room doesn't exist anymore.",
  full: "this room is full.",
  started: "this game already started. make a room, or wait and join the next one.",
  kicked: "you were removed from this room.",
  banned: "you can't join rooms right now.",
  off: "multiplayer is off right now. try again later.",
  replaced: "you opened this room in another tab.",
  closed: "this room closed.",
  bad: "something went wrong. refresh to try again.",
};

/** close codes we use (4000–4999 is the app range) */
export const CLOSE = { bye: 4000 } as const;
