// secrets aren't in wrangler.jsonc, so `wrangler types` can't see them
declare namespace Cloudflare {
  interface Env {
    TURNSTILE_SECRET?: string;
    IP_SALT?: string;
    /** shared with the tor vps: requests carrying it in X-From-Onion are onion visits */
    ONION_SECRET?: string;
    DISCORD_WEBHOOK_URL?: string;
    GITHUB_TOKEN?: string;
    HACKATIME_API_KEY?: string;
  }
}
