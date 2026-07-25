#!/usr/bin/env python3
"""Refresh the baked market data inside index.html — spot + 14-day history for every
item, both regions. Reuses the item list & categories already embedded in index.html
(so the item set is self-bootstrapping), re-fetches prices server-side (the market API
works fine outside the browser), and rewrites the `const DEALS` / `const DEALS_TS`
lines plus the `const DATA_TS` / `const DATA_DAY` stamps (the newest row timestamp and
history day the API returned — the data's real age, vs DEALS_TS = fetch time). Rather
than bake degraded data it exits 1 when a region prices fewer than MIN_ITEMS items or
too many histories come back empty.

    python3 refresh_deals.py
"""
import json, re, subprocess, sys, time, datetime, pathlib

HTML = pathlib.Path(__file__).with_name("index.html")
BASE = "https://marketdata-api.yrzhao1068589.workers.dev/v1"
MIN_ITEMS = 180        # the self-bootstrapped item list can only shrink — refuse a collapsed bake
src  = HTML.read_text()

def baked(name):
    m = re.search(r'^const %s=(.*);\s*$' % name, src, re.M)
    if not m: sys.exit(f"could not find const {name} in index.html")
    return json.loads(m.group(1))

DEALS = baked("DEALS")
meta = {}                                   # slug -> (name, category), unioned across regions
for reg in DEALS:
    for slug, v in DEALS[reg].items(): meta[slug] = (v["n"], v["c"])
slugs = sorted(meta)

def fetch_spot(region):
    res, ts = {}, 0
    for i in range(0, len(slugs), 60):
        body = json.dumps({"region_slug": region, "item_slugs": slugs[i:i+60]})
        out = subprocess.check_output(
            ["curl","-s","-X","POST",f"{BASE}/prices/latest","-H","Content-Type: application/json","-d",body], timeout=60)
        for r in json.loads(out):
            res[r["item_slug"]] = r["price"]; ts = max(ts, r.get("timestamp") or 0)
    return res, ts

END = datetime.date.today(); START = END - datetime.timedelta(days=20)
data_day = ""                               # newest history day the API returned (UTC)
def fetch_hist(region, slug):
    global data_day
    try:
        days = json.loads(subprocess.check_output(
            ["curl","-s",f"{BASE}/prices/historical/{region}/{slug}?start_date={START}&end_date={END}"], timeout=20))
        days = [d for d in days if d.get("avg_price") is not None]
        if days: data_day = max(data_day, max(d.get("day","") for d in days))
        return [round(d["avg_price"]) for d in reversed(days)][:14]
    except Exception:
        return []

out, data_ts = {}, 0
for region in ("nae", "euc"):
    sp, rts = fetch_spot(region); reg = {}
    data_ts = max(data_ts, rts)
    empty = 0
    for slug in slugs:
        s = sp.get(slug, 0)
        if s <= 0: continue
        n, c = meta[slug]
        h = fetch_hist(region, slug)
        if not h: empty += 1
        reg[slug] = {"n": n, "c": c, "s": s, "h": h}
    if len(reg) < MIN_ITEMS:
        sys.exit(f"  {region}: only {len(reg)} of {len(slugs)} items priced (floor {MIN_ITEMS}) — not baking.")
    if empty > 0.2 * len(reg):   # tolerate a few flaky items, refuse a degraded bake
        sys.exit(f"  {region}: {empty} of {len(reg)} priced items came back with empty history — not baking.")
    out[region] = reg
    print(f"  {region}: {len(reg)} items priced" + (f", {empty} empty histories" if empty else ""))

new = json.dumps(out, separators=(',', ':'))
if new == json.dumps(DEALS, separators=(',', ':')) and data_ts == baked("DATA_TS") and data_day == baked("DATA_DAY"):
    print("Prices and data stamps unchanged — nothing to write."); sys.exit(0)

ts = int(time.time())
# function replacements: raw JSON is not safe as a re.sub template (\u would crash, backslashes corrupt)
src = re.sub(r'^const DEALS=.*;\s*$', lambda m: "const DEALS=" + new + ";", src, count=1, flags=re.M)
src = re.sub(r'^const DEALS_TS=.*;\s*$', lambda m: f"const DEALS_TS={ts};", src, count=1, flags=re.M)
src = re.sub(r'^const DATA_TS=.*;\s*$', lambda m: f"const DATA_TS={data_ts};", src, count=1, flags=re.M)
src = re.sub(r'^const DATA_DAY=.*;\s*$', lambda m: "const DATA_DAY=" + json.dumps(data_day) + ";", src, count=1, flags=re.M)
HTML.write_text(src)
print(f"Updated DEALS in {HTML.name} @ {time.strftime('%Y-%m-%d %H:%M', time.localtime(ts))} — data through {data_day or 'unknown'}.")
