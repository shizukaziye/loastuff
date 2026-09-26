"""Shared Lost Ark market-feed code for every loseii tool that prices items.

One place for: the loa-buddy market API calls (latest + daily history), the
robust fair-price model, and reading/writing the shared bake at
/market/prices.json (schema in market/README.md).

Stdlib only, so it runs on a bare GitHub runner. Scripts elsewhere in the repo
import it with

    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[N] / "tools"))
    import marketlib

The feed (see the loa-market-data skill):
  POST {API}/prices/latest               {"region_slug", "item_slugs"} -> [{item_slug, price, timestamp}]
  GET  {API}/prices/historical/{region}/{slug}?start_date=&end_date=   -> [{day, avg_price, ...}]
It 403s urllib's default User-Agent, so every call sends a browser UA.
"""
import concurrent.futures
import datetime
import json
import os
import pathlib
import sys
import time
import urllib.request

API = "https://marketdata-api.yrzhao1068589.workers.dev/v1"
REGIONS = ("nae", "euc")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Content-Type": "application/json"}

ROOT = pathlib.Path(__file__).resolve().parent.parent
MARKET = ROOT / "market" / "prices.json"
# Written (gitignored) each time bake-market.py confirms the feed this run, even
# when prices.json itself did not change. The per-tool bakes trust prices.json
# only while this stamp is fresh; otherwise they fetch the feed themselves.
STAMP = ROOT / "market" / ".verified"

HIST_DAYS = 14          # daily points kept per item (h[0] = the newest, still-open day)
HIST_WINDOW = 20        # days asked of the API, a cushion for missing days
TRIM, DECAY, MIN_DAYS = 2, 0.9, 5   # robust-price defaults


# ---------------------------------------------------------------- HTTP
def _call(req, timeout, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def post(path, body, timeout=40):
    return _call(urllib.request.Request(API + path, data=json.dumps(body).encode(), headers=UA), timeout)


def get(path, timeout=30):
    return _call(urllib.request.Request(API + path, headers=UA), timeout)


def fetch_latest(region, slugs, chunk=60):
    """{slug: (price, timestamp)} for every slug the feed prices. Raises on a failed call."""
    out = {}
    slugs = list(slugs)
    for i in range(0, len(slugs), chunk):
        rows = post("/prices/latest", {"region_slug": region, "item_slugs": slugs[i:i + chunk]})
        if not isinstance(rows, list):
            raise ValueError(f"/prices/latest returned {type(rows).__name__}, not a list")
        for r in rows:
            out[r["item_slug"]] = (r.get("price"), r.get("timestamp") or 0)
    return out


def fetch_history(region, slug, days=HIST_WINDOW):
    """[(day 'YYYY-MM-DD', avg_price), ...] newest-first; only days with an average. Raises on a failed call."""
    end = datetime.datetime.now(datetime.timezone.utc).date()
    start = end - datetime.timedelta(days=days)
    rows = get(f"/prices/historical/{region}/{slug}?start_date={start}&end_date={end}")
    rows = [(d["day"], d["avg_price"]) for d in rows if d.get("avg_price") is not None and d.get("day")]
    return sorted(rows, reverse=True)


# ---------------------------------------------------------------- the model
def robust(avgs, trim=TRIM, decay=DECAY, min_days=MIN_DAYS):
    """Robust fair price from daily averages, newest-first (avgs[0] = today, still open).

    Drop today, drop the `trim` highest and `trim` lowest completed days (by
    position, so ties drop exactly `trim` values, as the pages' robustPrice()
    does), then take a recency-weighted mean: newest completed day x1, each
    older day x decay. None when fewer than `min_days` completed days exist.
    Unrounded; the pages round their own copy for display.
    """
    comp = list(avgs[1:])
    if len(comp) < min_days:
        return None
    if trim > 0 and len(comp) > 2 * trim:
        idx = sorted(range(len(comp)), key=lambda i: comp[i])
        drop = set(idx[:trim]) | set(idx[len(idx) - trim:])
        comp = [v for i, v in enumerate(comp) if i not in drop]
    num = den = 0.0
    w = 1.0
    for v in comp:
        num += v * w
        den += w
        w *= decay
    return num / den if den else None


def num(x):
    """Compact number for the JSON: 2 decimals, int when whole."""
    x = round(float(x), 2)
    return int(x) if x == int(x) else x


def day_ts(day):
    """'YYYY-MM-DD' -> unix seconds at 00:00 UTC."""
    return int(datetime.datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc).timestamp())


