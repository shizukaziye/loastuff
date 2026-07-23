#!/usr/bin/env python3
"""Lost Ark accessory value calculator — Python reference for index.html.

Mirrors the in-browser model exactly (DPS + Support markets):
- multiplicative (log) damage via the sqrt attack-power formula,
- support party-damage contribution (brand / AP buff / serenade / t-skill),
- per-slot Pareto demand fit to the NECKLACE anchors only (earring/ring derived
  by damage/quality ratio), value above a high/nothing/nothing baseline minus
  the pheon tax,
- every cut outcome valued at max(DPS, Support).

CLI:
  python3 accessory_value.py verify          # closed-form + parity checks
  python3 accessory_value.py value --type neck --main-stat 17000 \
      --line "Outgoing Damage %" high --line "Additional Damage %" mid
"""
import argparse
import bisect
import math
import sys

# ---------------- parameters (mirror index.html DEFAULTS) ----------------
P = dict(
    anchors={"dps": {"hm": 500000, "hh": 3200000},
             "support": {"hm": 250000, "hh": 1200000}},   # NECK only per market
    baseAdd=0.3585, baseAtk=0.1333, baseCR=0.90, baseCD=2.80, critX=1.12,
    baseWP=250000, baseMS=750000, tax=60000, baseFlatAtk=2700,
    supBrand=43.13, supAtkEnh=68.25, supAllyDmg=37.13, supAllyDmgT=7.13,  # % (identity-bracket / t-skill-bracket ally-dmg base)
    spec=1100, supClassCoeff=0.0005005722461,                            # Bard: spec -> identity-buff efficiency multiplier
    upBrand=100, upAp=95, upSeren=70, upChord=70, upTskill=40,            # %
    hpAsWp=False,  # toggle: value Max HP+ flats exactly like Weapon Attack Power+ (both markets)
)
DEMAND_MAX = 6e7   # cap: 60M gold per 1% damage (final pricing only; calibration is cap-free)
CUT_COST = 1200

TIERS = ("low", "mid", "high")
TIER_PROB = {"low": 0.063, "mid": 0.030, "high": 0.007}

EFFECTS = {
    "neck": ["Outgoing Damage %", "Additional Damage %", "Gauge Gain %", "Stigma %",
             "Max HP+", "Attack Power+", "Weapon Attack Power+", "Max MP+",
             "Debuff Duration %", "HP Recovery+"],
    "earring": ["Attack Power %", "Weapon Attack Power %", "Healing %", "Shield %",
                "Max HP+", "Attack Power+", "Weapon Attack Power+", "Max MP+",
                "Debuff Duration %", "HP Recovery+"],
    "ring": ["Crit Damage %", "Crit Rate %", "Ally Atk Buff %", "Ally Dmg Buff %",
             "Max HP+", "Attack Power+", "Weapon Attack Power+", "Max MP+",
             "Debuff Duration %", "HP Recovery+"],
}
PRIMARY = {"neck": ("Outgoing Damage %", "Additional Damage %"),
           "earring": ("Attack Power %", "Weapon Attack Power %"),
           "ring": ("Crit Damage %", "Crit Rate %")}
SUP_PRIMARY = {"neck": ("Stigma %", "Gauge Gain %"),
               "earring": ("Weapon Attack Power %",),
               "ring": ("Ally Dmg Buff %", "Ally Atk Buff %")}
FLAT = frozenset({"Attack Power+", "Weapon Attack Power+"})
SUP_FLAT = frozenset({"Weapon Attack Power+"})
MAIN_RANGE = {"neck": (15178, 17857), "earring": (11806, 13889), "ring": (10962, 12897)}
STAT_LABS = ("min", "low", "mid", "high", "max")  # quintile marks, 20% of drops each


def ms_levels(acc):
    """Main-stat quality levels at 0/25/50/75/100% of the roll range.
    int(x + 0.5) matches JS Math.round exactly (python round() is half-even)."""
    lo, hi = MAIN_RANGE[acc]
    return [int(lo + (hi - lo) * i / 4 + 0.5) for i in range(5)]

