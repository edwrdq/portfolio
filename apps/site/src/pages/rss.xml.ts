import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getPosts } from "../lib/content";

export const GET: APIRoute = async (context) => {
  const posts = (await getPosts()).filter((p) => !p.data.draft);
  return rss({
    title: "edwrdq — blog",
    description: "notes.",
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date,
      description: p.data.summary,
      categories: p.data.tags,
      link: `/blog/${p.id}/`,
    })),
    customData: "<language>en-us</language>",
  });
};
