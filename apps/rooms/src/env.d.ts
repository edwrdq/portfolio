// secrets + local-only vars that `wrangler types` can't see
interface Env {
  IP_SALT?: string;
  /** shared with the tor vps (same value as the site's): X-From-Onion */
  ONION_SECRET?: string;
  /** local testing only (`--var FAST:1`): speeds up game clocks */
  FAST?: string;
}
