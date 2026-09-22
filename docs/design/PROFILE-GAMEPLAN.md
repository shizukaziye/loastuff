# Loseii character profiles — gameplan

Shizu, 2026-09-22: a loseii profile page per character with the bracelet and
astrogem facts that matter and one-click links into both calculators; tool
tabs get real URLs (`/loa-bracelet-calc/advisor`); every click and swap snappy;
modeled on op.gg and lostark.bible profiles for WHAT is reachable — our UI and
theme stay; a version is presented before anything is pushed.

## 0. What already exists (checked, not assumed)

- **bracelet-bible worker.** `GET /character?region&name` returns the whole
  record: class, item level, grade, traits, lines, rolls left, damage %, every
  loadout (label, lines, `rawStats`, the derived `profile` the calculators
  import), `scoredAt`. `GET /list` is the scored board (rank order per
  region). `GET /wait` long-polls a fresh pull. `/status`, `/feedback`. CORS
  already admits loseii. The pull rate of at most one profile per 3 s is
  enforced there.
- **astrogem-bible worker.** `GET /?region&name` → `{gems, pulledAt, cached}`.
  `GET /?list=1&fmt=2` → the tuple snapshot the astrogem board scores in the
  browser with `loa-astrogem-calc/model/astrogem.js` (`rankFromGrade`). Same
  origin as the profile page, so no CORS work.
- **Tabs today.** Both tools switch with `selectTab(name)` in `index.html`:
  class toggles plus a lazy module load. No URL sync; Back does nothing.
- **Site.** Cloudflare Pages, static; `_redirects` holds two 301s; no Pages
  Functions yet; `_headers` has no-cache rules; the zone caches `.js` 4 h, so
  every script is pinned.
- **Data rules.** Raid stats are banned. OAuth rosters exist only for the
  signed-in user. Nothing here changes either.

## 1. URLs

| what | URL | notes |
|---|---|---|
| profile | `/NA/Paroxysmal` | Shizu, 2026-09-22: no prefix at all. Regions NA, EU, CE; KR rows keep their lopec.kr link |
| bracelet tabs | `/loa-bracelet-calc/{calculator,advisor,tier-list,leaderboard,method,feedback}` | bare `/loa-bracelet-calc/` = calculator |
| astrogem tabs | `/loa-astrogem-calc/{grader,pipeline,advisor,leaderboard,feedback}` | same mechanism |
| a character inside a tool | `?c=NA:Paroxysmal` on any tool URL | a query keeps relative asset paths working; `/loa-bracelet-calc/advisor?c=NA:Paroxysmal` opens the Advisor on that bracelet |

Rewrites in `_redirects`: one `200` rule per exact tab path (plus 301s from
the trailing-slash forms), and `/NA/*`, `/EU/*`, `/CE/*` → `/profile/index.html`
`200`. Profile assets live at `/profile/`, never under a region path, so no
rewrite can shadow a static file.

## 2. Snappy — the rules every phase is held to

- A tab swap is a class toggle plus `pushState`. No fetch, no reload;
  `popstate` reverses it. Budget: under 16 ms.
- A tab's scripts prefetch on hover or focus of its button, so the first
  activation is as fast as the second.