RAW = {
    "Outgoing Damage %": [0.55, 1.20, 2.00], "Additional Damage %": [0.95, 1.60, 2.60],
    "Attack Power %": [0.40, 0.95, 1.55], "Weapon Attack Power %": [0.80, 1.80, 3.00],
    "Crit Rate %": [0.40, 0.95, 1.55], "Crit Damage %": [1.10, 2.40, 4.00],
    "Attack Power+": [80, 195, 390], "Weapon Attack Power+": [195, 480, 960],
}
SUP_RAW = {
    "Stigma %": [2.15, 4.8, 8], "Gauge Gain %": [1.6, 3.6, 6],
    "Ally Dmg Buff %": [2, 4.5, 7.5], "Ally Atk Buff %": [1.35, 3, 5],
    "Weapon Attack Power %": [0.8, 1.8, 3.0], "Weapon Attack Power+": [195, 480, 960],
}


def eff_name(e):
    """Canonical effect for valuation: with the hpAsWp toggle on, Max HP+ is
    priced exactly like Weapon Attack Power+ at the same tier (both markets)."""
    return "Weapon Attack Power+" if (P["hpAsWp"] and e == "Max HP+") else e


def set_hp_as_wp(on):
    P["hpAsWp"] = bool(on)
    _model.clear()  # supply reshapes -> recalibrate (distribution cache is value-independent)


# ---------------- DPS damage ----------------
def sup_mult():
    # the support's AP buff to your DPS, derived from AP uptime + ally-atk-enh
    return 0.22 * (1 + P["supAtkEnh"] / 100) * (P["upAp"] / 100)


def atk_bucket(wp_pct=0.0, wp_flat=0.0, ms_add=0.0, atk_pct=0.0, atk_flat=0.0):
    WP = P["baseWP"] * (1 + wp_pct) + wp_flat
    MS = P["baseMS"] + ms_add
    dps = math.sqrt(WP * MS / 6)
    sup = math.sqrt(P["baseWP"] * P["baseMS"] / 6)
    k = sup_mult()
    tot = (dps + sup * k) * (1 + P["baseAtk"] + atk_pct) + atk_flat + P["baseFlatAtk"]
    tot0 = (sup + sup * k) * (1 + P["baseAtk"]) + P["baseFlatAtk"]
    return tot / tot0


def crit_f(cr, cd):
    cr = min(cr, 1.0)
    return cr * cd * P["critX"] + (1 - cr)


def line_marginal_pct(eff, tier):
    eff = eff_name(eff)
    t = TIERS.index(tier)
    r = RAW.get(eff)
    if r is None:
        return 0.0
    v = r[t]
    if eff == "Outgoing Damage %":
        return v
    if eff == "Additional Damage %":
        return v / (1 + P["baseAdd"])
    if eff == "Attack Power %":
        return (atk_bucket(atk_pct=v / 100) - 1) * 100
    if eff == "Weapon Attack Power %":
        return (atk_bucket(wp_pct=v / 100) - 1) * 100
    if eff == "Crit Rate %":
        return (crit_f(P["baseCR"] + v / 100, P["baseCD"]) / crit_f(P["baseCR"], P["baseCD"]) - 1) * 100
    if eff == "Crit Damage %":
        return (crit_f(P["baseCR"], P["baseCD"] + v / 100) / crit_f(P["baseCR"], P["baseCD"]) - 1) * 100
    if eff == "Attack Power+":
        return (atk_bucket(atk_flat=v) - 1) * 100
    if eff == "Weapon Attack Power+":
        return (atk_bucket(wp_flat=v) - 1) * 100
    return 0.0


def line_log(eff, tier):
    return 100 * math.log(1 + line_marginal_pct(eff, tier) / 100)


def main_log(ms):
    return 100 * math.log(atk_bucket(ms_add=ms))


def accD(ms, lines):
    return main_log(ms) + sum(line_log(e, t) for e, t in lines)


# ---------------- Support quality ----------------
def sup_extract(lines):
    x = dict(brand=0.0, gain=0.0, allydmg=0.0, atkenh=0.0, wp=0.0, wpflat=0.0)
    for e0, t in lines:
        e = eff_name(e0)
        r = SUP_RAW.get(e)
        if r is None:
            continue
        v = r[TIERS.index(t)]
        if e == "Stigma %":
            x["brand"] += v / 100
        elif e == "Gauge Gain %":
            x["gain"] += v / 100
        elif e == "Ally Dmg Buff %":
            x["allydmg"] += v / 100
        elif e == "Ally Atk Buff %":
            x["atkenh"] += v / 100
        elif e == "Weapon Attack Power %":
            x["wp"] += v / 100
        elif e == "Weapon Attack Power+":
            x["wpflat"] += v
    return x


