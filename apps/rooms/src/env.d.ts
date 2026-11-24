// secrets + dev-only vars that `wrangler types` can't see
declare namespace Cloudflare {
  interface Env {
    IP_SALT?: string;
  }
}
