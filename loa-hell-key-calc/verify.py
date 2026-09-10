"""verify.py — Python mirror of model.js + parity check.

    python verify.py            # recompute REFS and assert (PASS/FAIL)
    python verify.py value      # print EV by grade for the default values

The JS in the page is authoritative. REFS below were captured from the live page
(javascript_tool eval) and must be re-captured after any model change.
Same functions, same constants, same order of operations as model.js; the DP is
written top-down with memoisation (reachable states only) because the bottom-up
2M-state sweep is too slow in pure Python.
"""
import json, os, sys
from functools import lru_cache
from math import comb

HERE = os.path.dirname(os.path.abspath(__file__))
REWARDS = json.loads(open(os.path.join(HERE, "data", "rewards.json"), encoding="utf-8").read())
_p = open(os.path.join(HERE, "prices.js")).read()
PRICES = json.loads(_p[_p.index("=") + 1:_p.rindex(";")])

GRADES = [("common", 3), ("uncommon", 4), ("rare", 5), ("epic", 6), ("legendary", 7), ("relic", 8), ("ancient", 9)]
MAXD = 10
ALTAR_FLOORS = {"hell": [11, 22, 33, 44, 55, 66, 77, 88, 99], "flame": [22, 44, 66, 88], "frost": [11, 33, 55, 77, 99]}
ALTAR_EFFECTS = ["desc", "chest", "wealth", "rocket"]
MECH = dict(midUp=0.63, midUpMin=16, midUpMax=20, midDownMin=1, midDownMax=5, bonusGold=30000, bonusStreak=3,
            natAbundant=0.10, abundantMult=10, altarW=dict(desc=20, chest=40, wealth=20, rocket=20),
            tr=dict(d2=0.15, d1=0.15, u1=0.15, u2=0.15, flame=0.20, frost=0.20), chestsShown=3)

PU = PRICES["perUnit"]
def mk():
    return dict(red=18, blue=3, shards=0, fusions=125, leap=25, juice=900,
                gold=1, taps=400, brace=0, karma=275, astroU=0, astroR=0, astroE=15000, elysian=10000,
                kits=0, books=0, cards=0, gems=0)
U0 = {k: float(v) for k, v in mk().items()}

def band_of(f): return 10 if f >= 100 else f // 10

def best_of_k(items, k):
    N = len(items); kk = min(k, N)
    srt = sorted(items, key=lambda x: -x[1])
    tot = comb(N, kk); ev = 0.0; picks = {}
    for j in range(N):
        p = comb(N - 1 - j, kk - 1) / tot
        picks[srt[j][0]] = p; ev += p * srt[j][1]
    return ev, picks

def cat_value(cat, qty, U):
    if cat == "stones": return max(qty * U["red"], 3 * qty * U["blue"])
    if cat == "astro": return qty[0] * U["astroU"] + qty[1] * U["astroR"] + qty[2] * U["astroE"]
    return qty * U[cat]
def base_value(rw, U):
    return rw.get("b_shards", 0) * U["shards"] + rw.get("b_red", 0) * U["red"] + rw.get("b_blue", 0) * U["blue"] + rw.get("b_leap", 0) * U["leap"]

def band_values(key, U, mech):
    chest = {3: [], 4: []}; base = []
    k1, k2 = mech["chestsShown"], mech["chestsShown"] + 1
    for band in key["bands"]:
        items = [(c, cat_value(c, band["rewards"][c], U)) for c in key["chest_cats"] if c in band["rewards"]]
        chest[3].append(best_of_k(items, k1)[0]); chest[4].append(best_of_k(items, k2)[0])
        base.append(base_value(band["rewards"], U))
    return chest, base