- The profile page paints its skeleton from the HTML at once, then runs its
  fetches in parallel: bracelet `/character`, astrogem `/`, and the region's
  board for rank. The last copy seen is kept in localStorage and shown
  instantly while the fetch revalidates (op.gg's "Update", done for you).
  Budget: under 300 ms warm, 1.5 s cold.
- Crossing into a tool costs no worker trip: the profile stashes the record
  under a shared key and the tool boots from it. Names on both boards
  prefetch their profile data on hover.
- "Update" runs `queue=1&refresh=1` and follows `/wait` with a progress line;
  a cooldown reads off `pulledAt`.
- No layout shift: skeletons are the real sizes.

## 3. The profile page, v1

**Search** at the top like op.gg: region selector, name, recent searches,
favorites.

**Header.** Class icon, name, region, item level, class. "Pulled 2 h ago" with
an Update button. Favorite star. Share (copies the link).

**Rank strip.** Bracelet: letter, 0–100 score, damage %, `#N of M on NA`, top
X %. Astrogem: letter, score, rank the same way. Each links to its board,
scrolled to the row.

**Bracelet card.** Lines (name · tier word · %), traits, rolls left, best
loadout, total %. Buttons: *Open in Calculator* · *Lock advice* (Advisor),
both `?c=` deep links.

**Astrogem card.** Cores, gem count by grade, score, letter — scored in the
browser with the astrogem model on the record's gems, exactly as the astrogem
board does. Button: *Open in Astrogem Calculator* (`?c=`; the astrogem grader
gains the same parameter in Phase 1).

**Stats card.** What the calculators assume for this character, from
`rawStats`/`profile`: item level, main stat, weapon power, attack power,
crit/spec/swift, gems, karma. The "Import Character Stats" facts, visible.

**Added after the first preview (Shizu, 2026-09-22):** a **GPD card** — the
GPD chart's character lookup, on the profile: every system's current rung and
its next step's gold per 1%, cheapest first, on the role's axis, with a third
rank-strip tile ("Cheapest next 1%") and *Open in GPD chart* (`/loa-gpd/?c=`);
the **astrogem card becomes a full section** — a per-gem table (core, order or
chaos, willpower, effects with levels, grade, value) with a per-core summary,
scored with the astrogem model, mirroring the grader's table; and **tooltips
on every figure**: the figure states, the hover explains.

**Not in v1** (v2 list): roster — the record holds none; history over time —
needs per-pull snapshots in KV; compare two characters; per-character Discord
embeds (needs a server render, see Phase 3).

## 4. What op.gg and bible have, and what we do with it

Mirror: a URL by region and name; search with a region selector, recents and
favorites; an Update button with a timestamp; rank badges up top; one card
per system with a deep link into the tool; share/copy; names on boards that
open profiles.

Skip: match or raid history (banned, and no data), live game, multi-search,
ads.

## 5. Phases

Each phase ships only behind a green check; nothing is pushed until Shizu
has seen a version.

**Phase 0 — spikes (half a session).** Does a `200` rewrite beat a static
file on Pages? (Preview deploy.) `wrangler pages dev` for local work — it
honors `_redirects`, `_headers` and Functions, which the python server does
not. One astrogem tuple row → score, letter, rank for one character. Cache
headers on `/character` so hover prefetch is worth it.

**Phase 1 — routes (one session).** `selectTab` gains `pushState`,
`popstate` and boot-from-path; `?c=` boots a character (the bracelet import
path exists; astrogem gets one); hover prefetch; `_redirects` rules; nav and
hub links point at real tab URLs. Safe to ship on its own.

**Phase 2 — the profile page (two to three sessions, Opus agents).** The
`/profile/` app: HTML, CSS, JS, house theme, no build. Search, header, rank
strip, the three cards, caching and skeletons. Boards link names to profiles.
Hub gains a search box and a card. Update via `/wait`.

**Phase 3 — polish (one session).** Per-character Discord embeds through a
Pages Function at `/character/*` that fills the og tags from the record.
Search in the shared nav. Percentiles. Keyboard navigation.

**Phase 4 — later.** Roster, history, compare.

## 6. How the version gets presented

Built on a branch of loastuff (`profile`), run locally with `wrangler pages
dev`, walked through in the browser pane with screenshots. Alternative: push
the branch only — Cloudflare Pages deploys it as a preview at
`profile.loastuff.pages.dev`, www untouched — so it can be clicked on a phone.

## 7. Decisions (Shizu, 2026-09-22)

1. Profile URL: `/NA/Name` — shorter than proposed; no prefix.
2. Presentation: the preview branch (`profile`), pushed on its own; www untouched.
3. Astrogem card: score, letter, rank and gem counts by grade.
4. Boards: the name opens the profile; a row click still loads the grader.
5. "No reloads", like lostark.bible: inside a tool and inside the profile,
   navigation is a class toggle plus `pushState` (true single-page). The
   crossings between apps stay separate documents but are PRERENDERED on hover
   (speculation rules, eagerness moderate) so the swap is instant in Chromium;
   other browsers prefetch the HTML and boot from cache. Pages gate side
   effects (pulls, `/wait`, the handoff bounce, sign-in) behind
   `document.prerendering`. Back/Forward restores from the bfcache. A single
   shell that keeps every tool alive stays an option if the remaining wish is
   "the calculator is exactly where I left it when I come back".

## 8. Debts to settle before v2

- The profile's astrogem worker repeats two one-line mixes of model functions
  that grader.js also spells out (for example gem damage minus the order
  score at 4.25). Not copied code, but a second place that must move when the
  grader's formula moves — the astrogem model should export a per-gem value
  and a grid summary so both call one function.
- The GPD module (`loa-gpd/lookup.js`) keeps the chart's caches on the context
  it is handed and fills the lookup record in place; the chart relied on both.
  Pure would be nicer; identical output came first.
- The astrogem model's comment puts the DPS S+ cut at 96.7 while its function
  gives 96.1; the pages use the function. Fix the comment or the cut.
- Per-line bracelet damage is not shown on the profile: the board row has
  none and the record's stored figure comes from an older model. Either the
  worker stores it at the current model or the profile scores the lines.

## 9. Risks

- Rewrite-versus-asset precedence (Phase 0 answers it before anything is
  built on it).
- Scoring astrogems on the profile loads the astrogem model — the same static
  files the grader loads, cached; acceptable.
- Every profile view is one KV read per worker; the browser caches it and the
  page keeps the last copy, so repeat views cost nothing.
- Two workers are two failure modes; the page degrades one card at a time,
  never as a whole.
- The only data shown is what the boards already show; no raid stats.
