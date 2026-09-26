#!/usr/bin/env python3
"""Refresh the FALLBACK price snapshot baked inside index.html.

The page reads live prices from /market/prices.json (baked every 6 hours by
tools/bake-market.py) and only falls back to the `const SNAPSHOT` baked here
when that fetch fails. CI no longer rewrites this fallback; run this by hand now
and then so the fallback is not months old.

For every item (both regions) the snapshot records:
  s = spot          — current lowest listing (distorts when a market is bought out)
  h = [avg, ...]     — up to 14 daily AVERAGE prices, newest-first

The app turns `h` into a robust "fair" price = trimmed, recency-weighted mean
(drop the N highest & N lowest days, then weight the rest 1, d, d^2, ... by
recency) — with the trim count and decay `d` adjustable live in the page.

Data comes from the shared bake when bake-market.py confirmed it within the last
few hours, otherwise straight from the feed through tools/marketlib.py. Besides
SNAP_TS (write time) it bakes DATA_TS / DATA_DAY — the newest row timestamp and
history day the API returned. Rather than bake degraded data it exits 1 when any
known item lacks a spot price or too many histories come back empty.

    python3 refresh_prices.py            # shared bake if fresh, else the feed
    python3 refresh_prices.py --live     # always the feed
"""
import json, pathlib, re, sys, time

HTML = pathlib.Path(__file__).with_name("index.html")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
import marketlib  # noqa: E402

src = HTML.read_text(encoding="utf-8")


def grab(name):
    m = re.search(r'^const %s=(.*);\s*$' % name, src, re.M)
    if not m: sys.exit(f"could not find const {name} in index.html")
    return json.loads(m.group(1))


ITEMS = grab("ITEMS")
slugs = sorted({v["slug"] for v in ITEMS.values()})

try:
    market = marketlib.get_market(slugs, live="--live" in sys.argv[1:])
except Exception as e:
    sys.exit(f"market feed failed ({e}) — not baking.")

snap, data_ts, data_day = {}, 0, ""
for region in marketlib.REGIONS:
    mreg = market["regions"][region]
    data_ts = max(data_ts, mreg.get("dataTs") or 0)
    data_day = max(data_day, mreg.get("dataDay") or "")
    items = mreg["items"]
    missing = [s for s in slugs if not (items.get(s) or {}).get("spot")]
    if missing:   # the slug set is fixed — a missing/zero spot would bake a bogus "-100%" price
        sys.exit(f"  {region}: no spot price for {len(missing)} known item(s): {', '.join(missing)} — not baking.")
    snap[region], empty = {}, 0
    for slug in slugs:
        h = [round(p) for _, p in items[slug]["history"]]
        if not h: empty += 1
        snap[region][slug] = {"s": items[slug]["spot"], "h": h}
    if empty > 0.2 * len(slugs):   # tolerate a few flaky items, refuse a degraded bake
        sys.exit(f"  {region}: {empty} of {len(slugs)} items came back with empty history — not baking.")
    print(f"  {region}: {len(snap[region])} items (spot + up to {marketlib.HIST_DAYS}d history)"
          + (f", {empty} empty histories" if empty else ""))

if snap == grab("SNAPSHOT") and data_ts == grab("DATA_TS") and data_day == grab("DATA_DAY"):
    print("Prices and data stamps unchanged since last snapshot — nothing to write.")
    sys.exit(0)

ts = int(time.time())
# function replacements: raw JSON is not safe as a re.sub template (\u would crash, backslashes corrupt)
src = re.sub(r'^const SNAPSHOT=.*;\s*$',
             lambda m: "const SNAPSHOT=" + json.dumps(snap, separators=(',', ':')) + ";", src, count=1, flags=re.M)
src = re.sub(r'^const SNAP_TS=.*;\s*$', lambda m: f"const SNAP_TS={ts};", src, count=1, flags=re.M)
src = re.sub(r'^const DATA_TS=.*;\s*$', lambda m: f"const DATA_TS={data_ts};", src, count=1, flags=re.M)
src = re.sub(r'^const DATA_DAY=.*;\s*$', lambda m: "const DATA_DAY=" + json.dumps(data_day) + ";", src, count=1, flags=re.M)
HTML.write_text(src, encoding="utf-8")
print(f"Updated the fallback snapshot in {HTML.name} @ {time.strftime('%Y-%m-%d %H:%M', time.localtime(ts))} — data through {data_day or 'unknown'}.")
