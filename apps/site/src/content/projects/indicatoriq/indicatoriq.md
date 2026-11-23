---
title: indicatoriq
section: indicatoriq
date: 2026-03-idk
summary: fintech + algorithms. the company.
status: active
links:
  - label: indicatoriq.app
    href: https://indicatoriq.app
---

indicatoriq is stock analysis for retail traders.

i got into trading around 2020. every good analysis tool was expensive, and i was 9, so writing my own wasn't really an option.

now everyone trades. cash app has a buy button, but most people never learned finance. they want the tools the pros use, just not at bloomberg terminal prices (that thing costs more a year than a lot of people make).

indicatoriq is planned at $40/mo, a tiny fraction of that. we don't have every feature (those are expensive), but we get pretty close for the price. and people clearly want this: robinhood gold alone has millions of subscribers.

once i finally had the skills to actually build it, i started it with my best friend in march 2026.

my side: the algorithms and math, backend architecture, and the finance. his side: marketing, UI design, and the big decisions with me.

under the hood it's split by how heavy the math is. the heavy stuff, like iceberg detection, runs on a fly.io server. the fast stuff runs in milliseconds on cloudflare, right next to the frontend.

right now we're building and looking for funding. market data isn't cheap. there's a waitlist + demo at [indicatoriq.app](https://indicatoriq.app) (the demo's down for now, since paying for data every month adds up).
