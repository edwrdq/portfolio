# edwrdq

my personal site, idek how to explain the vision i had or what type of prompts led to this but happy to be here

[edwrdq.com](https://edwrdq.com) , tor: `edwrdq2i5j6rzklp7kefikjnk5fwff7kocdzmv4zmqj4jgaodjpogaad.onion` 

black, bone, charcoal, and acid accent color, pixel icons, and nothing lined up on purpose

--- 

## what's here

- portfolio: indicatoriq, hlvm, music, clothes, garage, work, misc, blog
- now: rich presence type thing using discord, show what im listening to along with hackatime activity 
- guestbook + comments are moderated by me in the admin dashboard
- tools: [/dither](https://edwrdq.com/dither), free image dithering tool running locally in your browser
- dailies: daily puzzles like picross (i dont like picross claude told me to add that), locate, asm, diagnose, real or random, logic, and estimate (those are cool) 
- multiplayer: auction (buy wrecked cars) and arena (vex type robots), lobby chat
- admin: private side for tools i made myself, on a separate subdomain gated behind cloudflare access 

## who built it 

mostly claude, opus 5.5 if anyone cares although i doubt that changes much . i mostly just found references, images, design direction, etc. (more info in the [first blog post](https://edwrdq.com/blog)). not a frontend designer. 

## stack 

 - astro monorepo, pnpm workspace
 - cloudflare workers
 - d1 for data, kv for cache, r2 for files and images
 - durable objects + websockets for multiplayer
 - turnstile for spam, cloudflare access for admin
 - small debian vps running tor + caddy to forward edwrdq.com thru tor

## layout 

```text
apps/
  site/        edwrdq.com
  admin/       the private side (tools are plug-ins in src/tools/<name>/)
packages/
  ui/          tokens, fonts, pixel icons, shared components
migrations/    d1 schema
scripts/       dither.mjs and friends
```

## run it

```text
pnpm install
pnpm --filter site dev
pnpm --filter admin dev
```

pnpm blocks install scripts by default, if something needs one run `pnpm approve-builds`

database: 
`pnpx wrangler d1 migrations apply edwrdq-db --local` 

deploy (from app folder): 
`pnpm build && pnpx wrangler deploy` 

secrets live in cloudflare (`wrangler secret put`)

## content 

 - blog posts `apps/site/src/content/blog/*.md`
 - section entries: `apps/site/src/content/projects/<section>/*.md`
 - photos: drop them in `/raw`, run `pnpm dither`, stuff comes out in the site style

## design rules

 - no rounded corners, shadow, gradient, or glow 
 - acid (#b8c43a) at most ~4 times per screen 
 - lowercase, short, text type content
 - when in doubt, take it out 

--- 

claude outline had copyright here but i doubt this is that cool to need it , writing images and design are mine unless it is credited for someone else then its.. not mine 