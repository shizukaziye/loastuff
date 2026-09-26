# /market — the shared market bake

`prices.json` holds Lost Ark market prices for every item any loseii tool
prices, both regions, fetched once per refresh run from the loa-buddy feed
(`https://marketdata-api.yrzhao1068589.workers.dev/v1`).

- Written by `tools/bake-market.py` (maths and HTTP in `tools/marketlib.py`),
  every 6 hours by `.github/workflows/refresh-data.yml`.
- Read at runtime by the deal finder and the crafting calculator
  (`fetch('../market/prices.json', {cache: 'no-cache'})`); each keeps its old
  baked constant only as a fallback for when that fetch fails.
- Read at bake time by `loa-hell-key-calc/fetch_prices.py` and
  `loa-gpd/fetch_prices.py`, which turn it into their `prices.js`.
- Served no-cache (`_headers`), so a new bake shows up on the next page load.

## Schema (v1)

```jsonc
{
  "v": 1,                        // schema version
  "bakedAt": 1790380148,         // unix seconds when this file was written
  "source": "https://marketdata-api.yrzhao1068589.workers.dev/v1",
  "robust": {"trim": 2, "decay": 0.9, "minDays": 5},   // settings behind each item's "robust"
  "regions": {
    "nae": {                     // "nae" (NA East) and "euc" (EU Central) — the only two the feed has
      "dataTs": 1790377809,      // newest /latest row timestamp (unix s): when the feed's data last moved
      "dataDay": "2026-09-25",   // newest history day (UTC); history[0] is this day
      "items": {
        "abidos-fusion-material": {          // key = the feed's item slug, which every tool keys by
          "spot": 107,                       // live lowest listing, gold per market BUNDLE; null if none
          "robust": 114.54,                  // robust fair price (below); null under minDays completed days
          "history": [[1790294400, 104.72],  // [day at 00:00 UTC in unix s, that day's average price]
                      [1790208000, 105.39]]  // newest-first, up to 14 days; [0] is today, still open
        }
      }
    },
    "euc": { "...": "same shape" }
  }
}
```

Prices are per market bundle, as the feed gives them: raw gathered mats come
in bundles of 100, crafted items in bundles of 1. Numbers carry at most two
decimals and are written as integers when whole.

An item is left out when the feed has neither a spot price nor any history
for it in that region. The file is written one item per line so git diffs stay
readable.

**Robust price** (`marketlib.robust`, the same maths as the pages'
`robustPrice()`): drop today's still-open day, drop the `trim` highest and
`trim` lowest completed days, then take a recency-weighted mean — newest
completed day ×1, each older day ×`decay`. The pages recompute it from
`history` with the user's own trim/decay knobs; the stored value is for the
Python bakes.

## Guards

`bake-market.py` leaves `prices.json` untouched and exits 1 when the feed
fails, when a region prices fewer than 180 items, or when more than 20% of
priced items come back with no history. When nothing changed it leaves the
file alone, so an idle feed makes no commit.

It also writes `market/.verified` (gitignored) on every good run. The
per-tool bakes use `prices.json` only while that stamp is under three hours
old; otherwise they fetch the feed themselves, so they still work when run on
their own.

## Item set

The union of what the tools already list: the deal finder's baked `DEALS`,
the crafting calculator's `ITEMS`, and the `SLUGS` lists in the hell-key and
GPD `fetch_prices.py`. To price a new item, add it to one of those.
