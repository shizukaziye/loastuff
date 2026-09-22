#!/usr/bin/env python3
"""Pull Lost Ark game tables from Maxroll's planner feed and bake the small
derived files this tool ships.

Maxroll's upgrade calculator does not put its tables in the page; it loads them
from a planner data feed. Those files are the game's own tables, and the page
states which patch they track ("Up to date with July 2026 patch"). We cache the
big downloads under tools/.cache/ (gitignored) and commit only the small baked
JSON under data/.

Cross-check that keeps us honest: the `itemLevel` table reproduces bebkok's
Serca gear sheet exactly (chest 57,614 at +0 and 111,477 at +25; weapon 124,793
and 241,367), which is the same baseline the bracelet calculator uses.

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
            add = c["additive"][0]
            out[lv] = {
                "mats": q["mats"],
                "gold": c["money"].get("2", 0),
                "silver": c["money"].get("1", 0),
                "shards": c["money"].get("18", 0),
                "success": c["success"],          # 0.01% units
                "failBonus": c["failBonus"],      # added per fail
                "failMax": c["failMax"],          # cap on the fail bonus
                "juice": {"id": str(add["id"]), "rate": add["rate"], "max": add["max"]},
                "juiceMax": c["additiveMax"],
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
            "patch": "July 2026 (per maxroll's upgrade calculator)",
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

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "karma.json"), "w", encoding="utf-8") as f:
        json.dump(karma, f, indent=1, sort_keys=True)
    print(f"wrote {os.path.join(DATA, 'karma.json')}")

    out = os.path.join(DATA, "honing-t4upper.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(baked, f, indent=1, sort_keys=True)
    print(f"wrote {out}")

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
