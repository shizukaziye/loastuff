# Lost Ark Stronghold Crafting — Profit Calculator

A single self-contained `index.html` (no build, no dependencies) that ranks every
stronghold craft by **net gold per craft**, **per hour**, and **ROI** under current
market prices. It's a faithful port of [loa-buddy.pages.dev](https://loa-buddy.pages.dev)'s
verified profit engine, plus **two cooking meals loa-buddy doesn't have**:
*Virtuoso's Striploin Steak Meal* and *Specialist's Beef Tenderloin Steak Meal*.

## Use it

Open `index.html` in a browser (or `python3 -m http.server` in this folder). Then:

- **Crafting Reductions** — pre-filled from a typical stronghold (General 7/10/5,
  Special 10/0/9). Edit to match yours; General stacks onto the category column.
- **Region** — NA East / EU Central (the two the market feed covers).
- **Great Success** — on by default; it doubles a craft's output `GSC%` of the time,
  so expected yield is `qty × (1 + GSC/100)`. Toggle off for worst-case.
- **Click any row** for the full material breakdown (and, for fusion mats, which
  gathering path is cheapest) — including a **good-to-buy** read on each input, a
  **sell-now** read on the output, and a **yest-vs-fair** column/line showing which
  recent price move is driving the craft (an input below fair = cheaper lately).
  **Click any material** in the breakdown to open its own price detail (same read).
- **Prices** are editable. Set a mat's price toward 0 to model farming it yourself.
- **Sparklines** show each item's 14-day trend; hover one to highlight a day and read its price.
- **Your settings stick** — the page remembers region, pricing basis, decay/trim, and reductions across reloads (saved locally; prices stay snapshot-driven).
- **Price watch** (bottom of the page), split into **craftable outputs** (you sell) and
  **materials** (you buy), flags items whose yesterday's avg or live spot is ≥15% off the
  fair (robust) price, judges whether the **current spot is a good buy/sell**, and shows
  where it sits in the 14-day range — with fair, yesterday's avg, live spot, and the full
  history (today → oldest).

## Live price sync (optional)

Prices ship as a baked snapshot. For one-click live refresh, the page needs a CORS
proxy because the market API only answers loa-buddy's own domain:

1. Deploy `worker.js` as a free Cloudflare Worker (dash.cloudflare.com → Workers → Create).
2. Paste your worker URL (ending `/v1/prices/latest`) into the **Proxy URL** field.
3. Hit **Sync live prices**. The URL is remembered locally.

**No-cloud refresh (recommended if you don't want a worker):** run
`python3 refresh_prices.py` — it pulls current prices for every item (both regions)
and rewrites the baked snapshot in `index.html` in place. Reload the page and
you're current. The browser can't call the market API directly (CORS), but this
script (server-side) can, so it's 100% reliable with zero setup.

You can also just edit any price cell in the page by hand.

> **Open it over http, not `file://`.** Double-clicking the file works, but some
> browsers restrict `localStorage` on `file://`. Easiest is the hosted version
> (below) or `python3 -m http.server` in this folder, then open `localhost:8000`.

## The math

```
adjustedGold = floor( craftingCost × (1 − (general.cost + category.cost)/100) )
adjustedTime = craftingTime × (1 − (general.time + category.time)/100)
GSC          = enabled ? 5 × (1 + (general.GS + category.GS)/100) : 0
EY           = baseQuantity × (1 + GSC/100)
materialCost = Σ qty × (marketPrice / bundleSize)     # cheapest gathering path auto-picked
tax          = sellPrice ≤ 1 ? 0 : ceil(sellPrice × 0.05)   # 5%, rounded up
netProfit    = EY × (sellPrice − tax) − (materialCost + adjustedGold)
```

`verify.py` re-implements this in Python, reads the recipe/price data straight out
of `index.html`, and asserts it reproduces reference values captured from the
shipped browser code — run it after any edit to catch JS/Python drift:

```
python3 verify.py
```

## Notes & caveats

- **Pricing:** every item carries a current *spot* (lowest listing) and **14 days
  of daily averages**. The default **robust** price **excludes the current (live)
  day**, then drops the highest & lowest few of the completed days and takes a
  *recency-weighted* mean of the rest (newest completed day ×1, each older
  day ×`decay`) — so it tracks real moves but a bought-out spike (or a lowball)
  can't sway it. The window/weights are tunable live in the page (**drop hi/lo** and
  **recency decay**; defaults: drop 2 each, decay 0.90 ≈ "halves ~6.6 days back").
  The breakdown flags any item whose spot is ≥15% off its robust price (⚠). Toggle
  **Pricing → Spot** for live lowest prices. `refresh_prices.py` bakes the daily
  history; the app computes the robust value client-side so the knobs are instant.
- **Craft times:** Virtuoso's Striploin is set to ~49 min (your in-game figure);
  Specialist's Beef is still an assumed 60 min (marked `*`) — per-hour only.
- Mats are valued at **market price** (true opportunity cost); zero one out to
  model farming it yourself.
- To add a recipe, append an object to the `RECIPES` array in `index.html`
  (`id, name, type, craftingCost, quantity, craftingTime, materialOptions`) and add
  any new item ids to `ITEMS` with their `slug`/`bundle`.

## Deploy to GitHub Pages

**Fastest, no tooling** — since the site is one file:
1. Create a new public repo on github.com (such as `loa-crafting-calculator`).
2. "Add file → Upload files", drag in `index.html`, commit.
3. Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.
4. Live at `https://<user>.github.io/loa-crafting-calculator/` in ~1 min.

**With the CLI** (after `gh auth login` / a token is set up):
```
git add -A && git commit -m "Lost Ark crafting profit calculator"
gh repo create <user>/loa-crafting-calculator --public --source=. --push
gh api -X POST repos/<user>/loa-crafting-calculator/pages -f source.branch=main -f source.path=/
```
This repo is already `git init`'d and committed, so you can skip straight to the
`gh repo create` step once authenticated.

Price data comes from the same community market feed loa-buddy uses.
