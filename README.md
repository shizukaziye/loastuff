# Loseii (repo: loastuff)

The site behind **https://www.loseii.com/** — every tool I've built for Lost Ark, League, and personal finance, plus the shared chrome that ties them together.

Cloudflare Pages deploys `main` on every push. The custom domain is `www.loseii.com`; the apex `loseii.com` redirects to it.

## Layout

- `index.html` — the hub landing page
- `nav.js`, `social-bar.js` — shared top nav + social bar; every page (including the tools still on GitHub Pages) loads them from `https://www.loseii.com/`
- `_headers`, `_redirects` — Cloudflare Pages config (cache rules, old-URL redirects)
- `404.html` — Pages serves it for any path with no file; `favicon.svg` / `favicon.ico` — the site icon
- `chrome-cache-worker/` — keeps nav.js, social-bar.js and the two `prices.js` files un-cached on the zone (deploys on its own with wrangler)
- `package.json`, `tools/build-dist.mjs` — the optional minified build (below)
- `lost-ark-accessories/` — Accessory Value Calculator
- `loa-astrogem-calc/` — Astrogem Calculator (grader / pipeline / advisor / leaderboard, plus its Cloudflare workers under `worker/`)
- `loa-crafting-calculator/` — Stronghold Crafting Profit (baked market snapshot)
- `loa-deal-finder/` — Deal Finder (baked market data)
- `loa-hell-key-calc/` — Hell Key Calculator (Paradise Hell key EV; baked market reference prices)
- `loa-on-2026-summer/` — LOA ON 2026 Summer recap
- `loa-tierlist/` — retired; redirect stub
- `.github/workflows/refresh-data.yml` — re-bakes the two market tools' data every 6 hours and commits back (which redeploys)

## Minified deploy (ready, not switched on)

Pages serves the repo as it stands: no build command, output `/`. `npm run build` (`tools/build-dist.mjs`) makes a copy in `dist/` with comments and spare whitespace stripped from every `.js` (terser) and `.css` (csso). It renames nothing, so every path and `?v=` pin still names the same file. It leaves out worker source, `node_modules`, `samples/`, `data/cells`, `.cache` and `docs/` (except `loa-gpd/docs/METHODOLOGY.md`, which the chart links to), then checks that every `.js` in `dist/` still parses and fails the build if one does not. `npm run check-dist` runs the check alone.

To switch it on: Cloudflare dashboard → Workers & Pages → `loastuff` → Settings → Build → set **Build command** `npm run build` and **Build output directory** `dist`, then push (or retry the last deploy). To switch it off, clear the build command and set the output back to `/`. Keep `_headers` and `_redirects` at the repo root: the build copies them into `dist/`.

## Tools

**Lost Ark**
- [Accessory Value Calculator](https://www.loseii.com/lost-ark-accessories/) — score any accessory by its real % damage gain
- [Astrogem Calculator](https://www.loseii.com/loa-astrogem-calc/) — cut/fuse/throw pipeline tables, screenshot advisor, leaderboard
- [Stronghold Crafting Profit](https://www.loseii.com/loa-crafting-calculator/) — every craft ranked by net gold, gold/hr, ROI
- [Deal Finder](https://www.loseii.com/loa-deal-finder/) — market items ranked vs a robust 14-day fair price
- [GPD Chart](https://www.loseii.com/loa-gpd/) — every progression system priced per 1% damage on one scale, support and DPS, with a character lookup
- [Hell Key Calculator](https://www.loseii.com/loa-hell-key-calc/) — Paradise Hell key EV, middle-jump strategy, altar verdict, season projection
- [LOA ON Bingo](https://loa-on-bingo.shizukaziye.workers.dev/) — live multiplayer watch-party bingo (own repo)
- [LOA ON 2026 Summer](https://www.loseii.com/loa-on-2026-summer/) — showcase recap

**League of Legends**
- [Champion Pool Coverage](https://shizukaziye.github.io/lol-pool-coverage/) — analyze your pool vs the live meta (own repo)

**Finance**
- [FIRE Calculator](https://shizukaziye.github.io/fire-calculator/) — FIRE planner with fixed, historical, and Monte-Carlo modes (own repo)

---

Unofficial fan tools — not affiliated with Smilegate, Amazon Games, or Riot Games.
