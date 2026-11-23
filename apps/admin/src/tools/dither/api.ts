import { env } from "cloudflare:workers";
import { clean } from "@edwrdq/dither";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";

// published images live in the edwrdq-media bucket (binding MEDIA) under img/,
// served by the site at edwrdq.com/img/<file>. until the bucket exists, publish says so.
type Bucket = R2Bucket;
const media = () => (env as unknown as { MEDIA?: Bucket }).MEDIA;
const NOT_SET_UP = "publishing isn't set up yet — the edwrdq-media bucket needs creating first.";
const MAX_PNG = 10 * 1024 * 1024;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

type In = { id?: number; name?: string; params?: unknown; overwrite?: boolean; key?: string };

export const GET: ToolApi["GET"] = async (_ctx, path) => {
  if (path[0] === "published") {
    const m = media();
    if (!m) return json({ ok: true, ready: false, items: [] });
    const list = await m.list({ prefix: "img/", limit: 100, include: ["customMetadata", "httpMetadata"] });
    const items = list.objects
      .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
      .map((o) => ({ key: o.key, url: `https://edwrdq.com/${o.key}`, size: o.size, alt: o.customMetadata?.alt ?? "", uploaded: o.uploaded.toISOString() }));
    return json({ ok: true, ready: true, items });
  }
  return fail("not found", 404);
};

export const POST: ToolApi["POST"] = async ({ request, url }, path) => {
  // ---- publish: raw png body. only the processed image ever leaves the browser.
  if (path[0] === "publish") {
    const m = media();
    if (!m) return fail(NOT_SET_UP, 503);
    const name = (url.searchParams.get("name") ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "img";
    const alt = (url.searchParams.get("alt") ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const len = Number(request.headers.get("content-length"));
    if (!len || len > MAX_PNG) return fail("png must be under 10 MB");
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.byteLength > MAX_PNG || !PNG_SIG.every((b, i) => buf[i] === b)) return fail("that's not a png");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].slice(0, 5).map((b) => b.toString(16).padStart(2, "0")).join("");
    const key = `img/${name}-${hash}.png`;
    await m.put(key, buf, {
      httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { alt },
    });
    const pub = `https://edwrdq.com/${key}`;
    const md = `![${alt.replace(/[[\]]/g, "")}](${pub})`;
    return json({ ok: true, url: pub, markdown: md, key });
  }

  const b = (await body<In>(request)) ?? {};
  switch (path[0]) {
    case "unpublish": {
      const m = media();
      if (!m) return fail(NOT_SET_UP, 503);
      if (typeof b.key !== "string" || !/^img\/[a-z0-9_-]+-[0-9a-f]{10}\.png$/.test(b.key)) return fail("bad key");
      await m.delete(b.key);
      return json({ ok: true });
    }
    case "preset": {
      const name = String(b.name ?? "").trim().toLowerCase();
      if (!NAME.test(name)) return fail("name: a–z, 0–9, - and _, up to 40");
      const params = JSON.stringify(clean(b.params as never));
      const exists = await env.DB.prepare("SELECT id FROM dither_presets WHERE name = ?").bind(name).first<{ id: number }>();
      if (exists && !b.overwrite) return json({ ok: false, exists: true, error: `"${name}" exists` }, 409);
      if (exists) await env.DB.prepare("UPDATE dither_presets SET params = ? WHERE id = ?").bind(params, exists.id).run();
      else await env.DB.prepare("INSERT INTO dither_presets (name, params) VALUES (?, ?)").bind(name, params).run();
      return json({ ok: true, preset: await env.DB.prepare("SELECT * FROM dither_presets WHERE name = ?").bind(name).first() });
    }
    case "default": {
      // id null clears the default (back to the script's parameters)
      await env.DB.batch([
        env.DB.prepare("UPDATE dither_presets SET is_default = 0"),
        ...(Number.isInteger(b.id) ? [env.DB.prepare("UPDATE dither_presets SET is_default = 1 WHERE id = ?").bind(b.id)] : []),
      ]);
      return json({ ok: true });
    }
    case "delete-preset": {
      if (!Number.isInteger(b.id)) return fail("bad id");
      await env.DB.prepare("DELETE FROM dither_presets WHERE id = ?").bind(b.id).run();
      return json({ ok: true });
    }
    default:
      return fail("not found", 404);
  }
};