class DP:
    """Mirror of runDP: value of a state by memoised recursion."""
    def __init__(self, key, U, mech, element):
        self.nether = element != "hell"
        self.deadly = (lambda f: f < 100 and f % 2 == 1) if element == "flame" else \
                      (lambda f: f < 100 and f % 2 == 0) if element == "frost" else (lambda f: False)
        self.altar = set(ALTAR_FLOORS[element]); self.mech = mech
        self.chest, self.base = band_values(key, U, mech)
        self.ab = 1 + mech["natAbundant"] * (mech["abundantMult"] - 1)
        self.bonus = mech["bonusGold"] * U["gold"]
        W = [mech["altarW"][e] for e in ALTAR_EFFECTS]; ws = sum(W)
        self.pairs = [(i, j, (W[i] / ws) * (W[j] / (ws - W[i]))) for i in range(4) for j in range(4)
                      if i != j and W[i] > 0 and W[j] > 0]
        self.V = lru_cache(maxsize=None)(self._V)
    def term(self, f, c, w):
        b = band_of(f)
        ch = self.chest[4][b] if c else self.chest[3][b]
        bs = 0 if self.nether else self.base[b] * (self.mech["abundantMult"] if w else self.ab)
        return ch + bs
    def arrive(self, f2, d2, s2, c, w, r, u, l):
        if f2 >= 100 or d2 == 0: return self.term(f2, c, w)
        if f2 not in self.altar: return self.V(f2, d2, s2, c, w, r, u, l)
        vals = [self.V(f2, d2, s2, c, w, r, u, l) if u else self.V(f2, d2 + 1, s2, c, w, r, 1, l),
                self.V(f2, d2, s2, 1, w, r, u, l), self.V(f2, d2, s2, c, 1, r, u, l), self.V(f2, d2, s2, c, w, 1, u, l)]
        if not self.pairs:
            W = [self.mech["altarW"][e] for e in ALTAR_EFFECTS]
            k = next((i for i, x in enumerate(W) if x > 0), -1)
            return self.V(f2, d2, s2, c, w, r, u, l) if k < 0 else vals[k]
        return sum(p * max(vals[i], vals[j]) for i, j, p in self.pairs)
    def land(self, f, j, d2, s, c, w, r, u, l):
        f2 = min(100, f + j); rew = 0.0
        if s and s[0] == j:
            cnt = min(3, s[1] + 1); s2 = (j, cnt)
            if cnt >= self.mech["bonusStreak"]: rew = self.bonus
        else: s2 = (j, 1)
        if self.nether and self.deadly(f2):
            if l == 0: return 0.0
            l = 0
        return rew + self.arrive(f2, d2, s2, c, w, r, u, l)
    def ascend(self, f, k, d2, c, w, r, u, l):
        f2 = max(0, f - k)
        if self.nether and self.deadly(f2):
            if l == 0: return 0.0
            l = 0
        return self.arrive(f2, d2, None, c, w, r, u, l)
    def _V(self, f, d, s, c, w, r, u, l):
        m = self.mech
        if d == 0 or f >= 100: return self.term(f, c, w)
        jmin = 16 if r else 1; jn = 20 - jmin + 1
        vn = sum(self.land(f, j, d - 1, s, c, w, 0, u, l) for j in range(jmin, 21)) / jn
        best = vn
        if f >= 10 and f % 10 == 0:
            upN = m["midUpMax"] - m["midUpMin"] + 1; dnN = m["midDownMax"] - m["midDownMin"] + 1
            vm = sum(m["midUp"] * self.land(f, j, d - 1, s, c, w, r, u, l) / upN for j in range(m["midUpMin"], m["midUpMax"] + 1))
            vm += sum((1 - m["midUp"]) * self.ascend(f, k, d - 1, c, w, r, u, l) / dnN for k in range(m["midDownMin"], m["midDownMax"] + 1))
            if vm > best: best = vm
        if self.nether:
            vs = self.term(f, c, w)
            if vs >= best: best = vs
        return best
    def start(self, d): return self.V(0, d, None, 0, 0, 0, 0, 1)
    def middle_vs_normal(self, f, d, s=None):     # s = (last jump, count) or None for a fresh streak
        m = self.mech; l = 1
        vn = sum(self.land(f, j, d - 1, s, 0, 0, 0, 0, l) for j in range(1, 21)) / 20
        upN = m["midUpMax"] - m["midUpMin"] + 1; dnN = m["midDownMax"] - m["midDownMin"] + 1
        vm = sum(m["midUp"] * self.land(f, j, d - 1, s, 0, 0, 0, 0, l) / upN for j in range(m["midUpMin"], m["midUpMax"] + 1))
        vm += sum((1 - m["midUp"]) * self.ascend(f, k, d - 1, 0, 0, 0, 0, l) / dnN for k in range(m["midDownMin"], m["midDownMax"] + 1))
        return vn, vm

