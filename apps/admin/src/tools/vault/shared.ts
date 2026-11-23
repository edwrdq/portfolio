// shared by the vault api and page

export type Entry = {
  id: number;
  title: string;
  body: string;
  lang: string;
  note: string | null;
  tags: string;
  pinned: number;
  uses: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
};

export const LANGS = ["sh", "ts", "js", "rust", "sql", "toml", "json", "yaml", "py", "go", "css", "html", "txt"] as const;

/** best guess at a snippet's language */
export function guessLang(body: string): string {
  const s = body.trim();
  if (/^\s*[{[]/.test(s) && /[}\]]\s*$/.test(s)) {
    try {
      JSON.parse(s);
      return "json";
    } catch {
      /* not json */
    }
  }
  if (/^\s*(select|insert|update|delete|create|alter|drop|with)\b/i.test(s)) return "sql";
  if (/^\s*\[[\w.-]+\]\s*$/m.test(s) && /^\s*[\w.-]+\s*=/m.test(s)) return "toml";
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|::\w+|\bimpl\b/.test(s)) return "rust";
  if (/\b(const|let|import|export|interface|type)\b[^\n]*[=:{]|=>/.test(s)) return "ts";
  if (/^\s*(def|from|import)\s+\w+/m.test(s) && /:\s*$/m.test(s)) return "py";
  if (/^[\w-]+:\s/m.test(s) && !/[;{}]/.test(s) && s.split("\n").length > 1) return "yaml";
  return "sh";
}

/** #tags anywhere in the note → tags */
export const tagsFrom = (s: string) => [...new Set([...s.matchAll(/(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]{0,31})/gu)].map((m) => m[1].toLowerCase()))];

// things that look like secrets. the vault is for commands, never credentials.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, "an api key (sk-…)"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, "a github token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, "a github token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "a slack token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an aws access key"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "a google api key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "a jwt"],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{20,}=*/i, "a bearer token"],
  [/\b(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*["']?[^\s"'{]{8,}/i, "a password / key assignment"],
  [/:\/\/[^/\s:@]+:[^/\s@{]{6,}@/, "credentials in a url"],
];

export function looksSecret(text: string): string | null {
  for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) return what;
  // long random-looking runs (mixed case + digits, 32+ chars, not a path or placeholder)
  for (const m of text.matchAll(/[A-Za-z0-9+/_=-]{32,}/g)) {
    const t = m[0];
    if (/[a-z]/.test(t) && /[A-Z]/.test(t) && /\d/.test(t) && !/^[a-z-]+$/i.test(t)) return "a long random string (key?)";
  }
  return null;
}
