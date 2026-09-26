"""loseii_score.py -- the Python twin of model/loseii-score.js.

The Loseii Score: a character's damage on the in-game Combat Power scale,

    score = K * exp( sum_s (L_s(character) - L_s(reference)) / 100 )

where L_s is the house log-damage (D = 100 ln(multiplier)) of where the
character stands on system s's ladder, and K is the weighted median of
CP / multiplier over the calibration panel (data/loseii-panel.json).

The JS file is authoritative (it is what the pages run). This file mirrors its
structure, names and order of operations so the two can be checked against
each other: tools/verify-loseii-score.js captures REFS
(tools/loseii-score-refs.json) and runs `python model/loseii_score.py verify`.

    python model/loseii_score.py verify [refs.json]    parity against the REFS
    python model/loseii_score.py value readings.json [dps|support]
                                                        score one set of readings

What cannot be ported (the bracelet scorer, the accessory lattice lookup, the
astrogem grid) arrives as readings already; the DPS ladder tables are
re-derived here from data/rows-dps.json and data/honing-t4upper.json and must
equal the JS ones. The support tables come from the support model's live rows
(JS only) and are taken from the REFS.
"""
import json
import math
import os
import re
import sys

VERSION = "1.0.0"
ARMOR_SLOTS = ["head", "shoulders", "torso", "legs", "hands"]
ACC_SLOTS = ["neck", "ear1", "ear2", "finger1", "finger2"]
ACC_KIND = {"neck": "neck", "ear1": "earring", "ear2": "earring", "finger1": "ring", "finger2": "ring"}
GEM_SLOTS = 11
HONE_MIN, HONE_MAX, KARMA_BASE, KARMA_MAX, GEM_MIN, GEM_MAX = 11, 25, 21, 30, 7, 10

SYSTEMS = [("armor", None), ("weapon", None), ("karma", None), ("gems", None), ("stone", None),
           ("bracelet", None), ("neck", None), ("earring", None), ("ring", None), ("grid", None),
           ("arkPassive", None), ("master", "dps"), ("partner", None)]

# The fixed dummy support buff on a dealer's attack power (model/loseii-score.js
# DUMMY_SUPPORT_AP, derivation there): support.js's ap channel for its
# reference support on its default dealer, x1.4570 while up, x1.4341 at 95%
# uptime. A constant; it cancels in every ratio. A support is measured on one
# fixed dealer, the chart's reference character, and carries no partner term.
DUMMY_SUPPORT_AP = 1.4341

REFERENCE = {
    "armor": {"pieces": {"head": 21, "shoulders": 21, "torso": 21, "legs": 21, "hands": 23}},
    "weapon": 25, "karma": 21, "gems": [9] * 11, "stone": "9-7", "master": False, "evolution": 140,
}


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def num(s):
    d = re.sub(r"[^0-9]", "", "" if s is None else str(s))
    return int(d) if d else None


# ---- the ladder tables ------------------------------------------------------
def tables_from_data(rows_dps, honing, lower=None, extras=None):
    """The DPS tables, from rows-dps.json the way lookup.js steps() hands them
    to tables(): honing and karma from honingDamage/karmaDamage, the rest from
    the baked rows; the gear stats from the two honing tables."""
    rows = []
    for track in ("armor", "weapon"):
        for to, d in rows_dps["honingDamage"][track].items():
            rows.append({"series": track, "to": "+" + to, "damage": d})
    for to, d in rows_dps["karmaDamage"].items():
        rows.append({"series": "karma", "to": "lv " + to, "damage": d})
    for r in rows_dps["rows"]:
        if r["series"] in ("armor", "weapon", "karma", "arkgrid"):
            continue
        rows.append(r)
    ex = dict(extras or {})
    ex["lower"] = lower
    return tables(rows, honing, "dps", ex)


