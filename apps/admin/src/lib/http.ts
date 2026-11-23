export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export const fail = (error: string, status = 400) => json({ ok: false, error }, status);

/**
 * mutating requests must be same-origin: json with no cross-site origin, or — for raw
 * bodies like file parts — an explicit same-origin Origin header. blocks cross-site posts.
 */
export function sameOriginJson(request: Request, url: URL) {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return false;
  if (request.headers.get("content-type")?.includes("application/json")) return true;
  return origin === url.origin;
}

export async function body<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

/** unix seconds → "5m ago" style */
export function ago(unix: number) {
  const s = Math.round(unix - Date.now() / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

/** unix seconds → 2026.11.23 14:02 (UTC) */
export function when(unix: number) {
  return new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ").replace(/-/g, ".");
}
