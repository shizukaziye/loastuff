# Loseii (repo: loastuff)

The site behind **https://www.loseii.com/** — every tool I've built for Lost Ark, League, and personal finance, plus the shared chrome that ties them together.

Cloudflare Pages deploys `main` on every push (no build command, output `/`). The custom domain is `www.loseii.com`; the apex `loseii.com` redirects to it. A branch push also builds a preview at `<branch>.loastuff.pages.dev`.

## Layout

Site-wide:

- `index.html` — the hub landing page (tool cards, character search)
- `nav.js`, `social-bar.js` — shared top nav and social bar; every page loads them from `https://www.loseii.com/`. The nav carries the site's one "Sign in with lostark.bible" control on www.loseii.com pages. Its tool list is a copy of `shared/tools.js`.
- `shared/` — one copy of everything two or more pages load, each by absolute path with a `?v=` pin:
  - `tools.js` — THE tool list (name, url, kind, blurb, keyword, live). `npm run check` fails when nav.js, the hub cards, the "N live tools" pill, the meta description or a tool page's `<title>` disagree with it; `node tools/check-tools.mjs --write` rewrites nav.js's copy.
  - `bible-oauth.js` — the lostark.bible sign-in, one session for the whole site. nav.js loads it on pages that don't; its `OAUTH_V` constant must equal the pages' pin.
  - `favorites.js` — the saved-characters store (`loseii_favs`), shared by both calculators and the hub.
  - `tip.js` — the `data-gloss` tooltip. `class-icon.js` + `class-icons/` — the 29 class glyphs.
  - `tokens.css` — the site's colours and radii as `--lx-*` variables; each page's own stylesheet routes its values through them.
  - Edit one, bump its pin in every page that loads it; `tools/check-shared-pins.mjs` catches a split or a missed bump.
