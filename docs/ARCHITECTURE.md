# How www.loseii.com fits together

One page on the site's moving parts. The ops detail (traps, deploy commands,
secrets) lives in the loseii-site skill and the [README](../README.md).

## The parts

**Pages tree.** Cloudflare Pages serves this repo as it stands on `main`: no
build command, output `/`, live 12–30 s after a push. Every tool is a folder
served at `/<folder>/` with relative asset paths. `_redirects` adds the 200
rewrites for tool tabs (`/loa-bracelet-calc/advisor`) and profiles
(`/NA/<Name>` → `/profile/`); `_headers` marks the files that change without a
pin as no-cache. `404.html` answers any path with no file. `npm run build`
makes a minified `dist/`, but Pages does not use it until the dashboard's
build command is set (README, "Minified deploy").

**`/shared/`.** One copy of each file that two or more pages load, each by
absolute path with a `?v=` pin:

| File | What it does |
|---|---|
| `bible-oauth.js` | the lostark.bible sign-in; one session for the site (`loseii_bible_oauth`) |
| `favorites.js` | saved characters (`loseii_favs`) |
| `tip.js` | `data-gloss` tooltips |
| `class-icon.js`, `class-icons/` | 29 class glyphs, `window.classIconUrl(name)` |
| `tokens.css` | `--lx-*` colours and radii |
| `tools.js` | the tool list that nav.js, the hub and page titles must match |

**Chrome.** Every page ends with `nav.js` and `social-bar.js` from
`https://www.loseii.com/`. Both draw into a shadow root. The nav holds the
site's only sign-in control and loads `/shared/bible-oauth.js` itself on pages
that lack it.

**Workers.** A push deploys none of them; each needs its own `wrangler deploy`.

| Worker | Serves |
|---|---|
| `astrogem-bible` | lostark.bible character pulls, the pull queue and its drain, the astrogem board (`?list=1`) and the slim rank index (`/board-slim`), admin |
| `astrogem-data` | `/collect` (the advisor's screenshot records, kept 30 days) and `/admin/accuracy` |
| `astrogem-verify` | the Workers-AI field checker for the advisor's reader |
| `bracelet-bible` | bracelet pulls and the bracelet board |
| `loseii-chrome-cache` | `nav.js`, `social-bar.js` and the two `prices.js` files, no-cache, on the `loseii.com` zone (which caches other `.js` for 4 h) |

**CI bakes.** `refresh-data.yml` runs every 6 hours: `tools/bake-market.py`
writes `market/prices.json`, then the hell key and GPD scripts turn it into
their `prices.js`, and the job commits what changed, which redeploys the site.
The deal finder and crafting calculator read `market/prices.json` at load.

**Checkers.** `checks.yml` runs on every push and PR; `npm run check` runs the
same list locally. `check-tools` (tool list), `check-shared-pins` (`/shared/`
pins agree and move), `check-cross-pins` (pins one tool holds on another's
files), then each tool's own suite. The README's "Checks" section says what
each one catches.

## One profile page load

`www.loseii.com/NA/<Name>`:

```
browser
  |
  |-- GET /NA/<Name> ---------------------> Pages  (_redirects 200 -> /profile/)
  |     /profile/*.js, /shared/*.js,
  |     /loa-gpd/lookup.js, models -------> Pages  (zone caches .js 4 h; ?v= pins)
  |
  |-- GET /nav.js, /social-bar.js --------> loseii-chrome-cache worker -> Pages
  |     (nav.js then loads /shared/bible-oauth.js?v=OAUTH_V from Pages)
  |
  |-- astrogem rank: GET /board-slim?region=NA
  |                   --------------------> astrogem-bible worker  (KV lb:slim:gz:NA)
  |
  |-- bracelet grade + board -------------> bracelet-bible worker
  |
  |-- prices: GET /market/prices.json ----> Pages  (no-cache; baked by refresh-data.yml)
```

Only the three worker hops leave Pages. The workers answer CORS for
`www.loseii.com`, `loastuff.pages.dev` and branch previews, so a preview at
`<branch>.loastuff.pages.dev` loads the same way; `astrogem-data` is the
exception and takes only the loseii hosts and two localhost ports.