def sup_contrib_mult(x, ms):
    # ally-dmg feeds two brackets: the identity bracket (serenade + Major Chord) and
    # the t-skill's own bracket. Ring Ally Dmg lines (x["allydmg"]) add to both.
    ally_dmg = P["supAllyDmg"] / 100 + x["allydmg"]      # identity bracket: ark grid + gem + rings
    ally_dmg_t = P["supAllyDmgT"] / 100 + x["allydmg"]   # t-skill bracket: ark grid + rings (no gem)
    atkenh = P["supAtkEnh"] / 100 + x["atkenh"]
    bp = P["supBrand"] / 100
    spec_eff = P["spec"] * P["supClassCoeff"]            # identity-buff multiplier from spec
    # AP buff: support adds 0.22·(1+ally_atk_enh) of its base atk to yours
    sup_wp = P["baseWP"] * (1 + x["wp"]) + x["wpflat"]
    sup_ms = P["baseMS"] + ms
    sup_base_ap = math.sqrt(sup_wp * sup_ms / 6)
    dps_base = math.sqrt(P["baseWP"] * P["baseMS"] / 6)
    dps_mults = 1 + P["baseAtk"]
    dps_flats = P["baseFlatAtk"]
    ap_mult = ((dps_base + sup_base_ap * 0.22 * (1 + atkenh)) * dps_mults + dps_flats) / (dps_base * dps_mults + dps_flats)
    ap = 1 + (P["upAp"] / 100) * (ap_mult - 1)
    brand = 1 + (P["upBrand"] / 100) * (0.10 * (1 + bp + x["brand"]))
    # identity channel: serenade + Major Chord + t-skill all raise the DPS's Additional
    # Damage, so they add up and are then diluted by the DPS's own base additional.
    seren = 0.15 * (1 + ally_dmg) * (1 + spec_eff) * (1 + 0.5 * x["gain"])
    chord = 0.02 * (1 + ally_dmg) * (1 + spec_eff)
    tsk = 0.10 * (1 + ally_dmg_t)
    identity = 1 + ((P["upSeren"] / 100) * seren + (P["upChord"] / 100) * chord
                    + (P["upTskill"] / 100) * tsk) / (1 + P["baseAdd"])
    return ap * brand * identity


_ZERO = dict(brand=0.0, gain=0.0, allydmg=0.0, atkenh=0.0, wp=0.0, wpflat=0.0)


def support_quality(slot, ms, lines):
    return 100 * math.log(sup_contrib_mult(sup_extract(lines), ms) / sup_contrib_mult(_ZERO, 0))


def quality(slot, ms, lines, market):
    return support_quality(slot, ms, lines) if market == "support" else accD(ms, lines)


# ---------------- probability: full-cut 3-line distribution ----------------
_dist_cache = {}


def three_line_dist(acc):
    if acc in _dist_cache:
        return _dist_cache[acc]
    effs = EFFECTS[acc]
    out = {}

    def rec(lines, prob, excluded):
        if len(lines) == 3:
            key = tuple(sorted(lines))
            if key in out:
                out[key][1] += prob
            else:
                out[key] = [list(lines), prob]
            return
        rem = 1 - 0.1 * len(excluded)
        for ef in effs:
            if ef in excluded:
                continue
            for t in TIERS:
                excluded.add(ef)
                rec(lines + [(ef, t)], prob * TIER_PROB[t] / rem, excluded)
                excluded.discard(ef)

    rec([], 1.0, set())
    _dist_cache[acc] = [(v[0], v[1]) for v in out.values()]
    return _dist_cache[acc]


# ---------------- supply / calibration / value ----------------
def build_supply(slot, market):
    levels = ms_levels(slot)
    pts = []
    for lines, prob in three_line_dist(slot):
        for ms in levels:
            pts.append((quality(slot, ms, lines, market), prob / 5))
    pts.sort()
    damages, cum = [], []
    r = 0.0
    for d, p in pts:
        r += p
        damages.append(d)
        cum.append(r)
    return damages, cum


