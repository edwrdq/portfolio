// secrets aren't in wrangler.jsonc, so `wrangler types` can't see them
declare namespace Cloudflare {
  interface Env {
    GITHUB_TOKEN?: string;
    HACKATIME_API_KEY?: string;
  }
}
