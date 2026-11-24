// copy for the /play pages: explainer + faq per game (the same faq goes into the json-ld)
import type { GameId } from "@edwrdq/rooms";

type Copy = { title: string; description: string; intro: string; genre: string; how: string[]; faq: { q: string; a: string }[] };

const ROOMS_FAQ = [
  { q: "do i need an account?", a: "no. you get a random nickname like rusty-civic-42, kept in your browser. change it whenever." },
  { q: "how do i play with friends?", a: "make a room and send the invite link. anyone with the link (or the 4-letter code) can join. quick play drops you into any open public room instead." },
  { q: "what if i refresh?", a: "you get your seat back if you're back within about 30 seconds." },
  { q: "is the chat saved?", a: "no. chat only lives in the room and is gone when the room closes. the only exception is a message someone reports, which is kept so it can be reviewed." },
];

export const PLAY: Record<GameId, Copy> = {
  auction: {
    title: "auction — a live salvage car auction game",
    description: "a free multiplayer car auction game. bid on wrecked cars against friends or bots, pay to inspect what's hidden, then find out what the repair really costs. best profit wins.",
    intro: "buy wrecked cars. find out what they really need. flip them. best profit wins.",
    genre: "strategy",
    how: [
      "2 to 8 players. bots fill empty seats. everyone starts with $25,000.",
      "6 cars come up, one at a time. each lot sheet shows the basics, and some of the condition report is hidden.",
      "pay to inspect before bidding opens and you see one hidden item. only you.",
      "bidding is live and fast. late bids add time. buyer fees go on top.",
      "win a car and see the real repair bill and what it sells for. most profit at the end wins.",
    ],
    faq: [{ q: "are the numbers real?", a: "they're built from realistic ranges for the us market: fees, parts, labor, resale. not quotes for any real car." }, ...ROOMS_FAQ],
  },
  arena: {
    title: "arena — a top-down robot game with autonomous",
    description: "a free multiplayer top-down robot game. program your robot's 15-second autonomous in a tiny command list, then drive. score blocks, park at the end. 1v1 or 2v2.",
    intro: "program your autonomous. then drive. 2v2, bots fill in.",
    genre: "sports",
    how: [
      "1v1 or 2v2. bots fill empty seats.",
      "before the match, write your robot's autonomous: forward 3, turn 90, intake, release.",
      "15 seconds of autonomous run on their own. then 1:45 of driving.",
      "pick up blocks (two at most), drop them in your goals, push the other robots around.",
      "points for blocks, a bonus for winning autonomous, and a bonus for parking at the end.",
    ],
    faq: [{ q: "is this vex?", a: "it's inspired by vex robotics: a timed match, an autonomous period, then driver control. the field and rules are made up." }, ...ROOMS_FAQ],
  },
};
