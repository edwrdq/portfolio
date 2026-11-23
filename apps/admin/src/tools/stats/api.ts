import { env } from "cloudflare:workers";
import { refreshStats } from "@edwrdq/stats";
import type { ToolApi } from "../../lib/tools";
import { fail, json } from "../../lib/http";

// admin can wait on outside APIs — it's the only place that does.
export const POST: ToolApi["POST"] = async (_ctx, path) => {
  if (path[0] !== "refresh") return fail("not found", 404);
  const data = await refreshStats(env);
  return json({ ok: true, data });
};
