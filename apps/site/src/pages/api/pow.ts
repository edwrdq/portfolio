// proof-of-work challenge for onion visitors (they can't do turnstile). see lib/server/submit.ts
import type { APIRoute } from "astro";
import { handle, json, powChallenge } from "../../lib/server/submit";

export const prerender = false;

export const GET: APIRoute = () => handle(async () => json({ ok: true, ...(await powChallenge()) }));