def marginal_price(f, a, pmin, cap=DEMAND_MAX):
    if f >= 1:
        return cap
    return min(cap, pmin * (1 - f) ** (-1.0 / a))


def integ(damages, cum, a, pmin, D, cap=DEMAND_MAX):
    tot = 0.0
    n = len(damages)
    for i in range(n):
        if damages[i] >= D:
            break
        nb = damages[i + 1] if i + 1 < n else D
        de = min(nb, D)
        if de > damages[i]:
            tot += marginal_price(cum[i], a, pmin, cap) * (de - damages[i])
    return tot


def ref_sets(slot, market):
    if market != "support":
        p0, p1 = PRIMARY[slot]
        return dict(hi=[(p0, "high"), (p1, "high")], lo=[(p0, "high"), (p1, "mid")],
                    base=[(p0, "high")])
    if slot == "earring":
        return dict(hi=[("Weapon Attack Power %", "high"), ("Weapon Attack Power+", "high")],
                    lo=[("Weapon Attack Power %", "high"), ("Weapon Attack Power+", "low")],
                    base=[("Weapon Attack Power %", "high")])
    p0, p1 = SUP_PRIMARY[slot]
    return dict(hi=[(p0, "high"), (p1, "high")], lo=[(p0, "high"), (p1, "mid")], base=[(p0, "high")])


def base_score(slot, market):
    return quality(slot, MAIN_RANGE[slot][0], ref_sets(slot, market)["base"], market)


def calibrate(slot, market):
    damages, cum = build_supply(slot, market)
    lo = MAIN_RANGE[slot][0]
    rs = ref_sets(slot, market)
    baseD = base_score(slot, market)
    dHM = quality(slot, lo, rs["lo"], market)
    dHH = quality(slot, lo, rs["hi"], market)
    if slot == "neck":
        vHM, vHH = P["anchors"][market]["hm"], P["anchors"][market]["hh"]
    else:  # derive from neck by score-above-baseline ratio
        nlo = MAIN_RANGE["neck"][0]
        nrs = ref_sets("neck", market)
        nb = base_score("neck", market)
        nHM = quality("neck", nlo, nrs["lo"], market) - nb
        nHH = quality("neck", nlo, nrs["hi"], market) - nb
        vHM = P["anchors"][market]["hm"] * max(0.0, dHM - baseD) / nHM
        vHH = P["anchors"][market]["hh"] * max(0.0, dHH - baseD) / nHH
    target = (vHH + P["tax"]) / (vHM + P["tax"])
    INF = float("inf")

    def ratio_err(a):
        Ib = integ(damages, cum, a, 1, baseD, INF)
        ihm = integ(damages, cum, a, 1, dHM, INF) - Ib
        if ihm <= 0:
            return 1e99
        return abs((integ(damages, cum, a, 1, dHH, INF) - Ib) / ihm - target)

    bestA, bestErr = 1.0, 1e99
    for k in range(401):
        a = 0.15 * (60 / 0.15) ** (k / 400)
        e = ratio_err(a)
        if e < bestErr:
            bestErr, bestA = e, a
    gr = 0.6180339887
    alo, ahi = bestA / 1.4, bestA * 1.4
    g1 = ahi - gr * (ahi - alo)
    g2 = alo + gr * (ahi - alo)
    for _ in range(60):
        if ratio_err(g1) < ratio_err(g2):
            ahi = g2
            g2 = g1
            g1 = ahi - gr * (ahi - alo)
        else:
            alo = g1
            g1 = g2
            g2 = alo + gr * (ahi - alo)
    a = (alo + ahi) / 2
    Ib = integ(damages, cum, a, 1, baseD, INF)
    ihm = integ(damages, cum, a, 1, dHM, INF) - Ib
    pmin = (vHM + P["tax"]) / ihm if ihm > 0 else 0.0
    Gcum = [0.0]
    for i in range(1, len(damages)):
        Gcum.append(Gcum[i - 1] + marginal_price(cum[i - 1], a, pmin) * (damages[i] - damages[i - 1]))
    return dict(damages=damages, cum=cum, Gcum=Gcum, baseD=baseD, a=a, pmin=pmin)


_model = {}


def get_model(slot, market):
    key = slot + "_" + market
    if key not in _model:
        _model[key] = calibrate(slot, market)
    return _model[key]


