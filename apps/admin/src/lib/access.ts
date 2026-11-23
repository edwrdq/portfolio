// verify the Cloudflare Access JWT (Cf-Access-Jwt-Assertion).
// RS256 against the team's published certs; checks aud, iss, exp, nbf.

type Jwk = JsonWebKey & { kid: string; alg?: string };
type Claims = { aud: string | string[]; iss: string; exp: number; nbf?: number; iat?: number; email?: string; sub?: string };

const CERTS_TTL_MS = 60 * 60 * 1000;
const REFETCH_FLOOR_MS = 60 * 1000;
const LEEWAY_S = 60;

let certs: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;

const b64urlBytes = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = <T>(s: string): T => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function loadCerts(team: string, force = false) {
  const age = certs ? Date.now() - certs.fetchedAt : Infinity;
  if (certs && !force && age < CERTS_TTL_MS) return certs.keys;
  if (certs && force && age < REFETCH_FLOOR_MS) return certs.keys; // don't hammer on unknown kids

  const res = await fetch(`${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const map = new Map<string, CryptoKey>();
  for (const k of keys) {
    if (k.kty !== "RSA") continue;
    map.set(
      k.kid,
      await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]),
    );
  }
  certs = { keys: map, fetchedAt: Date.now() };
  return map;
}

export async function verifyAccess(token: string | null, team: string, aud: string): Promise<Claims | null> {
  if (!token || !team || !aud) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const [h, p, s] = parts;
    const header = b64urlJson<{ alg: string; kid: string }>(h);
    if (header.alg !== "RS256" || !header.kid) return null;

    let keys = await loadCerts(team);
    let key = keys.get(header.kid);
    if (!key) {
      keys = await loadCerts(team, true); // keys rotate
      key = keys.get(header.kid);
    }
    if (!key) return null;

    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlBytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return null;

    const claims = b64urlJson<Claims>(p);
    const now = Math.floor(Date.now() / 1000);
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) return null;
    if (claims.iss !== team) return null;
    if (typeof claims.exp !== "number" || claims.exp < now - LEEWAY_S) return null;
    if (typeof claims.nbf === "number" && claims.nbf > now + LEEWAY_S) return null;
    return claims;
  } catch {
    return null;
  }
}