def tables(rows, honing, axis, extras=None):
    extras = extras or {}
    ap = extras.get("apT1")
    t = {"axis": axis, "armor": {}, "weapon": {}, "karma": {}, "gems": {}, "stone": {},
         "bracelet": {"floor": None}, "master": extras.get("masterD") if is_num(extras.get("masterD")) else None,
         "msC": extras.get("msC") if is_num(extras.get("msC")) else 0,
         "wpC": extras.get("wpC") if is_num(extras.get("wpC")) else 0,
         "apT1": {"perLevel": ap["perLevel"], "levels": 40} if ap and is_num(ap.get("perLevel")) else None,
         "upper": {"ms": {}, "wp": {}}, "lower": {"ms": {}, "wp": {}, "base": 1590, "max": 1755},
         "armorKnots": [], "weaponKnots": []}
    for r in rows or []:
        to = num(r.get("to"))
        s = r.get("series")
        if s in ("armor", "weapon") and to is not None:
            t[s][str(to)] = r["damage"]
        elif s == "karma" and to is not None:
            t["karma"][str(to)] = r["damage"]
        elif s == "gems" and to is not None:
            t["gems"][str(to)] = r["damage"]
        elif s == "stone":
            t["stone"][str(r["to"]).strip()] = r["damage"]
        elif s == "bracelet" and is_num(r.get("totalDamage")) and t["bracelet"]["floor"] is None:
            t["bracelet"]["floor"] = r["totalDamage"] - r["damage"]
    ms = honing["armor"]["mainStat"]
    wp = honing["weapon"]["weaponPower"]
    for k in range(0, HONE_MAX + 1):
        for sl in ARMOR_SLOTS:
            t["upper"]["ms"].setdefault(sl, {})[str(k)] = ms[sl][str(k)]["base"] if str(k) in ms[sl] else None
        t["upper"]["wp"][str(k)] = wp[str(k)]["base"] if str(k) in wp else None
    lo = extras.get("lower")
    if lo:
        t["lower"]["base"], t["lower"]["max"] = lo["baseIlvl"], lo["maxIlvl"]
        for il in range(lo["baseIlvl"], lo["maxIlvl"] + 1):
            for sl in ARMOR_SLOTS:
                t["lower"]["ms"].setdefault(sl, {})[str(il)] = lo["armor"]["mainStat"][sl][str(il)]
            t["lower"]["wp"][str(il)] = lo["weapon"]["weaponPower"][str(il)]
    La = Lw = 0.0
    for k in range(HONE_MIN, HONE_MAX + 1):
        if k > HONE_MIN:
            La += t["armor"].get(str(k), 0) or 0
            Lw += t["weapon"].get(str(k), 0) or 0
        A = sum(t["upper"]["ms"][sl][str(k)] or 0 for sl in ARMOR_SLOTS)
        t["armorKnots"].append([A + t["msC"], La])
        t["weaponKnots"].append([(t["upper"]["wp"][str(k)] or 0) + t["wpC"], Lw])
    return t


# ---- where a reading sits on each ladder -------------------------------------
def sum_to(tab, frm, to):
    s = 0.0
    for k in range(frm + 1, to + 1):
        s += tab.get(str(k), 0) or 0
    return s


def on_knots(knots, x):
    n = len(knots)
    if not (x > 0) or n < 2:
        return None
    if x <= knots[0][0]:
        return knots[0][1] + (knots[1][1] - knots[0][1]) * math.log(x / knots[0][0]) / math.log(knots[1][0] / knots[0][0])
    for i in range(1, n):
        if x <= knots[i][0]:
            return knots[i - 1][1] + (knots[i][1] - knots[i - 1][1]) * \
                math.log(x / knots[i - 1][0]) / math.log(knots[i][0] / knots[i - 1][0])
    return knots[n - 1][1] + (knots[n - 1][1] - knots[n - 2][1]) * math.log(x / knots[n - 1][0]) / \
        math.log(knots[n - 1][0] / knots[n - 2][0])