def _G_at(m, D):
    d = m["damages"]
    idx = bisect.bisect_right(d, D) - 1
    if idx < 0:
        return 0.0
    return m["Gcum"][idx] + marginal_price(m["cum"][idx], m["a"], m["pmin"]) * (D - d[idx])


def value_at(slot, score, market):
    m = get_model(slot, market)
    return max(0.0, (_G_at(m, score) - _G_at(m, m["baseD"])) - P["tax"])


def best_value(slot, ms, lines):
    return max(value_at(slot, accD(ms, lines), "dps"),
               value_at(slot, support_quality(slot, ms, lines), "support"))


# ---------------- strategies / EV / optimal DP ----------------
def single_cut(acc, excluded):
    rem = 1 - 0.1 * len(excluded)
    for e in EFFECTS[acc]:
        if e in excluded:
            continue
        for t in TIERS:
            yield e, t, TIER_PROB[t] / rem


def strat_dist(acc, cont):
    dist = {}

    def rec(lines, prob, excluded):
        if not cont(lines):
            key = tuple(lines)
            dist[key] = dist.get(key, 0.0) + prob
            return
        for e, t, p in single_cut(acc, excluded):
            excluded.add(e)
            rec(lines + [(e, t)], prob * p, excluded)
            excluded.discard(e)

    rec([], 1.0, set())
    return dist


def ev_of_cutting(acc, ms, strat):
    if strat == 1:
        def cont(l):
            if len(l) == 0:
                return True
            if len(l) >= 3:
                return False
            return (l[0][0] in PRIMARY[acc] or l[0][0] in SUP_PRIMARY[acc]) and l[0][1] != "low"
    else:
        def cont(l):
            return len(l) < 3
    dist = strat_dist(acc, cont)
    ev = cost = 0.0
    for lines, prob in dist.items():
        cost += prob * CUT_COST * len(lines)
        if len(lines) == 3:
            ev += prob * best_value(acc, ms, list(lines))
    return ev - cost


def opt_ev(acc, ms):
    memo = {}

    def val(lines, excluded):
        if len(lines) == 3:
            return best_value(acc, ms, lines)
        key = tuple(sorted(lines))
        if key in memo:
            return memo[key]
        ev = 0.0
        for e, t, p in single_cut(acc, excluded):
            excluded.add(e)
            ev += p * val(lines + [(e, t)], excluded)
            excluded.discard(e)
        r = max(0.0, ev - CUT_COST)
        memo[key] = r
        return r

    return val([], set())


# ---------------- CLI ----------------
def fmt(g):
    if abs(g) >= 1e6:
        return f"{g/1e6:.2f}M"
    if abs(g) >= 1e4:
        return f"{g/1e3:.0f}k"
    return f"{g:,.0f}"


def cmd_value(args):
    slot = args.type
    lines = [(e, t) for e, t in args.line]
    ms = args.main_stat
    if args.hp_as_wp:
        set_hp_as_wp(True)
        print("  (Max HP+ valued as Weapon Attack Power+)")
    dv = value_at(slot, accD(ms, lines), "dps")
    sv = value_at(slot, support_quality(slot, ms, lines), "support")
    print(f"=== {slot} main {ms} ===")
    for e, t in lines:
        print(f"  {e} ({t})")
    print(f"  DPS quality D   : {accD(ms, lines):.3f}   value {fmt(dv)}")
    print(f"  Support quality : {support_quality(slot, ms, lines):.3f}   value {fmt(sv)}")
    print(f"  best (max)      : {fmt(max(dv, sv))}")


REFS = {  # captured from the live JS site (index.html) for parity
    "dps_neck_hh": 3200000, "dps_neck_hm": 500000,
    "sup_neck_hh": 1200000, "sup_neck_hm": 250000,
    "dps_earring_hh": 1831054, "dps_ring_hh": 1901534, "sup_ring_hh": 2276999,
    # (5 main-stat quintile levels; mid = ms_levels("neck")[2] = 16518)
    "supRoll_best": 1403073, "ev_neck_mid_opt": 2036,
    "neck_dps_a": 1.35085, "neck_dps_pmin": 11215.585,
    # hpAsWp toggle ON (Max HP+ valued as Weapon Attack Power+):
    "hp_ev_neck_mid_opt": 2116,
    "hp_neck_dps_a": 1.35108, "hp_neck_dps_pmin": 11351.826,
    "hp_neck_hh_hp3": 4326673,   # Outgoing high / Additional high / Max HP+ high, min stat
}