# ---------------------------------------------------------------- the bake
def bake_region(region, slugs, workers=6, log=print):
    """One region of the shared market file: latest spot + 14 daily points + robust price per item.

    Returns (region_dict, stats). Raises when the latest call fails. Items with
    neither a spot nor any history are left out; a failed history call counts
    as an empty history (stats["empty"]) rather than killing the region.
    """
    latest = fetch_latest(region, slugs)
    data_ts = max((ts for _, ts in latest.values()), default=0)

    def hist(slug):
        try:
            return slug, fetch_history(region, slug)
        except Exception as e:
            log(f"  {region}/{slug}: history error {e}")
            return slug, []

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        hists = dict(ex.map(hist, slugs))

    items, data_day, empty, priced = {}, "", 0, 0
    for slug in sorted(slugs):
        spot = (latest.get(slug) or (None, 0))[0]
        spot = spot if spot and spot > 0 else None
        h = hists.get(slug) or []
        h = h[:HIST_DAYS]
        if h:
            data_day = max(data_day, h[0][0])
        if spot is None and not h:
            continue
        if spot is not None:
            priced += 1
            if not h:
                empty += 1
        hist_pts = [[day_ts(d), num(p)] for d, p in h]
        rb = robust([p for _, p in hist_pts])
        items[slug] = {"spot": num(spot) if spot is not None else None,
                       "robust": num(rb) if rb is not None else None,
                       "history": hist_pts}
    return ({"dataTs": data_ts, "dataDay": data_day, "items": items},
            {"priced": priced, "empty": empty, "asked": len(slugs)})


def bake(slugs, regions=REGIONS, log=print):
    """A whole market dict (the prices.json shape) for these slugs, fetched now. Raises on a dead feed."""
    out = {"v": 1, "bakedAt": int(time.time()), "source": API,
           "robust": {"trim": TRIM, "decay": DECAY, "minDays": MIN_DAYS}, "regions": {}}
    for region in regions:
        reg, st = bake_region(region, sorted(set(slugs)), log=log)
        log(f"  {region}: {st['priced']} of {st['asked']} items priced"
            + (f", {st['empty']} empty histories" if st["empty"] else ""))
        out["regions"][region] = reg
    return out


# ---------------------------------------------------------------- the shared file
def dumps(market):
    """prices.json text: one item per line so git diffs stay readable."""
    head = {k: v for k, v in market.items() if k != "regions"}
    lines = ["{"]
    for k, v in head.items():
        lines.append(f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))},")
    lines.append('  "regions": {')
    regs = list(market["regions"].items())
    for ri, (region, reg) in enumerate(regs):
        lines.append(f"    {json.dumps(region)}: {{")
        lines.append(f'      "dataTs": {json.dumps(reg["dataTs"])}, "dataDay": {json.dumps(reg["dataDay"])},')
        lines.append('      "items": {')
        its = list(reg["items"].items())
        for ii, (slug, it) in enumerate(its):
            lines.append(f"        {json.dumps(slug)}: {json.dumps(it, separators=(',', ':'))}"
                         + ("," if ii < len(its) - 1 else ""))
        lines.append("      }")
        lines.append("    }" + ("," if ri < len(regs) - 1 else ""))
    lines.append("  }")
    lines.append("}")
    return "\n".join(lines) + "\n"


def load(path=MARKET):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None


def write(market, path=MARKET):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(dumps(market), encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def write_stamp():
    STAMP.parent.mkdir(parents=True, exist_ok=True)
    STAMP.write_text(json.dumps({"at": int(time.time())}), encoding="utf-8")


def fresh_market(max_age=3 * 3600):
    """The shared file, if bake-market.py confirmed it within max_age seconds; else None."""
    try:
        at = json.loads(STAMP.read_text(encoding="utf-8"))["at"]
    except Exception:
        return None
    if time.time() - at > max_age:
        return None
    return load()


def get_market(slugs, regions=REGIONS, live=False, log=print):
    """Market data for these slugs: the shared bake when this run confirmed it, else a direct fetch."""
    m = None if live else fresh_market()
    if m is not None and all(r in m.get("regions", {}) for r in regions):
        log(f"using the shared bake {MARKET.relative_to(ROOT).as_posix()} (bakedAt {m.get('bakedAt')})")
        return m
    log("no fresh shared bake; fetching the feed directly")
    return bake(slugs, regions, log=log)


if __name__ == "__main__":
    # tiny self-test of the robust model against the pages' robustPrice() (see
    # loa-crafting-calculator/verify.py ROBUST_ANCHORS for the JS-captured values)
    assert robust([9, 1, 2, 3, 4, 5, 6, 7], trim=2, decay=1.0, min_days=1) == 4.0
    assert robust([0, 5, 5, 5, 5, 5, 6]) == 5.0          # ties drop by position, not by value
    assert robust([1, 2, 3]) is None
    # parity with the JS robustPrice(): the crafting calculator's browser-captured
    # anchors over its frozen refs.json histories (Math.round of the same mean)
    refs = json.loads((ROOT / "loa-crafting-calculator" / "refs.json").read_text(encoding="utf-8"))["prices"]
    anchors = {("nae", "masters-herb-steak"): 1771, ("nae", "virtuoso-striploin"): 6013,
               ("nae", "specialist-beef"): 2202, ("nae", "abidos-fusion-material"): 136,
               ("nae", "fish"): 175, ("euc", "masters-herb-steak"): 2255, ("euc", "fish"): 332}
    for (region, slug), want in anchors.items():
        got = int(robust(refs[region][slug]["h"], min_days=1) + 0.5)
        assert got == want, f"robust {region}/{slug}: {got} != JS {want}"
    print("marketlib self-test ok (robust() matches the pages' robustPrice on %d anchors)" % len(anchors))
    sys.exit(0)