def piece_stat(T, slot, level, track, adv):
    if track == "lower":
        il = max(T["lower"]["base"], min(T["lower"]["max"], T["lower"]["base"] + 5 * level + (adv or 0)))
        tab = T["lower"]["wp"] if slot == "weapon" else T["lower"]["ms"].get(slot)
        return tab.get(str(il)) if tab else None
    k = max(0, min(HONE_MAX, level))
    return T["upper"]["wp"][str(k)] if slot == "weapon" else T["upper"]["ms"][slot][str(k)]


def armor_d(T, rd):
    A, n = 0.0, 0
    if rd.get("pieces"):
        tracks, adv = rd.get("tracks") or {}, rd.get("adv") or {}
        for sl in ARMOR_SLOTS:
            lv = rd["pieces"].get(sl)
            if not is_num(lv):
                continue
            v = piece_stat(T, sl, lv, tracks.get(sl), adv.get(sl))
            if is_num(v):
                A += v
                n += 1
    if n != len(ARMOR_SLOTS):
        if not is_num(rd.get("level")):
            return None
        A = sum(piece_stat(T, sl, rd["level"], "upper", 0) or 0 for sl in ARMOR_SLOTS)
    return on_knots(T["armorKnots"], A + T["msC"])


def weapon_d(T, level, track, adv):
    W = piece_stat(T, "weapon", level, track, adv)
    return on_knots(T["weaponKnots"], W + T["wpC"]) if is_num(W) else None


def karma_d(T, level):
    L = min(KARMA_MAX, level)
    if L >= KARMA_BASE:
        return {"D": sum_to(T["karma"], KARMA_BASE, L)}
    return {"D": -(KARMA_BASE - L) * (T["karma"].get(str(KARMA_BASE + 1), 0) or 0)}


def gem_d(T, levels_):
    D = 0.0
    first = T["gems"].get(str(GEM_MIN + 1), 0) or 0
    take = sorted(levels_, reverse=True)[:GEM_SLOTS]
    for lv in take:
        L = min(GEM_MAX, lv)
        if L < GEM_MIN:
            D -= (GEM_MIN - L) * first / GEM_SLOTS
        else:
            D += sum_to(T["gems"], GEM_MIN, L) / GEM_SLOTS
    return {"D": D}


def stone_owns(rung, stone):
    rd = re.search(r"(\d+)-(\d+)", str(rung))
    md = re.search(r"(\d+)-(\d+)", str(stone))
    if not rd or not md:
        return False
    a, b, c, d = int(rd.group(1)), int(rd.group(2)), int(md.group(1)), int(md.group(2))
    return a < c or (a == c and b <= d)


def stone_d(T, stone):
    D = 0.0
    for r, d in T["stone"].items():
        if stone_owns(r, stone):
            D += d
    return {"D": D}


def armor_stat(T, rd):
    A, n = 0.0, 0
    if rd.get("pieces"):
        tracks, adv = rd.get("tracks") or {}, rd.get("adv") or {}
        for sl in ARMOR_SLOTS:
            lv = rd["pieces"].get(sl)
            if not is_num(lv):
                continue
            v = piece_stat(T, sl, lv, tracks.get(sl), adv.get(sl))
            if is_num(v):
                A += v
                n += 1
    if n != len(ARMOR_SLOTS):
        if not is_num(rd.get("level")):
            return None
        A = sum(piece_stat(T, sl, rd["level"], "upper", 0) or 0 for sl in ARMOR_SLOTS)
    return A


