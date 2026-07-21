# Lost Ark Deal Finder

A single self-contained `index.html` (no build, no deps) that ranks every market item
by how far its **current spot** sits below or above a robust **14-day fair price** —
so you can check, anywhere, what's cheap to buy right now. Companion to the
[stronghold crafting calculator](https://shizukaziye.github.io/loa-crafting-calculator/);
shares its fair-price model.

## Use it

- **Default view = "Liquid"** — the items actually worth shopping for: gathering mats,
  fusion mats, honing mats, and cooking/craft items that trade with a clean history.
- **Everything** — one click to see all ~193 items the API tracks.
- **Type chips** (Mats / Honing / Fusion / Cooking), **Region** (NA East / EU Central),
  and a **Min value** filter to hide trivial low-gold items.
- Sorted **best deal first** (cheapest vs fair); green = below fair (a buy), red = above.
  Click any column to re-sort. Hover a sparkline to read a specific day's price.
- The page remembers your settings locally; mobile-friendly.

## Fair price & "liquid"

```
fair = robust 14-day average  (drop today's live day, drop the top/bottom couple of
       completed days, recency-weighted mean of the rest)
deal = (spot - fair) / fair    (negative = below fair = a buy)
```

The market API has **no trade-volume data**, so we work out which items are "liquid": an
item is in the default view only if it's a real **material / honing / fusion / cooking**
item (we hide engraving recipes, consumables, baubles), it has a full recent price
history, and its spot isn't a blown-out outlier vs fair (so one troll listing isn't
mistaken for a deal). We don't label per-unit vs per-stack for every item, but the
**deal %** is unit-independent.

## Data & refresh

A GitHub Action bakes prices into `index.html` as a snapshot and **refreshes them every 6
hours** (`refresh_deals.py`, both regions). To refresh locally: `python3
refresh_deals.py` then reload.

## Deploy

```
git add -A && git commit -m "Lost Ark deal finder"
gh repo create <user>/loa-deal-finder --public --source=. --push
gh api -X POST repos/<user>/loa-deal-finder/pages -f source.branch=main -f source.path=/
```
Data comes from the same community market feed loa-buddy uses.
