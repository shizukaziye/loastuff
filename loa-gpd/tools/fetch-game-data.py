#!/usr/bin/env python3
"""Pull Lost Ark game tables from Maxroll's planner feed and bake the small
derived files this tool ships.

Maxroll's upgrade calculator does not put its tables in the page; it loads them
from a planner data feed. Those files are the game's own tables, and the page
states which patch they track ("Up to date with October 2026 patch" — PATCH
below). We cache the big downloads under tools/.cache/ (gitignored) and commit
only the small baked JSON under data/.

The cache is never refreshed on its own: a file already under tools/.cache/ is
read as it is. To pick up a new patch, delete tools/.cache/ and set PATCH to
what the calculator page says.

Cross-check that keeps us honest: the `itemLevel` table reproduces bebkok's
Serca gear sheet exactly (chest 57,614 at +0 and 111,477 at +25; weapon 124,793
and 241,367), which is the same baseline the bracelet calculator uses.

Writes data/honing-t4upper.json, data/honing-t4lower.json, data/karma.json and
data/vambrace.json.

Usage:  python tools/fetch-game-data.py
"""

import io
import json
import os
import re
import urllib.request

BASE = "https://assets-ng.maxroll.gg/laplanner"
GAME = {
    "stats": f"{BASE}/game/stats.json",
    "items": f"{BASE}/game/items.json",
    "items1": f"{BASE}/game/items1.json",
    "items2": f"{BASE}/game/items2.json",
}
# The planner bundle carries the honing-mode definitions (which materials each
# mode shows, and in what unit) plus the stat-id enum.
TOOLS_JS = f"{BASE}/static/js/tools.js"

# What maxroll's upgrade calculator page says the feed tracks. The feed carries
# no patch label of its own, so it is typed here: read it off the page whenever
# the cache is refreshed. Stamped into every file a run writes.
PATCH = "October 2026 (per maxroll's upgrade calculator)"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", ".cache")
DATA = os.path.join(ROOT, "data")

# T4 Upper (1675) gear — the "Destined Tremor" set. Item ids come from the
# planner bundle's t4upper mode definition.
T4_UPPER = {
    "weapon": "134621110",
    "head": "134621111",
    "torso": "134621112",
    "legs": "134621113",
    "hands": "134621114",
    "shoulders": "134621115",
}
ARMOR_SLOTS = ["head", "shoulders", "torso", "legs", "hands"]
BASE_ILVL = 1675
ILVL_PER_LEVEL = 5

# T4 lower (1590) gear — "Destined Hellfire", the Ancient set a character hones
# before moving to the upper set (the Relic 1590 set reads the same numbers).
# On this track advanced honing raises item level one for one and the stats
# follow item level, so the table is keyed by item level, 1590..1755 (+25 with
# advanced 40). The Loseii Score reads it (model/loseii-score.js).
T4_LOWER = {
    "weapon": "134611110",
    "head": "134613111",
    "torso": "134613112",
    "legs": "134613113",
    "hands": "134613114",
    "shoulders": "134613115",
}
LOWER_BASE_ILVL = 1590
LOWER_MAX_ILVL = 1755

# Vambraces (October 2026): one piece in four grades. A limit break at +10, +15
# and +20 swaps the item for the next grade's, and one honing table, +1 to +25,
# runs across all four. Ids are one class's copy, as above.
VAMBRACE = [
    ("epic", "134301106"),
    ("legendary", "134401106"),
    ("relic", "134501106"),
    ("ancient", "134601106"),
]
VAMBRACE_MAX = 25

# Material rows the calculator shows for T4 Upper, with the unit each price is
# quoted in. Order matches the tool's own layout.
MATERIALS = [
    {"id": "66130141", "unit": 1, "shards": 1000, "kind": "shard_pouch"},
    {"id": "66130142", "unit": 1, "shards": 2000, "kind": "shard_pouch"},
    {"id": "66130143", "unit": 1, "shards": 3000, "kind": "shard_pouch"},
    {"id": "6861013", "unit": 1, "kind": "mat"},
    {"id": "66102007", "unit": 100, "kind": "mat"},
    {"id": "66102107", "unit": 100, "kind": "mat"},
    {"id": "66110226", "unit": 1, "kind": "mat"},
    {"id": "66111131", "unit": 1, "kind": "juice", "slot": "weapon"},
    {"id": "66111132", "unit": 1, "kind": "juice", "slot": "armor"},
]


