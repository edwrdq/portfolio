import { env } from "cloudflare:workers";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";

type In = { id?: number; url?: string; slug?: string; expires_at?: number | null; disabled?: boolean };

// system routes on edwrdq.com. links live under /x/ so nothing truly collides today, but
// these stay off-limits in case short links ever move to the root. section names
// (/x/hlvm etc.) are fine — they're the obvious slugs to want.
const RESERVED = new Set([
  "api", "admin", "x", "d", "og", "img", "rss", "rss.xml", "styleguide", "privacy",
  "404", "500", "_astro", "_server-islands", "favicon", "favicon.ico", "robots.txt", "sitemap", "login",
]);
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
// no 0/o/1/l/i — readable when typed from a qr or a screenshot
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

const randomSlug = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
};

function checkUrl(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw "paste a url";
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    throw "that's not a url";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw "http or https only";
  if (/(^|\.)edwrdq\.com$/.test(u.hostname) && u.pathname.startsWith("/x/")) throw "can't point a short link at another short link";
  const s = u.toString();
  if (s.length > 2000) throw "url's too long (2000 max)";
  return s;
}

function checkSlug(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!SLUG.test(s)) throw "slug: a–z, 0–9, - and _ only, up to 40";
  if (RESERVED.has(s)) throw `"${s}" is reserved`;
  return s;
}

function checkExpiry(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= Date.now() / 1000) throw "expiry has to be in the future";
  return Math.floor(v);
}

const taken = async (slug: string, exceptId?: number) =>
  !!(await env.DB.prepare("SELECT 1 FROM links WHERE slug = ? AND id IS NOT ?").bind(slug, exceptId ?? null).first());

export const POST: ToolApi["POST"] = async ({ request }, path) => {
  const b = (await body<In>(request)) ?? {};
  try {
    switch (path[0]) {
      case "create": {
        const url = checkUrl(b.url);
        const expires = checkExpiry(b.expires_at);
        let slug: string;
        if (b.slug && String(b.slug).trim()) {
          slug = checkSlug(b.slug);
          if (await taken(slug)) throw `"${slug}" is taken`;
        } else {
          let tries = 0;
          do slug = randomSlug();
          while ((RESERVED.has(slug) || (await taken(slug))) && ++tries < 10);
        }
        await env.DB.prepare("INSERT INTO links (slug, url, expires_at) VALUES (?, ?, ?)").bind(slug, url, expires).run();
        return json({ ok: true, slug });
      }
      case "update": {
        if (!Number.isInteger(b.id)) throw "bad id";
        const url = checkUrl(b.url);
        const slug = checkSlug(b.slug);
        const expires = checkExpiry(b.expires_at);
        if (await taken(slug, b.id)) throw `"${slug}" is taken`;
        const r = await env.DB.prepare("UPDATE links SET url = ?, slug = ?, expires_at = ? WHERE id = ?").bind(url, slug, expires, b.id).run();
        if (!r.meta.changes) return fail("not found", 404);
        return json({ ok: true });
      }
      case "toggle": {
        if (!Number.isInteger(b.id)) throw "bad id";
        await env.DB.prepare("UPDATE links SET disabled = ? WHERE id = ?").bind(b.disabled ? 1 : 0, b.id).run();
        return json({ ok: true });
      }
      case "delete": {
        if (!Number.isInteger(b.id)) throw "bad id";
        await env.DB.prepare("DELETE FROM links WHERE id = ?").bind(b.id).run();
        return json({ ok: true });
      }
      default:
        return fail("not found", 404);
    }
  } catch (e) {
    if (typeof e === "string") return fail(e);
    throw e;
  }
};
