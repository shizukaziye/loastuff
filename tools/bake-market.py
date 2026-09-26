#!/usr/bin/env python3
"""Bake the shared market file /market/prices.json — one fetch of the loa-buddy
feed per refresh run, for every item any loseii tool prices.

The item set is the union of what the tools already know:
  loa-deal-finder/index.html       const DEALS (both regions)   ~190 items
  loa-crafting-calculator/index.html  const ITEMS (slugs)       44 items
  loa-hell-key-calc/fetch_prices.py   SLUGS
  loa-gpd/fetch_prices.py             SLUGS
Schema: market/README.md. Maths: tools/marketlib.py.

Guards, copied from the deal finder: rather than write degraded data it exits 1
and leaves prices.json untouched when the feed fails, when a region prices
fewer than MIN_ITEMS items, or when more than 20% of priced items come back
with no history. When prices and data stamps are unchanged it leaves the file
alone (no commit churn) but still stamps market/.verified, which tells the
per-tool bakes run after it that the file is current.

    python tools/bake-market.py
"""
import importlib.util
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import marketlib  # noqa: E402

ROOT = marketlib.ROOT
MIN_ITEMS = 180      # the self-bootstrapped deal-finder list can only shrink — refuse a collapsed bake
MAX_EMPTY = 0.2      # share of priced items allowed to come back with no history


def baked_const(path, name):
    src = (ROOT / path).read_text(encoding="utf-8")
    m = re.search(r"^const %s=(.*);\s*$" % name, src, re.M)
    if not m:
        sys.exit(f"could not find const {name} in {path}")
    return json.loads(m.group(1))


def module_slugs(path):
    spec = importlib.util.spec_from_file_location("slugs_" + pathlib.Path(path).parent.name.replace("-", "_"), ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return list(mod.SLUGS)


def wanted():
    slugs = set()
    for reg in baked_const("loa-deal-finder/index.html", "DEALS").values():
        slugs |= set(reg)
    slugs |= {v["slug"] for v in baked_const("loa-crafting-calculator/index.html", "ITEMS").values()}
    slugs |= set(module_slugs("loa-hell-key-calc/fetch_prices.py"))
    slugs |= set(module_slugs("loa-gpd/fetch_prices.py"))
    return sorted(slugs)


def main():
    slugs = wanted()
    print(f"baking {len(slugs)} items x {len(marketlib.REGIONS)} regions")
    try:
        market = marketlib.bake(slugs)
    except Exception as e:
        sys.exit(f"market feed failed ({e}) — not baking; market/prices.json left as it was.")
    for region, reg in market["regions"].items():
        items = reg["items"]
        priced = [s for s, it in items.items() if it["spot"]]
        empty = [s for s in priced if not items[s]["history"]]
        if len(priced) < MIN_ITEMS:
            sys.exit(f"  {region}: only {len(priced)} of {len(slugs)} items priced (floor {MIN_ITEMS}) — not baking.")
        if len(empty) > MAX_EMPTY * len(priced):
            sys.exit(f"  {region}: {len(empty)} of {len(priced)} priced items came back with empty history — not baking.")
        if not reg["dataDay"]:
            sys.exit(f"  {region}: no history day at all — not baking.")
    old = marketlib.load()
    if old and old.get("regions") == market["regions"]:
        print("prices and data stamps unchanged — market/prices.json left as it was.")
    else:
        marketlib.write(market)
        print(f"wrote market/prices.json — data through {max(r['dataDay'] for r in market['regions'].values())}.")
    marketlib.write_stamp()


if __name__ == "__main__":
    main()
