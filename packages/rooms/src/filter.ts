// chat + nickname filter. three checks, all on normalized text:
//   links            — no urls, domains ("discord dot gg" too)
//   personal info    — no emails, no phone numbers
//   banned words     — the list edited in admin → rooms, matched past leetspeak, lookalike
//                      letters, s p a c i n g, d.o.t.s and stretched letters (fuuuun → fun)
// the list itself lives in d1 (rooms_settings.banned_words), never in this repo.
//
// list format, one rule per line, # starts a comment:
//   word      whole-word match ("ass" blocks "a$$", "a s s", "asss" but not "class" or "pass")
//   *word*    match anywhere, even inside other words. for words that are never innocent.
//   two words a phrase. matched anywhere, spaces ignored ("kill yourself" → "k i l l  y o u r s e l f")

export const CHAT_MAX = 200;

export type Rule = { src: string; anywhere: boolean; re: RegExp };
export type Verdict = { ok: true; text: string } | { ok: false; reason: "empty" | "long" | "blocked" | "link" | "personal" };

/** what the sender sees for each reason */
export const REASON: Record<Exclude<Verdict, { ok: true }>["reason"], string> = {
  empty: "say something first.",
  long: `keep it under ${CHAT_MAX} characters.`,
  blocked: "message blocked.",
  link: "message blocked. no links.",
  personal: "message blocked. no personal info.",
};

// cyrillic / greek letters that look latin
const LOOKALIKE: Record<string, string> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ї: "i", ј: "j", ѕ: "s", ԁ: "d", ɡ: "g",
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
};
const LEET_A: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", $: "s", "!": "i", "|": "i", "+": "t", "(": "c", "€": "e", "£": "l", "¢": "c" };
const LEET_B: Record<string, string> = { ...LEET_A, "1": "l", "|": "l", "!": "l" };

const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** what gets displayed: plain text, one line, no invisible/bidi tricks, no zalgo stacks */
export function cleanText(raw: string) {
  return raw
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(CONTROL, " ")
    .replace(/(\p{M}{2})\p{M}+/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** lowercase, accents off, lookalikes mapped. still has spaces, digits and punctuation. */
function base(s: string) {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(INVISIBLE, "")
    .replace(/./gu, (c) => LOOKALIKE[c] ?? c);
}

/** letter-only tokens, in both leet readings. all-digit tokens stay digits (so "455" isn't "ass"). */
function tokens(s: string, leet: Record<string, string>) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (/[a-z]/.test(t) ? t.replace(/./g, (c) => leet[c] ?? c) : t).replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

/** letters → a regex where each letter may repeat (stretched words), nothing else in between */
const stretch = (letters: string) => letters.split("").map((c) => `${c}+`).join("");

export function compile(list: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of list.split("\n")) {
    const src = line.replace(/#.*/, "").trim();
    if (!src) continue;
    const star = src.startsWith("*") || src.endsWith("*");
    const phrase = /\s/.test(src.replace(/^\*|\*$/g, "").trim());
    const letters = tokens(base(src.replace(/\*/g, "")), LEET_A).join("");
    if (letters.length < 2) continue;
    const anywhere = star || phrase;
    rules.push({ src, anywhere, re: new RegExp(anywhere ? stretch(letters) : `^${stretch(letters)}$`) });
  }
  return rules;
}

/** candidate strings for whole-word rules: each token, neighbours glued, and runs of single letters */
function candidates(toks: string[]) {
  const out = new Set(toks);
  for (let i = 0; i + 1 < toks.length; i++) out.add(toks[i] + toks[i + 1]);
  let run = "";
  for (const t of [...toks, ""]) {
    if (t.length === 1) run += t;
    else {
      if (run.length > 1) out.add(run);
      run = "";
    }
  }
  return out;
}

export function bannedHit(text: string, rules: Rule[]): Rule | null {
  if (!rules.length) return null;
  const b = base(text);
  for (const leet of [LEET_A, LEET_B]) {
    const toks = tokens(b, leet);
    const squashed = toks.join("");
    const cands = candidates(toks);
    for (const r of rules) {
      if (r.anywhere ? r.re.test(squashed) : [...cands].some((c) => r.re.test(c))) return r;
    }
  }
  return null;
}

const TLD =
  "com|net|org|io|gg|co|me|tv|xyz|app|dev|ly|ru|info|biz|us|uk|ca|de|fr|jp|link|site|online|live|club|shop|store|fun|lol|to|sh|be|cc|ai|so|page|xxx|fm|gl|im|ws|tk|ml|ga|cf|gq|top|win|bid|vip|pro|art|one|email|chat|social|zip|mov";
const LINK = [
  /\b(?:https?|ftp|wss?):/,
  /\bwww\s*[.,]/,
  new RegExp(`[a-z0-9-]{2,}\\s*(?:\\.|,|\\(dot\\)|\\[dot\\]|\\{dot\\}|\\sdot\\s)\\s*(?:${TLD})\\b`),
  /\b(?:discord|t\.me|bit\.ly|tinyurl)\b.*\//,
  /\bdiscord\s*(?:\.|dot)\s*gg\b/,
];
const EMAIL = /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9-]+\s*(?:\.|\sdot\s|\(dot\))\s*[a-z]{2,}/;
const PHONE = /(?:\+?\d[\s().-]{0,3}){10,}/;

export function hasLink(text: string) {
  const b = base(text);
  return LINK.some((re) => re.test(b));
}
export function hasPersonal(text: string) {
  const b = base(text);
  return EMAIL.test(b) || PHONE.test(b);
}

/** the whole pipeline for one chat message */
export function checkChat(raw: unknown, rules: Rule[]): Verdict {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const text = cleanText(raw);
  if (!text) return { ok: false, reason: "empty" };
  if ([...text].length > CHAT_MAX) return { ok: false, reason: "long" };
  if (hasPersonal(text)) return { ok: false, reason: "personal" };
  if (hasLink(text)) return { ok: false, reason: "link" };
  if (bannedHit(text, rules)) return { ok: false, reason: "blocked" };
  return { ok: true, text };
}

/** nicknames go through the same banned-word check (dashes count as spaces) */
export function nameAllowed(name: string, rules: Rule[]) {
  const spaced = name.replace(/[-_]/g, " ");
  return !bannedHit(spaced, rules) && !bannedHit(name, rules) && !hasLink(spaced);
}
