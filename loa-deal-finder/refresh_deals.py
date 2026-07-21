#!/usr/bin/env python3
"""Refresh the baked market data inside index.html — spot + 14-day history for every
item, both regions. Reuses the item list & categories already embedded in index.html
(so the item set is self-bootstrapping), re-fetches prices server-side (the market API
works fine outside the browser), and rewrites the `const DEALS` / `const DEALS_TS` lines.

    python3 refresh_deals.py
"""
import json, re, subprocess, sys, time, datetime, pathlib

HTML = pathlib.Path(__file__).with_name("index.html")
BASE = "https://marketdata-api.yrzhao1068589.workers.dev/v1"
src  = HTML.read_text()

m = re.search(r'^const DEALS=(.*);\s*$', src, re.M)
if not m: sys.exit("could not find const DEALS in index.html")
DEALS = json.loads(m.group(1))
meta = {}                                   # slug -> (name, category), unioned across regions
for reg in DEALS:
    for slug, v in DEALS[reg].items(): meta[slug] = (v["n"], v["c"])
slugs = sorted(meta)

def fetch_spot(region):
    res = {}
    for i in range(0, len(slugs), 60):
        body = json.dumps({"region_slug": region, "item_slugs": slugs[i:i+60]})
        out = subprocess.check_output(
            ["curl","-s","-X","POST",f"{BASE}/prices/latest","-H","Content-Type: application/json","-d",body], timeout=60)
        for r in json.loads(out): res[r["item_slug"]] = r["price"]
    return res

END = datetime.date.today(); START = END - datetime.timedelta(days=20)
def fetch_hist(region, slug):
    try:
        days = json.loads(subprocess.check_output(
            ["curl","-s",f"{BASE}/prices/historical/{region}/{slug}?start_date={START}&end_date={END}"], timeout=20))
        return list(reversed([round(d["avg_price"]) for d in days if d.get("avg_price") is not None]))[:14]
    except Exception:
        return []

out = {}
for region in ("nae", "euc"):
    sp = fetch_spot(region); reg = {}
    for slug in slugs:
        s = sp.get(slug, 0)
        if s <= 0: continue
        n, c = meta[slug]
        reg[slug] = {"n": n, "c": c, "s": s, "h": fetch_hist(region, slug)}
    out[region] = reg
    print(f"  {region}: {len(reg)} items priced")

new = json.dumps(out, separators=(',', ':'))
if new == json.dumps(DEALS, separators=(',', ':')):
    print("Prices unchanged — nothing to write."); sys.exit(0)

ts = int(time.time())
src = re.sub(r'^const DEALS=.*;\s*$', "const DEALS=" + new + ";", src, count=1, flags=re.M)
src = re.sub(r'^const DEALS_TS=.*;\s*$', f"const DEALS_TS={ts};", src, count=1, flags=re.M)
HTML.write_text(src)
print(f"Updated DEALS in {HTML.name} @ {time.strftime('%Y-%m-%d %H:%M', time.localtime(ts))}.")
