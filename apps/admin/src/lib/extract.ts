// readability-lite: fetch a page and pull title / site / excerpt / main text, plain text only.
// streams through HTMLRewriter with a byte cap; never executes or stores markup.

export type Extracted = { title: string | null; site: string | null; excerpt: string | null; text: string };

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_TEXT = 200_000;
const SKIP = "script, style, noscript, template, svg, nav, footer, header, aside, form, button, iframe, select, figure figcaption";
const BLOCK = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, dt, dd, td";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const clean = (s: string | null | undefined, n: number) => {
  const t = decode(s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : null;
};

function capped(body: ReadableStream<Uint8Array>) {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        seen += chunk.byteLength;
        if (seen > MAX_BYTES) return ctl.terminate();
        ctl.enqueue(chunk);
      },
    }),
  );
}

export async function extract(url: string): Promise<Extracted> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; edwrdq-later/1.0; +https://edwrdq.com)",
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    },
  });
  if (!res.ok || !res.body) throw new Error(`fetch → ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/i.test(type)) throw new Error(`not html (${type || "unknown"})`);

  const meta: Record<string, string> = {};
  let titleTag = "";
  let skip = 0;
  let block = 0;
  let main = 0;
  let all = "";
  let mainText = "";

  const push = (s: string) => {
    if (all.length < MAX_TEXT) all += s;
    if (main > 0 && mainText.length < MAX_TEXT) mainText += s;
  };

  const rw = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? "").toLowerCase();
        const content = el.getAttribute("content");
        if (key && content && !meta[key]) meta[key] = content;
      },
    })
    .on("title", {
      text(t) {
        if (titleTag.length < 500) titleTag += t.text;
      },
    })
    .on(SKIP, {
      element(el) {
        skip++;
        el.onEndTag(() => void skip--);
      },
    })
    .on("article, main, [role=main]", {
      element(el) {
        main++;
        el.onEndTag(() => void main--);
      },
    })
    .on(BLOCK, {
      element(el) {
        block++;
        if (skip === 0) push("\n\n");
        el.onEndTag(() => void block--);
      },
    })
    .on("br", {
      element() {
        if (skip === 0 && block > 0) push("\n");
      },
    })
    .onDocument({
      text(t) {
        if (skip === 0 && block > 0 && t.text) push(t.text);
      },
    });

  // drain the transformed stream so every handler runs
  await rw.transform(new Response(capped(res.body), { headers: res.headers })).arrayBuffer();

  const tidy = (s: string) =>
    decode(s)
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT);
  const text = tidy(mainText.length > 500 ? mainText : all);
  const host = new URL(res.url || url).hostname.replace(/^www\./, "");

  return {
    title: clean(meta["og:title"] ?? meta["twitter:title"] ?? titleTag, 300),
    site: clean(meta["og:site_name"], 120) ?? host,
    excerpt: clean(meta["og:description"] ?? meta["description"] ?? meta["twitter:description"] ?? text.split("\n\n").find((p) => p.length > 60), 600),
    text,
  };
}
