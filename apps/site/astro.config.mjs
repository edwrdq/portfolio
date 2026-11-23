// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import mdx from "@astrojs/mdx";

// `astro dev` uses the "dev" wrangler env (no worker-first asset routing).
// builds/deploys use the top-level config, where page views run the worker (visitor map).
if (process.argv.includes("dev")) process.env.CLOUDFLARE_ENV ??= "dev";

// https://astro.build/config
export default defineConfig({
  site: "https://edwrdq.com",
  adapter: cloudflare(),
  integrations: [mdx()],
  markdown: {
    shikiConfig: { theme: "vitesse-black" },
  },
});