def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://maxroll.gg/"},
        )
        with urllib.request.urlopen(req) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


def load_json(name, url):
    return json.load(io.open(fetch(url, name), encoding="utf-8"))


def stat_enum(js_src):
    """id -> STAT_NAME for the enum the item tables use.

    The bundle defines several enums that share numbers, so we take only the
    contiguous run containing EVOLUTION_DAM_RATE=45 / STIGMA_POWER_RATE=46.
    """
    pat = re.compile(r'e\[e\.([A-Z0-9_]+)=(\d+)\]="\1",?')
    anchor = js_src.find("EVOLUTION_DAM_RATE=45")
    lo_bound = max(0, anchor - 60000)
    window = js_src[lo_bound : anchor + 80000]
    hits = list(pat.finditer(window))
    target = anchor - lo_bound
    k = next(i for i, m in enumerate(hits) if m.start() <= target <= m.end())
    lo, hi = k, k
    while lo > 0 and hits[lo - 1].end() == hits[lo].start():
        lo -= 1
    while hi + 1 < len(hits) and hits[hi].end() == hits[hi + 1].start():
        hi += 1
    return {int(m.group(2)): m.group(1) for m in hits[lo : hi + 1]}


def additive_divisor(row):
    """The feed's unit for breath rates, as a divisor back to 0.01%.

    Until mid 2026 the feed quoted a breath's rate in the success rate's own
    0.01% units (weapon +12: rate 25 a breath, cap 500). It now quotes 0.001%
    (rate 250, cap 5000) and maxroll's optimizer divides the sum by ten. The
    baked files stay in 0.01%, which is what model/honing.js adds to the base
    rate, so the unit is read off a row whose answer is known: T4 upper weapon
    +12, where a full breath doubles the 5.00% base.
    """
    for div in (1, 10):
        if row["additiveMax"] == row["success"] * div:
            return div
    raise SystemExit(
        "cannot tell the feed's breath-rate unit: weapon +12 has success "
        f"{row['success']} and a breath cap of {row['additiveMax']}, which is neither "
        "the base rate nor ten times it. Nothing written."
    )


def scaled(value, div):
    """A feed breath rate in 0.01% units: whole where it divides, exact where
    it does not (the vambrace's first five levels are 3.75 a breath)."""
    whole, rest = divmod(value, div)
    return whole if rest == 0 else value / div


