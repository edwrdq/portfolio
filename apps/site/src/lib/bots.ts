// good-enough bot / preview-fetcher filter for counting humans (link clicks, visits).
// not security — just keeps unfurlers and crawlers out of the numbers.
const BOT =
  /bot|crawl|spider|slurp|preview|fetch|scan|monitor|curl|wget|httpie|python-|go-http|java\/|okhttp|axios|node-fetch|undici|headless|phantom|lighthouse|pagespeed|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|twitter|linkedin|skype|vkshare|pinterest|redditbot|applebot|bingpreview|yandex|baidu|duckduck|semrush|ahrefs|mj12|petal|bytespider|gptbot|claudebot|perplexity|ccbot/i;

export function isBot(request: Request) {
  const ua = request.headers.get("user-agent") ?? "";
  if (!ua || ua.length < 20) return true;
  if (request.headers.get("purpose") === "prefetch" || request.headers.get("sec-purpose")?.includes("prefetch")) return true;
  return BOT.test(ua);
}
