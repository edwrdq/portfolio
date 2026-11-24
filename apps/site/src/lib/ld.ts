// json-ld for the daily puzzle pages (Game + FAQPage). escaped for a <script> tag.
const SITE = "https://edwrdq.com";

type Faq = { q: string; a: string }[];

export function gameLd(o: { path: string; name: string; description: string; faq: Faq; og: string }) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Game",
        name: o.name,
        url: SITE + o.path,
        description: o.description,
        genre: "puzzle",
        gamePlatform: "web browser",
        numberOfPlayers: { "@type": "QuantitativeValue", value: 1 },
        isAccessibleForFree: true,
        inLanguage: "en",
        image: `${SITE}/og/${o.og}.png`,
        author: { "@type": "Person", name: "edward quintero", url: `${SITE}/` },
      },
      {
        "@type": "FAQPage",
        mainEntity: o.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  }).replace(/</g, "\\u003c");
}

/** json-ld for a multiplayer game page (/play/<game>) */
export function playLd(o: { path: string; name: string; description: string; faq: Faq; og: string; min: number; max: number; genre: string }) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Game",
        name: o.name,
        url: SITE + o.path,
        description: o.description,
        genre: o.genre,
        gamePlatform: "web browser",
        playMode: "MultiPlayer",
        numberOfPlayers: { "@type": "QuantitativeValue", minValue: o.min, maxValue: o.max },
        isAccessibleForFree: true,
        inLanguage: "en",
        image: `${SITE}/og/${o.og}.png`,
        author: { "@type": "Person", name: "edward quintero", url: `${SITE}/` },
      },
      {
        "@type": "FAQPage",
        mainEntity: o.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  }).replace(/</g, "\\u003c");
}
