// POST /d/<token>/start — the DOWNLOAD button. checks the password (rate limited per
// token), counts one download, and returns a ticket the browser uses to fetch each file.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { dropState, newToken, PW_MAX_FAILS, PW_WINDOW_S, TICKET_TTL_S, TOKEN_RE, verifyPassword, type Drop } from "@edwrdq/drop";

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const POST: APIRoute = async ({ params, request }) => {
  const token = params.token ?? "";
  if (!TOKEN_RE.test(token)) return json({ ok: false, error: "this drop expired." }, 404);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: "nope." }, 403);

  const d = await env.DB.prepare("SELECT * FROM drops WHERE token = ?").bind(token).first<Drop>();
  if (!d || dropState(d) !== "live") return json({ ok: false, error: "this drop expired." }, 404);

  if (d.password_hash) {
    const now = Math.floor(Date.now() / 1000);
    const inWindow = now - d.pw_window < PW_WINDOW_S;
    if (inWindow && d.pw_fails >= PW_MAX_FAILS) {
      const wait = Math.ceil((d.pw_window + PW_WINDOW_S - now) / 60);
      return json({ ok: false, error: `too many tries. wait ${wait}m.` }, 429);
    }
    let pw = "";
    try {
      pw = String(((await request.json()) as { password?: unknown }).password ?? "");
    } catch {
      /* empty */
    }
    if (!pw || pw.length > 200 || !(await verifyPassword(pw, d.password_hash))) {
      await env.DB.prepare(
        inWindow ? "UPDATE drops SET pw_fails = pw_fails + 1 WHERE token = ?" : "UPDATE drops SET pw_fails = 1, pw_window = unixepoch() WHERE token = ?",
      ).bind(token).run();
      const left = PW_MAX_FAILS - (inWindow ? d.pw_fails + 1 : 1);
      return json({ ok: false, error: left > 0 ? `wrong password. ${left} ${left === 1 ? "try" : "tries"} left.` : "wrong password. locked for a bit." }, 403);
    }
    if (d.pw_fails) await env.DB.prepare("UPDATE drops SET pw_fails = 0 WHERE token = ?").bind(token).run();
  }

  // count it — atomically, so max_downloads can't be raced past
  const counted = await env.DB.prepare(
    `UPDATE drops SET download_count = download_count + 1
     WHERE token = ? AND ready = 1 AND expires_at > unixepoch()
       AND (max_downloads IS NULL OR download_count < max_downloads)`,
  ).bind(token).run();
  if (!counted.meta.changes) return json({ ok: false, error: "this drop expired." }, 404);

  const ticket = newToken();
  await env.DB.prepare("INSERT INTO drop_tickets (ticket, drop_token, expires_at) VALUES (?, ?, unixepoch() + ?)").bind(ticket, token, TICKET_TTL_S).run();
  const { results } = await env.DB.prepare("SELECT idx FROM drop_files WHERE drop_token = ? AND done = 1 ORDER BY idx").bind(token).all<{ idx: number }>();
  return json({ ok: true, files: results.map((f) => `/d/${token}/f/${f.idx}?t=${ticket}`) });
};
