// is this request coming through the tor doorway? only if X-From-Onion matches ONION_SECRET exactly
// (the vps adds it; nobody else knows it). no secret set = never onion.
import { env } from "cloudflare:workers";

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function isOnion(request: Request, secret: string | undefined = (env as { ONION_SECRET?: string }).ONION_SECRET) {
  const got = request.headers.get("x-from-onion");
  return !!secret && !!got && same(got, secret);
}
