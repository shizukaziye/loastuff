#!/usr/bin/env python3
"""Parity guard for the crafting calculator (verified-model pattern).

Reads RECIPES / ITEMS from index.html and frozen reference prices from refs.json,
recomputes every recipe in a Python mirror of the JS engine, and asserts the
results match reference values captured from the browser. Prices are frozen
(refs.json) so scheduled price refreshes never make this test fail spuriously —
it guards the formula + recipe data, not the live market. If you edit the recipe
data or the formula, run this; any drift fails loudly.

    python3 verify.py
"""
import json, math, re, sys, pathlib

HTML = pathlib.Path(__file__).with_name("index.html").read_text()

def grab(name):
    # each data const is emitted on its own line: `const NAME=<json>;`
    m = re.search(r'^const %s=(.*);\s*$' % name, HTML, re.M)
    if not m:
        sys.exit("could not find const %s in index.html" % name)
    return json.loads(m.group(1))

RECIPES = grab("RECIPES")
ITEMS   = grab("ITEMS")
# frozen reference prices — decoupled from the live snapshot so scheduled refreshes never break this guard
FROZEN  = json.loads(pathlib.Path(__file__).with_name("refs.json").read_text())["prices"]

# default reductions = the user's in-game screenshot
R = {"general":{"cost":7,"time":10,"gs":5}, "battle":{"cost":0,"time":0,"gs":0},
     "cooking":{"cost":0,"time":0,"gs":0},  "special":{"cost":10,"time":0,"gs":9}}
ENABLE_GS = True

# ---- model: line-for-line mirror of the JS in index.html ----
def adj_gold(r):  c = R["general"]["cost"] + R.get(r["type"],{}).get("cost",0); return math.floor(r["craftingCost"]*(1-c/100))
def adj_time(r):  t = R["general"]["time"] + R.get(r["type"],{}).get("time",0); return r["craftingTime"]*(1-t/100)
def gsc(r):
    if not ENABLE_GS: return 0
    x = R["general"]["gs"] + R.get(r["type"],{}).get("gs",0)
    return 5*(1+x/100)
def tax(p):        return 0 if p <= 1 else math.ceil(p*0.05)
def unit_price(iid, prices): m=ITEMS[iid]; return (prices.get(m["slug"],0))/m["bundle"]
def option_cost(opt, prices): return sum(it["quantity"]*unit_price(it["id"],prices) for it in opt["items"])
def best_option(r, prices):
    best=None
    for o in r["materialOptions"]:
        c=option_cost(o,prices)
        if best is None or c<best[1]: best=(o["category"],c)
    return best
def evaluate(r, prices):
    gold=adj_gold(r); cat,matCost=best_option(r,prices); total=matCost+gold
    EY=r["quantity"]*(1+gsc(r)/100)
    sell=prices.get(ITEMS[r["id"]]["slug"],0); t=tax(sell); net=EY*(sell-t)-total
    time=adj_time(r); perHr=net/(time/60) if time>0 else 0
    return dict(gold=gold,path=cat,matCost=matCost,total=total,EY=EY,sell=sell,tax=t,
                net=net,perHr=perHr,roi=(net/total if total>0 else 0))

def robust_price(h, te, d):                      # mirror of robustPrice() in index.html
    if not h: return None
    a = list(h[1:]) if len(h) > 1 else list(h)   # drop the current/live day — completed history only
    if te>0 and len(a)>2*te:
        idx=sorted(range(len(a)), key=lambda i:a[i])
        drop=set(idx[:te])|set(idx[len(idx)-te:])
        a=[v for i,v in enumerate(a) if i not in drop]
    num=den=0.0; w=1.0
    for v in a: num+=v*w; den+=w; w*=d
    return int(math.floor(num/den+0.5)) if den else None     # Math.round-compatible

# ---- reference values captured from the shipped JS (preview_eval) ----
ANCHORS = {
 ("nae","virtuoso_striploin"):     dict(net=1932.64, total=3957.15, EY=1.0525, sell=5891, tax=295, gold=74, path="default"),
 ("nae","specialist_beef"):        dict(net=-271.3675, total=2360.58, sell=2090, tax=105, path="default"),
 ("nae","masters_herb_steak"):     dict(net=1920.355, perHr=2133.7278, total=1066.64),
 ("nae","masters_chewy_grilled"):  dict(net=468.595, sell=1022, tax=52),
 ("nae","abidos_fusion_material"): dict(net=164.79, EY=10.57, gold=332, path="Logging"),       # multi-path, cheapest
 ("nae","oreha_fusion_material"):  dict(net=-370.09, sell=1, tax=0, EY=31.71, path="Fishing"), # tax-zero edge (price<=1)
 ("nae","superior_oreha_fusion_material"): dict(net=310.0, path="Fishing", EY=21.14),
 ("nae","splendid_sacred_charm"):  dict(net=197.28, EY=2.105),    # input is the crafted item sacred_charm
 ("nae","splendid_elemental_hp_potion"): dict(net=60.42),         # input is crafted elemental_hp_potion
 ("euc","virtuoso_striploin"):     dict(net=990.955, sell=5897, tax=295, total=4905.15),       # region switch
 ("euc","abidos_fusion_material"): dict(net=114.82, sell=140, tax=7, gold=332),
}

# robust-price reference values captured from the shipped JS (trim 2 each side, decay 0.90)
ROBUST_ANCHORS = {
 ("nae","masters-herb-steak"):1771, ("nae","virtuoso-striploin"):6013, ("nae","specialist-beef"):2202,
 ("nae","abidos-fusion-material"):136, ("nae","fish"):175, ("nae","abidos-solar-carp"):2379,
 ("euc","masters-herb-steak"):2255, ("euc","virtuoso-striploin"):5954, ("euc","fish"):332, ("euc","abidos-solar-carp"):2293,
}

def close(a,b,eps=0.02): return abs(a-b) <= eps

fails=0
print(f"{'recipe':32s} {'region':3s} {'net/craft':>11s} {'net/hr':>10s} {'EY':>7s} {'path':>10s}")
for region in ("nae","euc"):
    prices={s: FROZEN[region][s]["s"] for s in FROZEN[region]}  # anchors captured on the spot basis
    for r in sorted(RECIPES, key=lambda x:x["id"]):
        e=evaluate(r,prices)
        print(f"{r['id']:32s} {region:3s} {e['net']:11.2f} {e['perHr']:10.2f} {e['EY']:7.3f} {e['path']:>10s}")
        exp=ANCHORS.get((region,r["id"]))
        if exp:
            for k,v in exp.items():
                got=e[k]
                ok = (got==v) if isinstance(v,str) or k in ("tax","gold","sell") else close(got,v)
                if not ok:
                    fails+=1; print(f"   !! MISMATCH {region}/{r['id']}.{k}: got {got!r} expected {v!r}")

for (region,slug),exp in ROBUST_ANCHORS.items():     # robust estimator parity (trim 2, decay 0.90)
    got=robust_price(FROZEN[region][slug]["h"], 2, 0.90)
    if got!=exp:
        fails+=1; print(f"   !! ROBUST MISMATCH {region}/{slug}: got {got} expected {exp}")

n=len(ANCHORS)+len(ROBUST_ANCHORS)
if fails:
    print(f"\nFAIL — {fails} mismatch(es) across {n} anchors (engine + robust). JS and Python have drifted.")
    sys.exit(1)
print(f"\nPASS — Python mirror reproduces all {n} captured browser anchors (engine + robust pricing). JS/PY in parity.")