def levels(T, rd, axis):
    out = {}
    rd = rd or {}
    if rd.get("armor"):
        x = armor_d(T, rd["armor"])
        if is_num(x):
            out["armor"] = x
    if is_num(rd.get("weapon")):
        x = weapon_d(T, rd["weapon"], rd.get("weaponTrack"), rd.get("weaponAdv"))
        if is_num(x):
            out["weapon"] = x
    if is_num(rd.get("karma")):
        out["karma"] = karma_d(T, rd["karma"])["D"]
    if isinstance(rd.get("gems"), list) and rd["gems"]:
        out["gems"] = gem_d(T, rd["gems"])["D"]
    if rd.get("stone"):
        out["stone"] = stone_d(T, rd["stone"])["D"]
    if rd.get("bracelet") and is_num(rd["bracelet"].get("D")):
        out["bracelet"] = rd["bracelet"]["D"]
    if rd.get("acc"):
        for kind in ("neck", "earring", "ring"):
            have = [s for s in ACC_SLOTS if ACC_KIND[s] == kind and rd["acc"].get(s) and is_num(rd["acc"][s].get("D"))]
            if have:
                out[kind] = sum(rd["acc"][s]["D"] for s in have)
    if rd.get("grid") and is_num(rd["grid"].get("D")):
        out["grid"] = rd["grid"]["D"]
    if is_num(rd.get("evolution")) and T.get("apT1"):
        out["arkPassive"] = max(0, min(T["apT1"]["levels"], rd["evolution"])) * T["apT1"]["perLevel"]
    if axis == "dps" and isinstance(rd.get("master"), bool) and is_num(T.get("master")):
        out["master"] = T["master"] if rd["master"] else 0
    out["partner"] = 100 * math.log(DUMMY_SUPPORT_AP) if axis == "dps" else 0.0
    return out


def acc_part(kind, a, b):
    D = 0.0
    missing = []
    for s in ACC_SLOTS:
        if ACC_KIND[s] != kind:
            continue
        x = (a.get("acc") or {}).get(s)
        y = (b.get("acc") or {}).get(s)
        if x and is_num(x.get("D")) and y and is_num(y.get("D")):
            D += x["D"] - y["D"]
        else:
            missing.append(s)
    return D, missing


# ---- the reference, the comparison, the scale, the score ---------------------
def reference_readings(extra):
    extra = extra or {}
    acc = {}
    for s in ACC_SLOTS:
        D = (extra.get("acc") or {}).get(ACC_KIND[s])
        if is_num(D):
            acc[s] = {"D": D}
    return {"armor": REFERENCE["armor"], "weapon": REFERENCE["weapon"], "karma": REFERENCE["karma"],
            "gems": list(REFERENCE["gems"]), "stone": REFERENCE["stone"], "master": REFERENCE["master"],
            "evolution": REFERENCE["evolution"], "acc": acc, "grid": {"D": extra["grid"]} if is_num(extra.get("grid")) else None,
            "bracelet": {"D": extra["bracelet"]} if is_num(extra.get("bracelet")) else None}


def compare(T, axis, rd, ref):
    me, rf = levels(T, rd or {}, axis), levels(T, ref, axis)
    parts, unscored, total = {}, [], 0.0
    for key, only in SYSTEMS:
        if only and only != axis:
            continue
        if key not in me or key not in rf:
            unscored.append(key)
            continue
        D = me[key] - rf[key]
        if key in ("neck", "earring", "ring"):
            D, missing = acc_part(key, rd, ref)
            if missing:
                unscored.append(key)
        total += D
        parts[key] = D
    return total, parts, unscored


def wmedian(xs):
    a = sorted([x for x in xs if is_num(x[0]) and x[1] > 0], key=lambda x: x[0])
    if not a:
        return None
    tot = sum(x[1] for x in a)
    run = 0.0
    for v, w in a:
        run += w
        if run >= tot / 2 - 1e-12:
            return v
    return a[-1][0]


def calibrate(T, axis, panel, extra):
    extra = extra or {}
    members = [m for m in panel or [] if m and is_num(m.get("cp")) and m["cp"] > 0 and m.get("readings")]
    bref = wmedian([((m["readings"].get("bracelet") or {}).get("D"), m.get("weight") or 1) for m in members])
    ref = reference_readings({"acc": extra.get("acc"), "grid": extra.get("grid"), "bracelet": bref})
    ks = []
    for m in members:
        total, _, _ = compare(T, axis, m["readings"], ref)
        ks.append((m["cp"] / math.exp(total / 100), m.get("weight") or 1))
    return {"K": wmedian(ks), "braceletRef": bref, "n": len(members)}


