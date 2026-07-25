#!/usr/bin/env python3
"""Refresh the baked price snapshot inside index.html — no cloud, no proxy.

For every item (both regions) this records:
  s = spot          — current lowest listing (distorts when a market is bought out)
  h = [avg, ...]     — up to 14 daily AVERAGE prices, newest-first

The app turns `h` into a robust "fair" price = trimmed, recency-weighted mean
(drop the N highest & N lowest days, then weight the rest 1, d, d^2, ... by
recency) — with the trim count and decay `d` adjustable live in the page. Spot is
a toggle. The market API works server-side (CORS only blocks browsers), so this
is 100% reliable with zero setup.

Besides SNAP_TS (fetch time) it bakes DATA_TS / DATA_DAY — the newest row
timestamp and history day the API returned — so the page can show the data's
real age. Rather than bake degraded data it exits 1 when any known item lacks
a spot price or too many histories come back empty.

    python3 refresh_prices.py
"""
import json, re, subprocess, sys, time, datetime, pathlib

HTML        = pathlib.Path(__file__).with_name("index.html")
BASE        = "https://marketdata-api.yrzhao1068589.workers.dev/v1"
HIST_WINDOW = 14                 # days of history baked per item (app weights within this)
src         = HTML.read_text()

def grab(name):
    m = re.search(r'^const %s=(.*);\s*$' % name, src, re.M)
    if not m: sys.exit(f"could not find const {name} in index.html")
    return json.loads(m.group(1))

ITEMS = grab("ITEMS")
slugs = sorted({v["slug"] for v in ITEMS.values()})

def fetch_spot(region):
    body = json.dumps({"region_slug": region, "item_slugs": slugs})
    out = subprocess.check_output(
        ["curl","-s","-X","POST",f"{BASE}/prices/latest","-H","Content-Type: application/json","-d",body],
        timeout=40)
    rows = json.loads(out)
    ts = max((row.get("timestamp") or 0 for row in rows), default=0)   # when the data itself last changed
    return {row["item_slug"]: row["price"] for row in rows}, ts

END   = datetime.date.today()
START = END - datetime.timedelta(days=HIST_WINDOW + 6)   # cushion for missing days
data_day = ""                    # newest history day the API returned (UTC), across items & regions
def fetch_hist(region, slug):
    global data_day
    url = f"{BASE}/prices/historical/{region}/{slug}?start_date={START}&end_date={END}"
    try:
        days = json.loads(subprocess.check_output(["curl","-s",url], timeout=30))   # oldest -> newest
        days = [d for d in days if d.get("avg_price") is not None]
        if days: data_day = max(data_day, max(d.get("day","") for d in days))
        return [round(d["avg_price"]) for d in reversed(days)][:HIST_WINDOW]        # newest -> oldest
    except Exception:
        return []

snap, data_ts = {}, 0
for region in ("nae", "euc"):
    spot, rts = fetch_spot(region)
    data_ts = max(data_ts, rts)
    missing = [s for s in slugs if spot.get(s, 0) <= 0]
    if missing:   # the slug set is fixed — a missing/zero spot would bake a bogus "-100%" price
        sys.exit(f"  {region}: no spot price for {len(missing)} known item(s): {', '.join(missing)} — not baking.")
    snap[region] = {}
    empty = 0
    for slug in slugs:
        h = fetch_hist(region, slug)
        if not h: empty += 1
        snap[region][slug] = {"s": spot[slug], "h": h}
    if empty > 0.2 * len(slugs):   # tolerate a few flaky items, refuse a degraded bake
        sys.exit(f"  {region}: {empty} of {len(slugs)} items came back with empty history — not baking.")
    print(f"  {region}: {len(snap[region])} items (spot + up to {HIST_WINDOW}d history)"
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
HTML.write_text(src)
print(f"Updated snapshot in {HTML.name} @ {time.strftime('%Y-%m-%d %H:%M', time.localtime(ts))} — data through {data_day or 'unknown'}. Reload the page.")
