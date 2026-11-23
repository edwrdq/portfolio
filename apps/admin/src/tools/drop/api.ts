import { env } from "cloudflare:workers";
import { deleteDrop, hashPassword, keyName, newToken, PART_SIZE, purgeExpired, TOKEN_RE, type DropFile } from "@edwrdq/drop";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";

type FileIn = { name?: string; size?: number; type?: string };
type In = {
  token?: string;
  note?: string;
  expires_at?: number;
  max_downloads?: number | null;
  password?: string;
  files?: FileIn[];
  idx?: number;
  parts?: { partNumber: number; etag: string }[];
  seconds?: number;
};

const MAX_FILES = 50;
const MAX_EXPIRY_S = 60 * 60 * 24 * 30; // 30d — matches the r2 lifecycle backstop (31d)

const fileRow = (token: string, idx: number) =>
  env.DB.prepare("SELECT * FROM drop_files WHERE drop_token = ? AND idx = ?").bind(token, idx).first<DropFile>();

export const POST: ToolApi["POST"] = async ({ request, url }, path) => {
  // ---- raw file part: /api/drop/part?token=…&idx=…&part=…  (body = bytes)
  if (path[0] === "part") {
    const token = url.searchParams.get("token") ?? "";
    const idx = Number(url.searchParams.get("idx"));
    const part = Number(url.searchParams.get("part"));
    if (!TOKEN_RE.test(token) || !Number.isInteger(idx) || !Number.isInteger(part) || part < 1 || part > 10000) return fail("bad part");
    const f = await fileRow(token, idx);
    if (!f?.upload_id || f.done) return fail("no upload in progress", 409);
    const len = Number(request.headers.get("content-length"));
    if (!request.body || !len) return fail("empty part");
    if (len > PART_SIZE) return fail("part too big");
    const up = env.DROP.resumeMultipartUpload(f.r2_key, f.upload_id);
    const res = await up.uploadPart(part, request.body);
    return json({ ok: true, partNumber: res.partNumber, etag: res.etag });
  }

  const b = (await body<In>(request)) ?? {};
  const token = typeof b.token === "string" ? b.token : "";

  switch (path[0]) {
    // 1. reserve the drop + file rows
    case "create": {
      const files = Array.isArray(b.files) ? b.files : [];
      if (!files.length) return fail("add a file");
      if (files.length > MAX_FILES) return fail(`${MAX_FILES} files max per drop`);
      const now = Math.floor(Date.now() / 1000);
      const exp = Number(b.expires_at);
      if (!Number.isFinite(exp) || exp <= now + 60 || exp > now + MAX_EXPIRY_S) return fail("expiry: between a minute and 30 days");
      const max = b.max_downloads === null || b.max_downloads === undefined || (b.max_downloads as unknown) === "" ? null : Number(b.max_downloads);
      if (max !== null && (!Number.isInteger(max) || max < 1 || max > 100000)) return fail("max downloads: a whole number ≥ 1");
      const note = typeof b.note === "string" ? b.note.replace(/\r\n?/g, "\n").trim().slice(0, 1000) || null : null;
      const pw = typeof b.password === "string" && b.password.length ? b.password : null;
      if (pw && pw.length > 200) return fail("password too long");

      const t = newToken();
      const stmts = [
        env.DB.prepare("INSERT INTO drops (token, note, expires_at, max_downloads, password_hash) VALUES (?, ?, ?, ?, ?)").bind(
          t, note, Math.floor(exp), max, pw ? await hashPassword(pw) : null,
        ),
      ];
      files.forEach((f, idx) => {
        const name = (typeof f.name === "string" ? f.name : "").replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 255) || `file-${idx + 1}`;
        const size = Number(f.size);
        if (!Number.isFinite(size) || size < 0) throw new Error("bad size");
        const type = typeof f.type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(f.type) ? f.type.slice(0, 100) : null;
        stmts.push(
          env.DB.prepare("INSERT INTO drop_files (drop_token, idx, r2_key, filename, size, content_type) VALUES (?, ?, ?, ?, ?, ?)").bind(
            t, idx, `drops/${t}/${idx}-${keyName(name)}`, name, Math.floor(size), type,
          ),
        );
      });
      await env.DB.batch(stmts);
      return json({ ok: true, token: t, partSize: PART_SIZE });
    }

    // 2. start a file's multipart upload
    case "start": {
      if (!TOKEN_RE.test(token) || !Number.isInteger(b.idx)) return fail("bad request");
      const f = await fileRow(token, b.idx!);
      if (!f || f.done) return fail("no such file", 404);
      const up = await env.DROP.createMultipartUpload(f.r2_key, {
        httpMetadata: { contentType: f.content_type ?? "application/octet-stream" },
      });
      await env.DB.prepare("UPDATE drop_files SET upload_id = ? WHERE id = ?").bind(up.uploadId, f.id).run();
      return json({ ok: true });
    }

    // 3. finish a file
    case "complete": {
      if (!TOKEN_RE.test(token) || !Number.isInteger(b.idx) || !Array.isArray(b.parts) || !b.parts.length) return fail("bad request");
      const f = await fileRow(token, b.idx!);
      if (!f?.upload_id) return fail("no upload in progress", 409);
      const parts = b.parts
        .filter((p) => Number.isInteger(p.partNumber) && typeof p.etag === "string")
        .sort((x, y) => x.partNumber - y.partNumber);
      const obj = await env.DROP.resumeMultipartUpload(f.r2_key, f.upload_id).complete(parts);
      if (obj.size !== f.size) return fail(`size mismatch (${obj.size} vs ${f.size})`, 409);
      await env.DB.prepare("UPDATE drop_files SET done = 1, upload_id = NULL WHERE id = ?").bind(f.id).run();
      return json({ ok: true });
    }

    // 4. publish the drop once every file is in
    case "finalize": {
      if (!TOKEN_RE.test(token)) return fail("bad request");
      const left = await env.DB.prepare("SELECT count(*) AS n FROM drop_files WHERE drop_token = ? AND done = 0").bind(token).first<{ n: number }>();
      if (left?.n) return fail(`${left.n} file(s) still uploading`, 409);
      await env.DB.prepare("UPDATE drops SET ready = 1 WHERE token = ?").bind(token).run();
      return json({ ok: true, url: `https://edwrdq.com/d/${token}` });
    }

    // cancel mid-upload, or revoke a live drop: everything goes
    case "abort":
    case "revoke": {
      if (!TOKEN_RE.test(token)) return fail("bad request");
      const { results } = await env.DB.prepare("SELECT r2_key, upload_id FROM drop_files WHERE drop_token = ? AND upload_id IS NOT NULL").bind(token).all<{ r2_key: string; upload_id: string }>();
      for (const r of results) await env.DROP.resumeMultipartUpload(r.r2_key, r.upload_id).abort().catch(() => {});
      await deleteDrop(env, token);
      return json({ ok: true });
    }

    case "extend": {
      const secs = Number(b.seconds);
      if (!TOKEN_RE.test(token) || !Number.isInteger(secs) || secs < 60 || secs > MAX_EXPIRY_S) return fail("bad request");
      // extend from whichever is later (now or the current expiry), but never past 30d after
      // creation — the r2 lifecycle rule deletes objects at 31d old no matter what d1 says
      const r = await env.DB.prepare(
        `UPDATE drops SET expires_at = min(max(expires_at, unixepoch()) + ?, created_at + ?) WHERE token = ? AND ready = 1`,
      ).bind(secs, MAX_EXPIRY_S, token).run();
      if (!r.meta.changes) return fail("not found", 404);
      const d = await env.DB.prepare("SELECT expires_at, created_at FROM drops WHERE token = ?").bind(token).first<{ expires_at: number; created_at: number }>();
      return json({ ok: true, capped: d ? d.expires_at >= d.created_at + MAX_EXPIRY_S : false });
    }

    case "purge":
      return json({ ok: true, purged: await purgeExpired(env) });

    default:
      return fail("not found", 404);
  }
};
