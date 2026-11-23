// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// `astro dev` uses the "dev" wrangler env (no worker-first asset routing).
// builds/deploys use the top-level config, where every request hits the JWT check.
if (process.argv.includes("dev")) process.env.CLOUDFLARE_ENV ??= "dev";

// https://astro.build/config
export default defineConfig({
  site: "https://admin.edwrdq.com",
  // everything is rendered per request, behind the Access check in src/worker.ts
  output: "server",
  adapter: cloudflare(),
});
