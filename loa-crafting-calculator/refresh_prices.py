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
    return {row["item_slug"]: row["price"] for row in json.loads(out)}

END   = datetime.date.today()
START = END - datetime.timedelta(days=HIST_WINDOW + 6)   # cushion for missing days
def fetch_hist(region, slug):
    url = f"{BASE}/prices/historical/{region}/{slug}?start_date={START}&end_date={END}"
    try:
        days = json.loads(subprocess.check_output(["curl","-s",url], timeout=30))   # oldest -> newest
        avgs = [round(d["avg_price"]) for d in days if d.get("avg_price") is not None]
        return list(reversed(avgs))[:HIST_WINDOW]                                    # newest -> oldest
    except Exception:
        return []

snap = {}
for region in ("nae", "euc"):
    spot = fetch_spot(region)
    snap[region] = {}
    for slug in slugs:
        snap[region][slug] = {"s": spot.get(slug, 0), "h": fetch_hist(region, slug)}
    print(f"  {region}: {len(snap[region])} items (spot + up to {HIST_WINDOW}d history)")

if snap == grab("SNAPSHOT"):
    print("Prices unchanged since last snapshot — nothing to write.")
    sys.exit(0)

ts = int(time.time())
src = re.sub(r'^const SNAPSHOT=.*;\s*$',
             "const SNAPSHOT=" + json.dumps(snap, separators=(',', ':')) + ";", src, count=1, flags=re.M)
src = re.sub(r'^const SNAP_TS=.*;\s*$', f"const SNAP_TS={ts};", src, count=1, flags=re.M)
HTML.write_text(src)
print(f"Updated snapshot in {HTML.name} @ {time.strftime('%Y-%m-%d %H:%M', time.localtime(ts))}. Reload the page.")