- `_headers`, `_redirects` — Pages config: no-cache rules, old-URL redirects, and the 200 rewrites that serve tool tabs (`/loa-bracelet-calc/advisor`), character profiles (`/NA/<Name>`) and files that moved to `shared/` at their old addresses
- `404.html` — Pages serves it for any path with no file; `favicon.svg` / `favicon.ico` — the site icon
- `profile/` — the character profile app behind `www.loseii.com/<REGION>/<Name>`; it loads the bracelet, astrogem and GPD models from their tool folders, tooltips and class icons from `shared/`, and the astrogem rank from the `astrogem-bible` Worker's `/board-slim`
- `chrome-cache-worker/` — the `loseii-chrome-cache` Worker, which serves `nav.js`, `social-bar.js` and the two `prices.js` files no-cache (the zone caches other `.js` for 4 hours)
- `market/` — the shared market bake, `prices.json` (see [market/README.md](market/README.md))
- `tools/` — repo-wide scripts: `bake-market.py` and `marketlib.py` (market feed + robust price), `check-cross-pins.mjs` (cross-tool `?v=` pin checker), `check-tools.mjs` (the tool list), `check-shared-pins.mjs` (`shared/` pins), `build-dist.mjs` (the optional minified build, below)
- `package.json` — `npm run check` runs every offline check locally; `npm run build` makes the minified copy
- `.github/workflows/` — `refresh-data.yml` (market refresh) and `checks.yml` (CI checks)
- `docs/` — [ARCHITECTURE.md](docs/ARCHITECTURE.md) (the site's moving parts on one page) and `design/PROFILE-GAMEPLAN.md`; each tool keeps its own `docs/`
- `og.png` — the link-preview image the hub's `og:image` names

Tools (each folder is served at `/<folder>/`):

- `lost-ark-accessories/` — Accessory Value Calculator
- `loa-astrogem-calc/` — Astrogem Calculator (grader, pipeline, advisor, leaderboard), with its three Workers under `worker/`
- `loa-bracelet-calc/` — Bracelet Calculator (calculator, advisor, tier list, leaderboard), with its Worker under `worker/`
- `loa-gpd/` — GPD Chart; no Worker of its own, it calls the astrogem and bracelet Workers
- `loa-crafting-calculator/` — Stronghold Crafting Profit
- `loa-deal-finder/` — Deal Finder
- `loa-hell-key-calc/` — Hell Key Calculator
- `loa-on-2026-summer/` — LOA ON 2026 Summer recap
- `loa-tierlist/` — retired; redirect stub

## Market prices

Four tools price items from the loa-buddy market feed. Every 6 hours `refresh-data.yml`:

1. runs `tools/bake-market.py`, which fetches spot and 14-day history once per region (`nae`, `euc`) for every item any tool prices and writes `market/prices.json`;
2. runs `loa-hell-key-calc/fetch_prices.py` and `loa-gpd/fetch_prices.py`, which turn that file into each tool's `prices.js`;
3. commits whatever changed, which redeploys the site.

The deal finder and the crafting calculator fetch `../market/prices.json` when the page loads. The prices baked into their `index.html` are only a fallback for when that fetch fails; CI no longer rewrites them (`refresh_deals.py` and `refresh_prices.py` do, by hand).

Each step can fail on its own without blocking the others. A bake that sees a dead or thin feed keeps the old file and exits 1; the job goes red only when every step failed.

## Checks

`.github/workflows/checks.yml` runs on every push and PR, and `npm run check` runs the same list locally:

- `tools/check-tools.mjs` — fails when nav.js, the hub or a tool page's `<title>` disagrees with `shared/tools.js`
- `tools/check-shared-pins.mjs` — fails when two pages load a `shared/` file at different pins, a pin names a missing file, nav.js's `OAUTH_V` differs from theirs, or a `shared/` file changed and its pin did not
- `tools/check-cross-pins.mjs` — fails when a file that another tool pins with `?v=` changed and the pin did not
- `loa-bracelet-calc`: `npm ci && npm run check` (JS and Python model parity, worker tests, its own pin checker)
- `loa-astrogem-calc`: `tools/lint-pins.js` and `verify.py`
- `loa-gpd`: `tools/verify.js`
- `verify.py` in the crafting and hell key tools, and the `tools/marketlib.py` self-test

Not run in CI: the astrogem `npm run eval-gate` (its OCR corpus lives only on the desktop PC) and anything that needs a deployed Worker.

## Deploy

A push to `main` deploys the site only. **Worker edits ride the push but do not deploy**; run `npx wrangler deploy` for each Worker you touched (`npx.cmd` from PowerShell):

| Worker | From | Command |
|---|---|---|
| `astrogem-bible` | `loa-astrogem-calc/worker` | `npx wrangler deploy --config wrangler.bible.toml` |
| `astrogem-data` | `loa-astrogem-calc/worker` | `npx wrangler deploy -c wrangler-data.toml` |
| `astrogem-verify` | `loa-astrogem-calc/worker` | `npx wrangler deploy -c wrangler-verify.toml` |
| `bracelet-bible` | `loa-bracelet-calc/worker` | `npx wrangler deploy` |
| `loseii-chrome-cache` | repo root | `npx wrangler deploy -c chrome-cache-worker/wrangler.toml` |

The zone caches `.js` for 4 hours and `_headers` cannot override that, so bump a script's `?v=` pin wherever it is loaded whenever it changes, including pins in other tools' files (`npm run check` catches the misses).

## Local dev

Serve the whole site, not one tool folder: `npx wrangler pages dev . --port 8788` from the repo root. It honours `_redirects` and `_headers`, and it serves `/shared/`, which every tool now loads by absolute path; a tool's own `npm run serve` (one folder on port 8080) cannot, so sign-in, favorites, tooltips and class icons break there. Pages load nav.js from `https://www.loseii.com/`, so a local nav.js change shows only once pushed (or injected by hand). A real lostark.bible sign-in round trip also needs `http://localhost:8080/`, the only address the dev OAuth client accepts.

## Minified deploy (ready, not switched on)

Pages serves the repo as it stands: no build command, output `/`. `npm run build` (`tools/build-dist.mjs`) makes a copy in `dist/` with comments and spare whitespace stripped from every `.js` (terser) and `.css` (csso). It renames nothing, so every path and `?v=` pin still names the same file. It leaves out worker source, `node_modules`, `samples/`, `data/cells`, `.cache` and `docs/` (except `loa-gpd/docs/METHODOLOGY.md`, which the chart links to), then checks that every `.js` in `dist/` still parses and fails the build if one does not. `npm run check-dist` runs the check alone.

To switch it on: Cloudflare dashboard → Workers & Pages → `loastuff` → Settings → Build → set **Build command** `npm run build` and **Build output directory** `dist`, then push (or retry the last deploy). To switch it off, clear the build command and set the output back to `/`. Keep `_headers` and `_redirects` at the repo root: the build copies them into `dist/`.

## Tools

**Lost Ark**
- [Character Profiles](https://www.loseii.com/#find) — any NA or EU character at `/NA/Name`: bracelet and astrogem grades, board ranks
- [Accessory Value Calculator](https://www.loseii.com/lost-ark-accessories/) — score any accessory by its real % damage gain
- [Astrogem Calculator](https://www.loseii.com/loa-astrogem-calc/) — cut/fuse/throw pipeline tables, screenshot advisor, leaderboard
- [Bracelet Calculator](https://www.loseii.com/loa-bracelet-calc/) — score bracelets in % damage and solve the reroll decision
- [Stronghold Crafting Profit](https://www.loseii.com/loa-crafting-calculator/) — every craft ranked by net gold, gold/hr, ROI
- [Deal Finder](https://www.loseii.com/loa-deal-finder/) — market items ranked vs a robust 14-day fair price
- [GPD Chart](https://www.loseii.com/loa-gpd/) — every progression system priced per 1% damage on one scale, support and DPS, with a character lookup
- [Hell Key Calculator](https://www.loseii.com/loa-hell-key-calc/) — Paradise Hell key EV, middle-jump strategy, altar verdict, season projection
- [LOA ON Bingo](https://loa-on-bingo.shizukaziye.workers.dev/) — live multiplayer watch-party bingo (own repo)
- [LOA ON 2026 Summer](https://www.loseii.com/loa-on-2026-summer/) — showcase recap (a page, not a tool: the hub's count leaves it out)

**League of Legends**
- [Champion Pool Coverage](https://shizukaziye.github.io/lol-pool-coverage/) — analyze your pool vs the live meta (own repo)

**Finance**
- [FIRE Calculator](https://shizukaziye.github.io/fire-calculator/) — FIRE planner with fixed, historical, and Monte-Carlo modes (own repo)

---

Unofficial fan tools — not affiliated with Smilegate, Amazon Games, or Riot Games.