def clamp(i): return max(0, min(len(GRADES) - 1, i))
def transmute_ev(i, ev_hell, ev_flame, ev_frost, tr):
    return (tr["d2"] * ev_hell(clamp(i - 2)) + tr["d1"] * ev_hell(clamp(i - 1)) + tr["u1"] * ev_hell(clamp(i + 1))
            + tr["u2"] * ev_hell(clamp(i + 2)) + tr["flame"] * ev_flame(i) + tr["frost"] * ev_frost(i))

sys.setrecursionlimit(10000)

# ---- REFS: captured from the live page (1750 key, default values) ----
REFS = {
    "hell1750_A_rare": 62886.349, "hell1750_A_epic": 93089.051, "hell1750_A_legendary": 136572.110,
    "hell1730_A_rare": 52888.280,
    "nw1750_flame_A_rare": 63129.442, "nw1750_frost_A_rare": 64625.599,
    "altar_rare_A": 70951.706,
    "mid_floor50_d2": (100960.474, 104649.134),   # (normal, middle) -> take the middle
    "mid_floor10_d5": (88253.832, 88501.300),     # -> also middle, by a hair
    "mid_floor30_d3_streak20x2": (79030.676, 81974.824),   # two 20s behind you: chase the third
}
TOL = 0.01   # gold; values captured at 3 dp from the page

def run_verify():
    ok = True
    def check(name, got, want, tol=TOL):
        nonlocal ok
        good = abs(got - want) <= tol
        ok &= good
        print(f"{'ok ' if good else 'BAD'} {name:28s} got {got:12.1f} want {want:12.1f}")
    h50A = DP(REWARDS["keys"]["hell1750"], U0, MECH, "hell")
    check("hell1750_A_rare", h50A.start(5), REFS["hell1750_A_rare"])
    check("hell1750_A_epic", h50A.start(6), REFS["hell1750_A_epic"])
    check("hell1750_A_legendary", h50A.start(7), REFS["hell1750_A_legendary"])
    h30A = DP(REWARDS["keys"]["hell1730"], U0, MECH, "hell")
    check("hell1730_A_rare", h30A.start(5), REFS["hell1730_A_rare"])
    fl = DP(REWARDS["keys"]["nw1750"], U0, MECH, "flame")
    fr = DP(REWARDS["keys"]["nw1750"], U0, MECH, "frost")
    check("nw1750_flame_A_rare", fl.start(5), REFS["nw1750_flame_A_rare"])
    check("nw1750_frost_A_rare", fr.start(5), REFS["nw1750_frost_A_rare"])
    evh = lambda i: h50A.start(GRADES[i][1]); evf = lambda i: fl.start(GRADES[i][1]); evr = lambda i: fr.start(GRADES[i][1])
    check("altar_rare_A", transmute_ev(2, evh, evf, evr, MECH["tr"]), REFS["altar_rare_A"])
    vn, vm = h50A.middle_vs_normal(50, 2); check("mid_floor50_d2 normal", vn, REFS["mid_floor50_d2"][0]); check("mid_floor50_d2 middle", vm, REFS["mid_floor50_d2"][1])
    vn, vm = h50A.middle_vs_normal(10, 5); check("mid_floor10_d5 normal", vn, REFS["mid_floor10_d5"][0]); check("mid_floor10_d5 middle", vm, REFS["mid_floor10_d5"][1])
    vn, vm = h50A.middle_vs_normal(30, 3, (20, 2)); check("streak20x2 f30 d3 normal", vn, REFS["mid_floor30_d3_streak20x2"][0]); check("streak20x2 f30 d3 middle", vm, REFS["mid_floor30_d3_streak20x2"][1])
    # structural invariants
    evs = [h50A.start(d) for d, _ in [(g[1], 0) for g in GRADES]]
    inv = all(evs[i] < evs[i + 1] for i in range(len(evs) - 1)); ok &= inv
    print(("ok " if inv else "BAD") + " EV strictly increases with descents")
    inv2 = h50A.start(5) > h30A.start(5); ok &= inv2
    print(("ok " if inv2 else "BAD") + " 1750 key beats 1730 key at equal grade")
    print("PASS" if ok else "FAIL")
    return ok

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "value":
        for kid in ("hell1750", "hell1730"):
            dp = DP(REWARDS["keys"][kid], U0, MECH, "hell")
            print(kid, " ".join(f"{g}={dp.start(d):,.0f}" for g, d in GRADES))
    else:
        sys.exit(0 if run_verify() else 1)