def score(axis, T, readings, calib, reference):
    ref = reference_readings({"acc": (reference or {}).get("acc"), "grid": (reference or {}).get("grid"),
                              "bracelet": calib["braceletRef"]})
    total, parts, unscored = compare(T, axis, readings or {}, ref)
    if not parts:
        return None
    return {"score": calib["K"] * math.exp(total / 100), "D": total, "parts": parts, "unscored": unscored}


# ---- the CLI -------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def verify(refs_path):
    R = load(refs_path)
    fails = 0

    def check(label, ok, detail=""):
        nonlocal fails
        if not ok:
            fails += 1
        print(("ok   " if ok else "FAIL ") + label + ("   " + detail if detail else ""))

    # the DPS tables, re-derived from the data files
    data = os.path.join(os.path.dirname(HERE), "data")
    want = R["tables"]["dps"]
    mine = tables_from_data(load(os.path.join(data, "rows-dps.json")), load(os.path.join(data, "honing-t4upper.json")),
                            load(os.path.join(data, "honing-t4lower.json")),
                            {"masterD": want.get("master"), "msC": want["msC"], "wpC": want["wpC"],
                             "apT1": want.get("apT1")})
    same = True
    for k in ("armor", "weapon", "karma", "gems", "stone"):
        for lv, d in want[k].items():
            same = same and abs(mine[k].get(lv, float("nan")) - d) < 1e-12
    same = same and abs(mine["bracelet"]["floor"] - want["bracelet"]["floor"]) < 1e-12
    for key in ("armorKnots", "weaponKnots"):
        same = same and len(mine[key]) == len(want[key]) and all(
            abs(a[0] - b[0]) < 1e-9 and abs(a[1] - b[1]) < 1e-9 for a, b in zip(mine[key], want[key]))
    for part in ("upper", "lower"):
        same = same and mine[part]["wp"] == want[part]["wp"] and mine[part]["ms"] == want[part]["ms"]
    check("dps tables re-derived from rows-dps.json and the two honing tables", same)

    cal = {}
    for axis in ("dps", "support"):
        c = calibrate(R["tables"][axis], axis, R["panel"][axis]["members"], R["reference"][axis])
        cal[axis] = c
        check("%s K %.4f" % (axis, c["K"]), abs(c["K"] - R["panel"][axis]["K"]) < 1e-6,
              "want %.4f" % R["panel"][axis]["K"])
    for case in R["cases"]:
        r = score(case["axis"], R["tables"][case["axis"]], case["readings"], cal[case["axis"]], R["reference"][case["axis"]])
        w = case["want"]
        ok = r is not None and abs(r["score"] - w["score"]) < 1e-6 and all(
            k in r["parts"] and abs(r["parts"][k] - d) < 1e-9 for k, d in w["parts"].items())
        ok = ok and sorted(set(r["unscored"])) == sorted(set(w["unscored"]))
        check("%s -> %.2f" % (case["name"][:70], r["score"] if r else float("nan")), ok, "want %.2f" % w["score"])
    print("%d FAILED" % fails if fails else "python twin: all checks pass")
    return 0 if not fails else 1


def main(argv):
    if len(argv) >= 2 and argv[1] == "verify":
        refs = argv[2] if len(argv) > 2 else os.path.join(os.path.dirname(HERE), "tools", "loseii-score-refs.json")
        return verify(refs)
    if len(argv) >= 3 and argv[1] == "value":
        R = load(os.path.join(os.path.dirname(HERE), "tools", "loseii-score-refs.json"))
        axis = argv[3] if len(argv) > 3 else "dps"
        c = calibrate(R["tables"][axis], axis, R["panel"][axis]["members"], R["reference"][axis])
        r = score(axis, R["tables"][axis], load(argv[2]), c, R["reference"][axis])
        print(json.dumps({"score": round(r["score"]), "D": r["D"], "parts": r["parts"], "unscored": r["unscored"]}, indent=1))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