def cmd_verify(args):
    ok = True

    def chk(label, cond, detail=""):
        nonlocal ok
        s = "PASS" if cond else "FAIL"
        print(f"  [{s}] {label}" + (f" — {detail}" if detail else ""))
        if not cond:
            ok = False

    lo = lambda n: MAIN_RANGE[n][0]
    print("1. Anchors (necklace inputs)")
    vals = {
        "dps_neck_hh": value_at("neck", accD(lo("neck"), [("Outgoing Damage %", "high"), ("Additional Damage %", "high")]), "dps"),
        "dps_neck_hm": value_at("neck", accD(lo("neck"), [("Outgoing Damage %", "high"), ("Additional Damage %", "mid")]), "dps"),
        "sup_neck_hh": value_at("neck", support_quality("neck", lo("neck"), [("Stigma %", "high"), ("Gauge Gain %", "high")]), "support"),
        "sup_neck_hm": value_at("neck", support_quality("neck", lo("neck"), [("Stigma %", "high"), ("Gauge Gain %", "mid")]), "support"),
    }
    for k, v in vals.items():
        chk(f"{k} == {REFS[k]:,}", abs(v - REFS[k]) < 50, f"got {fmt(v)}")

    print("2. Derived earring/ring + support (match JS)")
    der = {
        "dps_earring_hh": value_at("earring", accD(lo("earring"), [("Attack Power %", "high"), ("Weapon Attack Power %", "high")]), "dps"),
        "dps_ring_hh": value_at("ring", accD(lo("ring"), [("Crit Damage %", "high"), ("Crit Rate %", "high")]), "dps"),
        "sup_ring_hh": value_at("ring", support_quality("ring", lo("ring"), [("Ally Dmg Buff %", "high"), ("Ally Atk Buff %", "high")]), "support"),
    }
    for k, v in der.items():
        chk(f"{k} ~= {REFS[k]:,}", abs(v - REFS[k]) < max(2000, REFS[k] * 0.01), f"got {fmt(v)}")

    print("3. Calibration params match JS (neck dps)")
    m = get_model("neck", "dps")
    chk("neck dps a", abs(m["a"] - REFS["neck_dps_a"]) < 1e-3, f"got {m['a']:.4f}")
    chk("neck dps pmin", abs(m["pmin"] - REFS["neck_dps_pmin"]) < 1.0, f"got {m['pmin']:.3f}")

    print("4. Support baseline = 0; DPS-junk roll priced by support; best>=dps")
    chk("support neck baseline == 0",
        value_at("neck", support_quality("neck", lo("neck"), [("Stigma %", "high")]), "support") == 0.0)
    ms = ms_levels("neck")[2]   # mid quintile (16518)
    roll = [("Stigma %", "high"), ("Gauge Gain %", "high"), ("Max HP+", "low")]
    chk("Brand+Serenade neck: dps value == 0", value_at("neck", accD(ms, roll), "dps") == 0.0)
    chk(f"  best ~= {REFS['supRoll_best']:,}", abs(best_value("neck", ms, roll) - REFS["supRoll_best"]) < 2000,
        f"got {fmt(best_value('neck', ms, roll))}")
    # best >= dps for a sample of full cuts
    bad = 0
    for lines, _ in three_line_dist("neck")[:500]:
        if best_value("neck", ms, list(lines)) < value_at("neck", accD(ms, list(lines)), "dps") - 1e-6:
            bad += 1
    chk("best_value >= dps_value (sample of 500)", bad == 0, f"{bad} violations")

    print("5. EV with support (match JS) and >= DPS-only")
    ev = opt_ev("neck", ms)
    chk(f"optimal EV neck mid ~= {REFS['ev_neck_mid_opt']:,}", abs(ev - REFS["ev_neck_mid_opt"]) < 20, f"got {ev:.0f}")
    # dps-only EV proxy: temporarily compare best vs dps-only optimal
    dps_only = _opt_ev_dps_only("neck", ms)
    chk("EV(with support) >= EV(DPS-only)", ev >= dps_only - 1.0, f"{ev:.0f} vs {dps_only:.0f}")

    print("\n6. Distribution sanity")
    for acc in EFFECTS:
        tot = sum(p for _, p in three_line_dist(acc))
        chk(f"{acc}: cut distribution sums to 1", abs(tot - 1.0) < 1e-9, f"{tot:.12f}")

    print("\n7. hpAsWp toggle (Max HP+ valued as Weapon Attack Power+)")
    ev_off = opt_ev("neck", ms_levels("neck")[2])
    set_hp_as_wp(True)
    for t in TIERS:
        chk(f"dps: HP+ {t} == WPN+ {t}", abs(line_log("Max HP+", t) - line_log("Weapon Attack Power+", t)) < 1e-12)
    chk("support: HP+ high == WPN+ high",
        abs(support_quality("neck", 0, [("Max HP+", "high")])
            - support_quality("neck", 0, [("Weapon Attack Power+", "high")])) < 1e-12)
    # anchors stay pinned (their reference rolls contain no HP line)
    chk("neck dps h/h still 3,200,000",
        abs(value_at("neck", accD(lo("neck"), [("Outgoing Damage %", "high"), ("Additional Damage %", "high")]), "dps") - 3200000) < 50)
    chk("neck sup h/h still 1,200,000",
        abs(value_at("neck", support_quality("neck", lo("neck"), [("Stigma %", "high"), ("Gauge Gain %", "high")]), "support") - 1200000) < 50)
    chk("derived ring dps h/h unchanged",
        abs(value_at("ring", accD(lo("ring"), [("Crit Damage %", "high"), ("Crit Rate %", "high")]), "dps") - REFS["dps_ring_hh"]) < max(2000, REFS["dps_ring_hh"] * 0.01))
    m_hp = get_model("neck", "dps")
    chk("neck dps a (hp on) matches JS", abs(m_hp["a"] - REFS["hp_neck_dps_a"]) < 1e-3, f"got {m_hp['a']:.5f}")
    chk("neck dps pmin (hp on) matches JS", abs(m_hp["pmin"] - REFS["hp_neck_dps_pmin"]) < 1.0, f"got {m_hp['pmin']:.3f}")
    v3 = value_at("neck", accD(lo("neck"), [("Outgoing Damage %", "high"), ("Additional Damage %", "high"), ("Max HP+", "high")]), "dps")
    chk(f"h/h + HP-high triple ~= {REFS['hp_neck_hh_hp3']:,}",
        abs(v3 - REFS["hp_neck_hh_hp3"]) < max(2000, REFS["hp_neck_hh_hp3"] * 0.01), f"got {fmt(v3)}")
    ev_on = opt_ev("neck", ms_levels("neck")[2])
    chk(f"optimal EV neck mid (hp on) ~= {REFS['hp_ev_neck_mid_opt']:,}",
        abs(ev_on - REFS["hp_ev_neck_mid_opt"]) < 20, f"got {ev_on:.0f}")
    chk("EV(hp on) > EV(off)", ev_on > ev_off, f"{ev_on:.0f} vs {ev_off:.0f}")
    set_hp_as_wp(False)

    print("\nOVERALL:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


def _opt_ev_dps_only(acc, ms):
    memo = {}

    def val(lines, excluded):
        if len(lines) == 3:
            return value_at(acc, accD(ms, lines), "dps")
        key = tuple(sorted(lines))
        if key in memo:
            return memo[key]
        ev = 0.0
        for e, t, p in single_cut(acc, excluded):
            excluded.add(e)
            ev += p * val(lines + [(e, t)], excluded)
            excluded.discard(e)
        r = max(0.0, ev - CUT_COST)
        memo[key] = r
        return r

    return val([], set())


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    pv = sub.add_parser("value")
    pv.add_argument("--type", required=True, choices=list(EFFECTS))
    pv.add_argument("--main-stat", type=int, required=True)
    pv.add_argument("--line", nargs=2, action="append", metavar=("EFFECT", "TIER"), required=True)
    pv.add_argument("--hp-as-wp", action="store_true",
                    help="value Max HP+ flats exactly like Weapon Attack Power+ (both markets)")
    pv.set_defaults(func=cmd_value)
    px = sub.add_parser("verify")
    px.set_defaults(func=cmd_verify)
    args = ap.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
