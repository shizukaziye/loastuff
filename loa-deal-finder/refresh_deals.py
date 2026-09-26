#!/usr/bin/env python3
"""Refresh the FALLBACK market data baked inside index.html.

The page reads live prices from /market/prices.json (baked every 6 hours by
tools/bake-market.py) and only falls back to the `const DEALS` baked here when
that fetch fails. CI no longer rewrites this fallback; run this by hand now and
then so the fallback is not months old.

It reuses the item list & categories already embedded in index.html (the item
set is self-bootstrapping), takes spot + 14-day history from the shared bake
when bake-market.py confirmed it within the last few hours (otherwise it
fetches the feed itself through tools/marketlib.py), and rewrites the
`const DEALS` / `const DEALS_TS` lines plus the `const DATA_TS` / `const
DATA_DAY` stamps. Rather than bake degraded data it exits 1 when a region
prices fewer than MIN_ITEMS items or too many histories come back empty.

    python3 refresh_deals.py            # shared bake if fresh, else the feed
    python3 refresh_deals.py --live     # always the feed
"""
import json, pathlib, re, sys, time

HTML = pathlib.Path(__file__).with_name("index.html")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
import marketlib  # noqa: E402

MIN_ITEMS = 180        # the self-bootstrapped item list can only shrink — refuse a collapsed bake
src = HTML.read_text(encoding="utf-8")


def baked(name):
    m = re.search(r'^const %s=(.*);\s*$' % name, src, re.M)
    if not m: sys.exit(f"could not find const {name} in index.html")
    return json.loads(m.group(1))


DEALS = baked("DEALS")
meta = {}                                   # slug -> (name, category), unioned across regions
for reg in DEALS:
    for slug, v in DEALS[reg].items(): meta[slug] = (v["n"], v["c"])
slugs = sorted(meta)

try:
    market = marketlib.get_market(slugs, live="--live" in sys.argv[1:])
except Exception as e:
    sys.exit(f"market feed failed ({e}) — not baking.")

out, data_ts, data_day = {}, 0, ""
for region in marketlib.REGIONS:
    mreg = market["regions"][region]
    data_ts = max(data_ts, mreg.get("dataTs") or 0)
    data_day = max(data_day, mreg.get("dataDay") or "")
    reg, empty = {}, 0
    for slug in slugs:
        it = mreg["items"].get(slug)
        if not it or not it.get("spot"): continue
        h = [round(p) for _, p in it["history"]]
        if not h: empty += 1
        n, c = meta[slug]
        reg[slug] = {"n": n, "c": c, "s": it["spot"], "h": h}
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
HTML.write_text(src, encoding="utf-8")
print(f"Updated the fallback DEALS in {HTML.name} @ {time.strftime('%Y-%m-%d %H:%M', time.localtime(ts))} — data through {data_day or 'unknown'}.")
