---
title: hello
date: 2026-11-23
summary: the site is up. here's how it works.
tags: [meta]
draft: true
---

this is a draft, so it only shows up in dev. flip `draft` to `false` to publish.

## how posts work

markdown or mdx in `src/content/blog/`. newest first on `/blog`, and in the [rss feed](/rss.xml).

```ts
const posts = await getPosts(); // drafts hidden in prod
```

- lowercase
- short
- no buzzwords
