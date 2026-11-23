// pwa manifest — "add to home screen" opens straight to the idea inbox.
// served behind access like everything else, so the <link> uses crossorigin="use-credentials".
import type { APIRoute } from "astro";
import tokens from "@edwrdq/ui/tokens.css?raw";

const tok = (name: string) => tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: "edwrdq admin",
      short_name: "ideas",
      description: "capture first, think later",
      id: "/ideas",
      start_url: "/ideas",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: tok("bg"),
      theme_color: tok("bg"),
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      // android: share → "edwrdq admin" from any app lands in later
      share_target: {
        action: "/share",
        method: "POST",
        enctype: "application/x-www-form-urlencoded",
        params: { title: "title", text: "text", url: "url" },
      },
      shortcuts: [
        { name: "later", url: "/later" },
        { name: "vault", url: "/vault" },
        { name: "queue", url: "/queue" },
        { name: "now", url: "/now" },
      ],
    }),
    { headers: { "content-type": "application/manifest+json; charset=utf-8" } },
  );
