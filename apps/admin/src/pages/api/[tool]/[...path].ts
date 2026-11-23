// dispatches /api/<tool>/<...path> to src/tools/<tool>/api.ts
import type { APIRoute } from "astro";
import { apis, getTool, type ToolApi } from "../../../lib/tools";
import { fail, sameOriginJson } from "../../../lib/http";

export const ALL: APIRoute = async (ctx) => {
  const slug = ctx.params.tool!;
  const load = apis[`../tools/${slug}/api.ts`];
  if (!getTool(slug) || !load) return fail("no such tool", 404);

  const method = ctx.request.method.toUpperCase() as keyof ToolApi;
  if (method !== "GET" && !sameOriginJson(ctx.request, ctx.url)) return fail("same-origin json only", 403);

  const mod = await load();
  const handler = mod[method];
  if (!handler) return fail("method not allowed", 405);

  const path = (ctx.params.path ?? "").split("/").filter(Boolean);
  try {
    return await handler(ctx, path);
  } catch (e) {
    console.error(e);
    return fail("something broke", 500);
  }
};
