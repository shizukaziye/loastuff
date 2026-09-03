# Loseii (repo: loastuff)

The site behind **https://www.loseii.com/** — every tool I've built for Lost Ark, League, and personal finance, plus the shared chrome that ties them together.

Cloudflare Pages deploys `main` on every push. The custom domain is `www.loseii.com`; the apex `loseii.com` redirects to it.

## Layout

- `index.html` — the hub landing page
- `nav.js`, `social-bar.js` — shared top nav + social bar; every page (including the tools still on GitHub Pages) loads them from `https://www.loseii.com/`
- `_headers`, `_redirects` — Cloudflare Pages config (cache rules, old-URL redirects)
- `lost-ark-accessories/` — Accessory Value Calculator
- `loa-astrogem-calc/` — Astrogem Calculator (grader / pipeline / advisor / leaderboard, plus its Cloudflare workers under `worker/`)
- `loa-crafting-calculator/` — Stronghold Crafting Profit (baked market snapshot)
- `loa-deal-finder/` — Deal Finder (baked market data)
- `loa-on-2026-summer/` — LOA ON 2026 Summer recap
- `loa-tierlist/` — retired; redirect stub
- `.github/workflows/refresh-data.yml` — re-bakes the two market tools' data every 6 hours and commits back (which redeploys)

## Tools

**Lost Ark**
- [Accessory Value Calculator](https://www.loseii.com/lost-ark-accessories/) — score any accessory by its real % damage gain
- [Astrogem Calculator](https://www.loseii.com/loa-astrogem-calc/) — cut/fuse/throw pipeline tables, screenshot advisor, leaderboard
- [Stronghold Crafting Profit](https://www.loseii.com/loa-crafting-calculator/) — every craft ranked by net gold, gold/hr, ROI
- [Deal Finder](https://www.loseii.com/loa-deal-finder/) — market items ranked vs a robust 14-day fair price
- [LOA ON Bingo](https://loa-on-bingo.shizukaziye.workers.dev/) — live multiplayer watch-party bingo (own repo)
- [LOA ON 2026 Summer](https://www.loseii.com/loa-on-2026-summer/) — showcase recap

**League of Legends**
- [Champion Pool Coverage](https://shizukaziye.github.io/lol-pool-coverage/) — analyze your pool vs the live meta (own repo)

**Trading Card Games**
- [CN Card Finder](https://shizukaziye.github.io/cn-card-finder/) — EN→CN card names + search strings for sourcing from China (own repo)
- [Riftbound Tier List Maker](https://shizukaziye.github.io/riftbound-tierlist/) — search every Riftbound card, drag into tiers, share link / PNG export (own repo)
- [Nine-Legend Flex Sheet](https://shizukaziye.github.io/riftbound-flex-sheet/) — Riftbound flex cards per legend from the Wuhan top 32 + Barcelona top 64, max copies any list ran (own repo)
- [TCG Price Tracker](https://tcg-price-tracker.pages.dev/) — price watchlist incl. jihuanshe CNY vs PriceCharting USD (own repo)

**Finance**
- [FIRE Calculator](https://shizukaziye.github.io/fire-calculator/) — FIRE planner with fixed, historical, and Monte-Carlo modes (own repo)

---

Unofficial fan tools — not affiliated with Smilegate, Amazon Games, or Riot Games.
