// live stats, cached in KV. readers never wait on outside APIs:
// stale or missing cache → return what we have, refresh in the background.

export const GITHUB_USER = "edwrdq";
const KEY = "stats:v1";
const LOCK = "stats:lock";
export const MAX_AGE_MS = 60 * 60 * 1000;
const UA = "edwrdq-site (+https://edwrdq.com)";

// minimal shapes so this package doesn't depend on workers types
type KV = {
  get(key: string, type: "json"): Promise<unknown>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};
type Ctx = { waitUntil(p: Promise<unknown>): void };
export type StatsEnv = { STATS: KV; GITHUB_TOKEN?: string };

export type GitHub = {
  user: string;
  url: string;
  publicRepos: number | null;
  lastPush: { repo: string; at: string; message: string | null; url: string } | null;
  /** pushes per day, oldest → newest, last 14 days (UTC) */
  pushes14d: number[];
  /** only with GITHUB_TOKEN: the contribution calendar */
  calendar: { total: number; weeks: number[][] } | null;
};

export type Stats = {
  v: 1;
  fetchedAt: string;
  github: GitHub | null;
  hackatime: null; // later
  errors: Partial<Record<"github" | "hackatime", string>>;
};

export type StatsResult = { data: Stats | null; ageMs: number | null; stale: boolean; refreshing: boolean };

export async function readStats(env: StatsEnv): Promise<Stats | null> {
  try {
    return ((await env.STATS.get(KEY, "json")) as Stats | null) ?? null;
  } catch {
    return null;
  }
}

/** cached stats. kicks off a background refresh when stale. never waits on outside APIs. */
export async function getStats(env: StatsEnv, ctx?: Ctx): Promise<StatsResult> {
  const data = await readStats(env);
  const ageMs = data ? Date.now() - Date.parse(data.fetchedAt) : null;
  const stale = ageMs === null || ageMs > MAX_AGE_MS;
  let refreshing = false;

  if (stale && ctx) {
    // best-effort lock so a burst of visitors triggers one refresh, not fifty
    const locked = await env.STATS.get(LOCK).catch(() => null);
    if (!locked) {
      refreshing = true;
      ctx.waitUntil(
        env.STATS.put(LOCK, "1", { expirationTtl: 60 })
          .then(() => refreshStats(env))
          .catch((e) => console.error("stats refresh", e)),
      );
    }
  }
  return { data, ageMs, stale, refreshing };
}

/** fetch everything and write the cache. keeps the last good value for a source that fails. */
export async function refreshStats(env: StatsEnv): Promise<Stats> {
  const prev = await readStats(env);
  const errors: Stats["errors"] = {};

  let github = prev?.github ?? null;
  try {
    github = await fetchGitHub(env.GITHUB_TOKEN);
  } catch (e) {
    errors.github = e instanceof Error ? e.message : String(e);
  }

  const next: Stats = { v: 1, fetchedAt: new Date().toISOString(), github, hackatime: null, errors };
  await env.STATS.put(KEY, JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------- github

async function gh<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": UA,
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`github ${path.split("?")[0]} → ${res.status}`);
  return res.json() as Promise<T>;
}

type Event = { type: string; created_at: string; repo: { name: string }; payload: { head?: string; ref?: string } };

async function fetchGitHub(token?: string): Promise<GitHub> {
  const [user, events] = await Promise.all([
    gh<{ public_repos: number; html_url: string }>(`/users/${GITHUB_USER}`, token),
    gh<Event[]>(`/users/${GITHUB_USER}/events/public?per_page=100`, token),
  ]);

  const pushes = events
    .filter((e) => e.type === "PushEvent")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  // 14 UTC days, oldest first
  const day = (t: number) => Math.floor(t / 86_400_000);
  const today = day(Date.now());
  const pushes14d = Array.from({ length: 14 }, () => 0);
  for (const p of pushes) {
    const ago = today - day(Date.parse(p.created_at));
    if (ago >= 0 && ago < 14) pushes14d[13 - ago]++;
  }

  let lastPush: GitHub["lastPush"] = null;
  const last = pushes[0];
  if (last) {
    let message: string | null = null;
    if (last.payload.head) {
      try {
        const c = await gh<{ commit: { message: string } }>(`/repos/${last.repo.name}/commits/${last.payload.head}`, token);
        message = c.commit.message.split("\n")[0].slice(0, 120);
      } catch {
        /* message is a nice-to-have */
      }
    }
    lastPush = {
      repo: last.repo.name.split("/").pop()!,
      at: last.created_at,
      message,
      url: `https://github.com/${last.repo.name}`,
    };
  }

  return {
    user: GITHUB_USER,
    url: user.html_url,
    publicRepos: user.public_repos ?? null,
    lastPush,
    pushes14d,
    // a calendar failure shouldn't throw away the rest
    calendar: token ? await fetchCalendar(token).catch((e) => (console.error(e), null)) : null,
  };
}

const LEVEL: Record<string, number> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

async function fetchCalendar(token: string): Promise<GitHub["calendar"]> {
  const query = `query($login: String!) { user(login: $login) { contributionsCollection { contributionCalendar {
    totalContributions weeks { contributionDays { contributionLevel } } } } } }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ query, variables: { login: GITHUB_USER } }),
  });
  if (!res.ok) throw new Error(`github graphql → ${res.status}`);
  const json = (await res.json()) as any;
  const cal = json?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) throw new Error("github graphql: no calendar");
  return {
    total: cal.totalContributions,
    weeks: cal.weeks.map((w: any) => w.contributionDays.map((d: any) => LEVEL[d.contributionLevel] ?? 0)),
  };
}

// ---------------------------------------------------------------- display helpers

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return `${Math.round(s / (86400 * 30))}mo ago`;
}
