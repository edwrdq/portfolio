import { env } from "cloudflare:workers";
import type { ToolApi } from "../../lib/tools";
import { body, fail, json } from "../../lib/http";

type Act = {
  kind: "comment" | "message";
  id: number;
  action: "approve" | "reject" | "delete" | "reply";
  reply?: string;
};

const TABLE = { comment: "comments", message: "messages" } as const;

export const POST: ToolApi["POST"] = async ({ request }, path) => {
  if (path[0] !== "act") return fail("not found", 404);
  const b = await body<Act>(request);
  if (!b || !(b.kind in TABLE) || !Number.isInteger(b.id)) return fail("bad request");
  const table = TABLE[b.kind];

  let stmt: D1PreparedStatement;
  switch (b.action) {
    case "approve":
      stmt = env.DB.prepare(`UPDATE ${table} SET status = 'approved' WHERE id = ?`).bind(b.id);
      break;
    case "reject":
      stmt = env.DB.prepare(`UPDATE ${table} SET status = 'rejected' WHERE id = ?`).bind(b.id);
      break;
    case "delete":
      stmt = env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(b.id);
      break;
    case "reply": {
      if (b.kind !== "comment") return fail("only comments take replies");
      const reply = typeof b.reply === "string" ? b.reply.replace(/\r\n?/g, "\n").trim() : "";
      if (reply.length > 2000) return fail("reply's too long (2000 max)");
      // replying publishes the comment with it
      stmt = env.DB.prepare(`UPDATE comments SET reply = ?, status = 'approved' WHERE id = ?`).bind(reply || null, b.id);
      break;
    }
    default:
      return fail("unknown action");
  }

  const res = await stmt.run();
  if (!res.meta.changes) return fail("not found (already handled?)", 404);
  return json({ ok: true });
};