def bake_vambrace(stats, items, enum, div):
    """data/vambrace.json: the vambrace's stats per honing level, what each
    level costs, and the three limit breaks.

    A vambrace has no item level, so its stats are not on the `itemLevel`
    curve the gear reads. They are two blocks added together: the grade's
    static block (`itemStatic`, keyed "<static0>#<grade>") and the honing
    level's block (`itemQuality`, cumulative from +1). The honing rows are one
    table across the four grades; a limit break changes the item, and with it
    only the static block's basic attack power rate.

    `div` is additive_divisor()'s answer for this feed.
    """
    missing = [item_id for _, item_id in VAMBRACE if item_id not in items]
    if missing:
        raise SystemExit(
            "the cached feed has no vambrace (" + ", ".join(missing) + "): it predates the "
            "October 2026 patch. Delete tools/.cache/ to download the feed again. Nothing written."
        )
    item_quality, enhance, item_static = stats["itemQuality"], stats["enhanceCommon"], stats["itemStatic"]

    def named(rows):
        out = {}
        for s in rows or []:
            name = enum.get(s["stat"], str(s["stat"]))
            out[name] = out.get(name, 0) + s["value"]
        return out

    first = items[VAMBRACE[0][1]]
    quality = first["quality"]
    main_stat = next(n for n in ("STR", "AGI", "INT")
                     if n in named(item_static[f"{first['static0']}#{first['grade']}"]))

    def block(st):
        """The stats both blocks may carry, by the names the baked file uses.
        Takes them out of `st`, so what is left is what nobody read."""
        return {
            "mainStat": st.pop(main_stat, 0),
            "weaponPower": st.pop("WEAPON_DAM", 0),
            "vitality": st.pop("CON", 0),
            "defense": st.pop("DEF", 0),
            "resistance": st.pop("RES", 0),
        }

    # ---- the four grades: one base block, and the attack rate a limit break adds
    base, grades = None, []
    for name, item_id in VAMBRACE:
        item = items[item_id]
        assert item["quality"] == quality, f"the {name} vambrace hones on its own table"
        st = named(item_static[f"{item['static0']}#{item['grade']}"])
        row = block(st)
        rate = st.pop("BASE_DAMAGE_RATE", 0)       # 0.01% units, like every rate
        assert not st, f"unread stat on the {name} vambrace: {st}"
        if base is None:
            base = row
        assert row == base, f"the {name} vambrace's base stats differ from the epic one's"
        grades.append({"grade": name, "itemId": item_id, "basicAttackRate": rate})

    # ---- the honing table, +1 to +25
    levels = {0: dict(block({}), basicAttack=0)}
    recipe, limit_break, spent = {}, {}, 0
    by_id = {item_id: name for name, item_id in VAMBRACE}
    for lv in range(1, VAMBRACE_MAX + 1):
        q = item_quality[f"{quality}#{100 + lv}"]
        c = enhance[q["common"]]
        st = named(q["stats"])
        row = block(st)
        row["basicAttack"] = st.pop("BASE_DAMAGE_ADDEND", 0)
        assert not st, f"unread stat on the vambrace at +{lv}: {st}"
        levels[lv] = row
        recipe[lv] = {
            "mats": q["mats"],
            "gold": c["money"].get("2", 0),
            "silver": c["money"].get("1", 0),
            "shards": c["money"].get("18", 0),        # a tap
            # The level's own growth: `exp` is the piece's gear XP, cumulative
            # and fed in shards one for one, so a level costs the difference
            # once, before the first tap.
            "growShards": c["exp"] - spent,
            "success": c["success"],                  # 0.01% units
            "failBonus": c["failBonus"],
            "failMax": c["failMax"],
            # two breaths, each with its own count; the cap is on their sum
            "juices": [{"id": str(a["id"]), "rate": scaled(a["rate"], div), "max": a["max"]}
                       for a in c["additive"]],
            "juiceMax": scaled(c["additiveMax"], div),
            "artisanThreshold": c["threshold"],
        }
        spent = c["exp"]
        # The feed hangs a limit break on the first level past it (+11, +16,
        # +21); the baked file keys it by the level it is done at.
        lb = c.get("limitBreak")
        if lb:
            entry = {"to": by_id[str(lb["changeId"])],
                     "cost": {"id": str(lb["itemId"]), "amount": lb["itemAmount"]}}
            if lb.get("replaceItemId"):
                entry["or"] = {"id": str(lb["replaceItemId"]),
                               "amount": lb["itemAmount"] // lb["replaceRatio"]}
            limit_break[lv - 1] = entry

    caps = sorted(limit_break)
    assert len(caps) == len(VAMBRACE) - 1, f"expected three limit breaks, found {caps}"
    for i, grade in enumerate(grades):
        grade["from"] = caps[i - 1] if i else 0
        grade["to"] = caps[i] if i < len(caps) else VAMBRACE_MAX
        if i:
            assert limit_break[caps[i - 1]]["to"] == grade["grade"], "limit breaks out of order"

    mat_ids = []
    for entry in limit_break.values():
        for part in (entry["cost"], entry.get("or")):
            if part and part["id"] not in mat_ids:
                mat_ids.append(part["id"])
    return {
        "source": {
            "feed": BASE,
            "patch": PATCH,
            "mode": "Vambrace — one honing table, +1 to +25, across four grades",
            "item": first["name"],
        },
        "maxLevel": VAMBRACE_MAX,
        "base": base,
        "grades": grades,
        "limitBreak": limit_break,
        "materials": [{"id": i, "name": items[i]["name"]} for i in sorted(mat_ids)],
        "stats": levels,
        "recipe": recipe,
    }


def main():
    stats = load_json("stats.json", GAME["stats"])
    items = {}
    for key in ("items", "items1", "items2"):
        items.update(load_json(f"{key}.json", GAME[key]))
    js_src = io.open(fetch(TOOLS_JS, "tools.js"), encoding="utf-8", errors="replace").read()
    enum = stat_enum(js_src)

    item_quality = stats["itemQuality"]
    item_level = stats["itemLevel"]
    enhance = stats["enhanceCommon"]
    div = additive_divisor(
        enhance[item_quality[f"{items[T4_UPPER['weapon']]['quality']}#112"]["common"]])
    # Before anything is written: a cache from before the patch stops here.
    vambrace = bake_vambrace(stats, items, enum, div)

    def stats_of(rows, want):
        for s in rows or []:
            if enum.get(s["stat"]) == want:
                return s["value"]
        return 0

    def gear_curve(slot, want):
        """Per honing level: ilvl base stat, and the extra per-level block."""
        item = items[T4_UPPER[slot]]
        out = {}
        for lv in range(0, 26):
            ilvl = BASE_ILVL + ILVL_PER_LEVEL * lv
            base = stats_of(item_level.get(f"{item['levelOption']}#{ilvl}"), want)
            row = item_quality.get(f"{item['quality']}#{100 + lv}")
            extra = stats_of(row["stats"], want) if row else 0
            out[lv] = {"ilvl": ilvl, "base": base, "extra": extra}
        return out

    def recipe(slot):
        item = items[T4_UPPER[slot]]
        out = {}
        for lv in range(1, 26):
            q = item_quality[f"{item['quality']}#{100 + lv}"]
            c = enhance[q["common"]]
            assert len(c["additive"]) == 1, f"{slot} +{lv} takes more than one breath"
            add = c["additive"][0]
            out[lv] = {
                "mats": q["mats"],
                "gold": c["money"].get("2", 0),
                "silver": c["money"].get("1", 0),
                "shards": c["money"].get("18", 0),
                "success": c["success"],          # 0.01% units
                "failBonus": c["failBonus"],      # added per fail
                "failMax": c["failMax"],          # cap on the fail bonus
                "juice": {"id": str(add["id"]), "rate": scaled(add["rate"], div), "max": add["max"]},
                "juiceMax": scaled(c["additiveMax"], div),
                "artisanThreshold": c["threshold"],  # cumulative success for a free one
            }
        return out

    # Every armor slot shares one recipe; assert it rather than trust it.
    armor_recipes = {s: recipe(s) for s in ARMOR_SLOTS}
    first = armor_recipes[ARMOR_SLOTS[0]]
    for slot in ARMOR_SLOTS[1:]:
        assert armor_recipes[slot] == first, f"{slot} recipe differs from head"

    # The set ids above are one class's copy; every class's copy carries the same
    # numbers under its own main stat, so read whichever of the three is present.
    probe = item_level[f"{items[T4_UPPER['torso']]['levelOption']}#{BASE_ILVL}"]
    main_stat = next(
        enum[s["stat"]] for s in probe if enum.get(s["stat"]) in ("STR", "AGI", "INT")
    )
    baked = {
        "source": {
            "feed": BASE,
            "patch": PATCH,
            "mode": "T4 Upper (1675) — normal honing",
            "set": items[T4_UPPER["weapon"]]["name"].rsplit(" ", 1)[0],
        },
        "baseIlvl": BASE_ILVL,
        "ilvlPerLevel": ILVL_PER_LEVEL,
        "materials": [
            dict(m, name=items[m["id"]]["name"]) for m in MATERIALS
        ],
        "weapon": {
            "recipe": recipe("weapon"),
            "weaponPower": gear_curve("weapon", "WEAPON_DAM"),
        },
        "armor": {
            "recipe": first,
            "slots": ARMOR_SLOTS,
            "mainStat": {s: gear_curve(s, main_stat) for s in ARMOR_SLOTS},
        },
    }

    # ---- karma ----------------------------------------------------------
    # Three boards; ranks 1-5 cap at level 21 and rank 6 carries 21..30.
    # Per level: `prob` is the base success rate and `care` the karma energy a
    # failure banks, both in 0.01% units of a 100% bar. See docs/research/karma.md.
    karma = {}
    for board_id, board in stats["karma"].items():
        levels = {}
        for rank in board["ranks"].values():
            for lv, row in rank["levels"].items():
                levels[lv] = {
                    "gold": row["money"].get("2", 0),
                    "mats": row["mats"],
                    "successRate": row["prob"],
                    "energyPerFail": row["care"],
                    "stats": [
                        {"stat": enum.get(s["stat"], s["stat"]), "value": s["value"]}
                        for s in row["stats"]
                    ],
                }
        karma[board_id] = {
            "name": re.sub(r"<[^>]+>", "", board["name"]),
            "openCost": {"gold": board["money"].get("2", 0), "mats": board["mats"]},
            "rankBonus": {
                rid: [
                    {"stat": enum.get(s["stat"], s["stat"]), "value": s["value"]}
                    for s in rank["stats"]
                ]
                for rid, rank in board["ranks"].items()
            },
            "levels": levels,
        }

    # ---- the lower (1590) track, keyed by item level ----------------------
    def lower_curve(slot, want):
        item = items[T4_LOWER[slot]]
        return {ilvl: stats_of(item_level.get(f"{item['levelOption']}#{ilvl}"), want)
                for ilvl in range(LOWER_BASE_ILVL, LOWER_MAX_ILVL + 1)}

    lower = {
        "source": {
            "feed": BASE,
            "patch": PATCH,
            "mode": "T4 lower (1590) — item level is 1590 + 5 x honing + advanced honing",
            "set": items[T4_LOWER["weapon"]]["name"].rsplit(" ", 1)[0],
        },
        "baseIlvl": LOWER_BASE_ILVL,
        "maxIlvl": LOWER_MAX_ILVL,
        "ilvlPerLevel": ILVL_PER_LEVEL,
        "weapon": {"weaponPower": lower_curve("weapon", "WEAPON_DAM")},
        "armor": {"slots": ARMOR_SLOTS, "mainStat": {s: lower_curve(s, main_stat) for s in ARMOR_SLOTS}},
    }

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "honing-t4lower.json"), "w", encoding="utf-8") as f:
        json.dump(lower, f, indent=1, sort_keys=True)
    print(f"wrote {os.path.join(DATA, 'honing-t4lower.json')}")
    with open(os.path.join(DATA, "karma.json"), "w", encoding="utf-8") as f:
        json.dump(karma, f, indent=1, sort_keys=True)
    print(f"wrote {os.path.join(DATA, 'karma.json')}")

    out = os.path.join(DATA, "honing-t4upper.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(baked, f, indent=1, sort_keys=True)
    print(f"wrote {out}")
    with open(os.path.join(DATA, "vambrace.json"), "w", encoding="utf-8") as f:
        json.dump(vambrace, f, indent=1, sort_keys=True)
    print(f"wrote {os.path.join(DATA, 'vambrace.json')}")
    print(f"  breath rates divided by {div} (the feed's unit, read off weapon +12)")

    # Cross-check against bebkok's Serca sheet (the bracelet calculator's baseline).
    checks = [
        ("torso", main_stat, 0, 57614), ("torso", main_stat, 25, 111477),
        ("weapon", "WEAPON_DAM", 0, 124793), ("weapon", "WEAPON_DAM", 25, 241367),
        ("hands", main_stat, 0, 86421), ("hands", main_stat, 25, 167216),
    ]
    for slot, want, lv, expect in checks:
        got = gear_curve(slot, want)[lv]["base"]
        flag = "ok " if got == expect else "MISMATCH"
        print(f"  {flag} {slot} +{lv} {want}: {got} (bebkok {expect})")


if __name__ == "__main__":
    main()
