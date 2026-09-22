# The reference character

One character, two axes. Every tool in the family — the GPD chart, the bracelet
calculator, the accessory calculator, the astrogem calculator — should score
against this same build, so a number moved in one tool means the same thing in
the next.

Owner's spec, taken as given (2026-08-14):

| | |
|---|---|
| Item level | **1785** — T4 Upper "Serca", weapon +25, gloves +23, rest +21 |
| Damage gems | all **level 9** |
| Accessories | high/high, max main stat, **no flat rolls** |
| Ability stone | **9-7** → the +1.5% basic attack power bonus applies |
| Crit | **90% rate, 280% damage** (a crit deals 2.8×) |
| Ark grid side nodes | **60** on each of the three |
| Ark grid cores | **20 points, Ancient, on all six** |
| Party | three damage dealers (self + 2 allies for a DPS; 3 allies for a support) |

The item level checks out: (1800 + 1790 + 4 × 1780) / 6 = **1785.0** exactly,
from `data/honing-t4upper.json` (`ilvl` fields at +25, +23, +21).

---

## 0. Correction first: which grade is Ancient

**The brief says Maxroll's `arkCore.grade` 2 is Ancient. It is Relic.**

Every ark core exists in four grades. From `tools/.cache/items.json`, the Chaos
Star weapon core family:

| item id | item `grade` | `arkCore.grade` | `gemPoints` | reads as |
|---|---|---|---|---|
| 673121003 | 3 | 0 | 9 | Epic |
| 673121004 | 4 | 1 | 12 | Legendary |
| 673121005 | 5 | 2 | 15 | **Relic** |
| 673121006 | 6 | 3 | 17 | **Ancient** |

Three independent checks agree:

1. **bebkok's own sheet.** Tab "Ark Grid Cores" carries both grades side by
   side. `F49` (Relic) reads "Weapon power +1.50% and +2600"; `F59` (Ancient)
   reads "Weapon power +2.25% and +3900". Those are exactly Maxroll's grade 2
   and grade 3 texts.
2. **Order cores.** `'Ark Grid Cores'!I4:I5` — "identity damage buff +6.5%
   (Relic)" and "+10% (Ancient)". Maxroll's Brave Pulse gives +6.5% at grade 2
   and +10.0% at grade 3.
3. **Gem budget.** The astrogem calculator packs "5+5+4+3 = 17 budget per core"
   (`~/loastuff/loa-astrogem-calc/METHODOLOGY.md` §1). 17 is the Ancient core's
   `gemPoints`. Relic holds 15.

**The stacking rule itself is confirmed.** bebkok sums every threshold line,
including the 17-point one: `'Sup buff calc v3.81'!EZ26 = SUM(EZ3:EZ24) = 3900`
and `FA26 = SUM(FA3:FA24) = 0.0294`, built from `EZ19 = 1300`, `EZ21 = 2600`,
`FA20 = 0.0075`, `FA21 = 0.015`, `FA22:FA24 = 0.0023` each. So the owner's
reading of the mechanic is right — the character it describes is one grade
short.

The 3,900 / 2.94% pair the owner matched is therefore the **Relic** weapon core.
The Ancient one is **5,200 flat and 3.69%**.

(Why they looked alike: for four of the twelve cores the Ancient 17-point line
happens to equal the sum of the Relic 10 + 14 + 17 lines. Coincidence of
tuning — it fails on Faith Enhancement and Smoldering Strike, so do not lean on
it.)

---

## 1. Every core at 20 points, Ancient

Read from `tools/.cache/items.json` (`arkCore.bonuses` → `id`) against
`tools/.cache/stats.json` `arkGridCoreOptions[id].desc`. Every threshold from 10
to 20 is live at 20 points and they add.

### DPS chaos cores

**Chaos Sun — Flashy Attack** (`673100006`)

| pts | line |
|---|---|
| 10 | On Crit Hit, Damage to foes +0.55% |
| 14 | Damage to foes +0.50% |
| 17 | Damage to foes +1.50%. On Crit Hit, Damage to foes +1.10% |
| 18/19/20 | Damage to foes +0.16% each |

**Total: Damage to foes +2.48%; on-crit-hit damage +1.65%.**
At 90% crit / 2.8× the crit rider is worth `(1 + 0.9·(2.8·1.0165 − 1)) /
(1 + 0.9·(2.8 − 1)) = +1.587%`, so the core lands **+4.11% damage** overall
(4.026 in house log units).

**Chaos Star — Attack** (`673120006`)

| pts | line |
|---|---|
| 10 | Atk. Power +900 |
| 14 | Atk. Power +0.55% |
| 17 | Atk. Power +1.65% and +2700 |
| 18/19/20 | Atk. Power +0.16% each |

**Total: +3,600 flat attack power, +2.68% attack power.**
(Relic, for contrast: +2,700 and +2.13% — the pair the astrogem calculator's
DPS defaults carry today.)

**Chaos Moon — Smoldering Strike** (`673110006`)

| pts | line |
|---|---|
| 10 | Burn on hitting Boss+ for 6.0s |
| 14 | Damage to Boss+ +0.50% |
| 17 | Damage to Boss+ +2.00%. Burn Damage +150% |
| 18/19/20 | Damage to Boss+ +0.16% each |

**Total: Damage to Boss or higher +2.98%**, plus a burn DoT at 150%. The burn
is not quantified anywhere in the data — treat it as unmodelled.

### DPS order cores — unconfirmed, and not resolvable from the data

Order cores are **class- and build-specific**. All 522 Ancient order cores in
`items.json` carry a class skill payload at 17 points, not a generic stat. There
is no class-agnostic best in slot, so the tools cannot hardcode one.

What is generic is the shape. Every Ancient order core runs: a 10-point line, a
Destiny trigger at 14, the big class payload at 17, and three small increments
at 18/19/20. Counting those increments across all 522 cores, the commonest is
**Damage to foes +0.2%** (63 of them, so 21 cores), then +0.16% (45, so 15
cores), with class-skill variants at +0.15%–0.30%.

**What I would use, pending the owner naming his class:** treat the three DPS
order cores as **+0.60% damage to foes each — +1.80% total** (the 3 × 0.2%
pattern), and leave the 10- and 17-point payloads as a per-class input the model
does not guess. Marked **UNCONFIRMED**; it is a floor, not a best guess at the
real total, because the 17-point payload is usually the biggest single line on
the core (examples in the data run from "Damage to foes +19% while in Normal
Mode" to "Flurry Skill Damage +25% for 30s").

### Support order cores

**Order Sun — Brave Accent** (`673004326`)

| pts | line |
|---|---|
| 10 | Ally Atk. Power Enhancement +1.3% |
| 14 | Destiny: Grave — Max HP +10000, 60s |
| 17 | Destiny: Brave Accent — Serenade of Courage Ally Damage Enhancement **+10.0%**, 60s |
| 18/19/20 | Ally Atk. Power Enhancement +0.15% each |

**Total: Ally Attack Power Enhancement +1.75%**, plus **+10.0%** into the
Serenade bracket only, plus Max HP +10,000. (Relic gives +6.5% at 17.)

**Order Moon — Brave Pulse** (`673014326`)

| pts | line |
|---|---|
| 10 | Ally Damage Enhancement +1.5% |
| 14 | Guardian Tune activates Destiny |
| 17 | Serenade of Courage Ally Damage Enhancement **+10.0%** |
| 18/19/20 | Ally Damage Enhancement +0.17% each |

**Total: Ally Damage Enhancement +2.01%**, plus **+10.0%** into the Serenade
bracket only.

**Order Star — Buckshot Acceleration** (`673025326`)

| pts | line |
|---|---|
| 10 | Rhythm Buckshot stacks to 2 |
| 14 | On counter: full stacks + 500 Serenade Meter |
| 17 | Serenade Meter from Rhythm Buckshot +12.0% |
| 18/19/20 | Serenade Meter from Rhythm Buckshot +1.0% each |

**Total: Serenade meter gain +15.0% on one skill.** No direct buff line — it
pays through Serenade uptime, which the model handles as the `upSeren` input.
Contributes **zero** to the buff bases.

### Support chaos cores

**Chaos Sun — Faith Enhancement** (`673103006`)

| pts | line |
|---|---|
| 10 | Specialty Meter Gain +0.60% |
| 14 | Ally Damage Enhancement +0.70% |
| 17 | Ally Damage Enhancement +2.80%. Specialty Meter Gain +1.80% |
| 18/19/20 | Ally Damage Enhancement +0.20% each |

**Total: Ally Damage Enhancement +4.10%, identity meter gain +2.40%.**
(Relic: +2.50% and +2.00%.)

**Chaos Moon — Echoing Brand** (`673113006`)

| pts | line |
|---|---|
| 10 | On Brand: target takes +0.10% damage from you and party, 15s |
| 14 | Brand Power +1.20% |
| 17 | Brand Power +3.60%. On Brand: +0.40% damage taken |
| 18/19/20 | Brand Power +0.40% each |

**Total: Brand Power +6.00%**, plus a **+0.50%** party damage-taken debuff.
(Relic: +4.80% and +0.30%.)

**Chaos Star — Weapon** (`673121006`)

| pts | line |
|---|---|
| 10 | Weapon Power +1300 |
| 14 | Weapon Power +0.75% |
| 17 | Weapon Power +2.25% and +3900 |
| 18/19/20 | Weapon Power +0.23% each |

**Total: +5,200 flat weapon power, +3.69% weapon power.**
(Relic: +3,900 and +2.94% — what `model/gear.js` ships today.)

---

## 2. What 60 points on a side node is worth

The game carries an explicit table. `stats.json` `arkGridGemOptions` is keyed
`"<optionId>#<level>"`, levels 1 to 120, values in hundredths of a percent.

| node | option id | **level 60** | level 30 | level 50 | level 80 | per level |
|---|---|---:|---:|---:|---:|---:|
| Attack Power | 2001 | **2.20%** | 1.10% | 1.83% | 2.93% | 0.0367 |
| Additional Damage | 2002 | **4.85%** | 2.42% | 4.04% | 6.46% | 0.0808 |
| Boss Damage | 2003 | **5.00%** | 2.50% | 4.16% | 6.66% | 0.0833 |
| Ally Damage Enh. | 2011 | **3.15%** | 1.57% | 2.62% | 4.20% | 0.0525 |
| Brand Power | 2012 | **10.00%** | 5.00% | 8.33% | 13.33% | 0.1667 |
| Ally Atk. Power Enh. | 2013 | **7.80%** | 3.90% | 6.50% | 10.40% | 0.1300 |

Boss Damage is the odd one: its value sits in the record's own `value` field,
not in `stat.value`, because it is a combat effect
(`"2003#60": {"name":"Boss Damage", ..., "stat":{"index":622003060,"value":0}, "value":500}`).

**Two independent confirmations that this table is the right one:**

- bebkok's astrogem panel, `'Sup buff calc v3.81'` `Z4:AB6` — brand 90 nodes →
  `AB4 = 0.15`, ally AP 60 nodes → `AB5 = 0.078`, ally damage 60 nodes →
  `AB6 = 0.0315`. All three match the table exactly at those levels.
- The bracelet calculator already carries `ADD_DMG_ASTROGEM_LV60 = 0.0484`
  (`~/loa-bracelet-calc/model/bracelet.js:130`). The table says 0.0485. **Use
  0.0485** — 0.0484 is a linear-interpolation rounding (8.083 × 60 = 484.98).

### Relation to the astrogem model's damage constants

The astrogem calculator does not score a whole node; it scores **one more
level** on top of a full grid, and its `STAT_BASELINES` fix the grid at level
30 (`gridAdd` 0.011 / 0.0242 / 0.025 = exactly the table's level-30 values).
That is where 0.032386 / 0.059287 / 0.081268 come from. The 0.0325 / 0.0598 /
0.0823 in the brief are the older 30-level-average constants, retired on
2026-08-10 (astrogem `METHODOLOGY.md`, "Historical note").

**Neither set is wrong, but neither describes a 60-node grid.** The per-level
marginal at level 60 is smaller than at level 30, because the same increment
lands on a bigger bucket. If the tools are to price node levels on this
reference character, `STAT_BASELINES[*].levels` should read **60** and `gridAdd`
should read **0.0220 / 0.0485 / 0.0500**. Flagging rather than changing: that
touches the astrogem grade ladder, which is out of scope here.

### Is 60/60/60 reachable?

Six cores × 20 order/chaos points, four gems each at order 5 = **24 gems**, two
effects apiece at level 1–5 → 240 effect levels at most. A perfect DPS grid
built 8 × c8 / 8 × c9 / 8 × c10 reaches **80/80/80**. So 60/60/60 (180 levels)
is a realistic, not a ceiling, grid — about 75% of perfect. Consistent with the
owner calling it his character rather than his goal.

---

## 3. DPS profile

Mirrors `~/loa-bracelet-calc/model/bracelet.js` `DEFAULT_PROFILE`.

| field | ships today | **reference** | source |
|---|---:|---:|---|
| `ilvl` | 1785 | **1785** | ✓ |
| `mainStatRaw` | 703,826 | **703,826** | ✓ |
| `weaponPowerRaw` | 241,367 | **241,367** | ✓ |
| `msPct` | 0.09 | **0.09** | ✓ |
| `wpPct` | 0.085 | **0.085** | see note |
| `baseApPct` | 0.125 | **0.2048** | see below |
| `flatAP` | 2,700 | **3,600** | Ancient Chaos Star Attack |
| `flatWP` | 0 | **0** | ✓ — no weapon core, no flat accessory rolls |
| `addDamage` pool | 0.3844 | **0.3845** | see below |
| `skills` | 0.90 / 2.8 | **0.90 / 2.8** | ✓ |

`mainStatRaw` already reproduces the spec exactly:
armour 629,835 (head 126,236 + shoulders 134,351 + torso 100,989 + legs 109,104
at +21, hands 159,155 at +23, from `data/honing-t4upper.json`) + accessories
71,429 + base 477 + roster 2,085 = **703,826**. Nothing to change.

**`addDamage` components:**

| component | value | source |
|---|---:|---|
| `weaponQuality` | 0.30 | 100-quality weapon |
| `pet` | 0.01 | |
| `astrogemLv60` | **0.0485** | node table, level 60 (was 0.0484) |
| `neck` | 0.026 | high Additional Damage necklace |
| **pool** | **0.3845** | |

**`baseApPct` — the one that moves.** Everything the game files as "Atk. Power
+X%" shares one additive bucket:

| source | value |
|---|---:|
| 11 damage gems, level 9 | **0.1100** |
| ability stone 9-7 | 0.0150 |
| accessories — two high Attack Power % earrings, 1.55 each | 0.0310 |
| ark grid Chaos Star Attack core, Ancient, 20 pts | 0.0268 |
| ark grid Attack Power side node, level 60 | 0.0220 |
| **total** | **0.2048** |
| *Adrenaline relic book lv7, if the reference carries it* | *+0.0900 → 0.2948* |

The level-9 gem figure is now nailed down: bebkok's gem table
(`'DataHidden'!C12:E12`) gives **AP% 0.010 at level 9**, 0.012 at level 10. So
the bracelet calculator's "11 × lv9 damage gems (1.0% ea)" comment is right, and
11.00% is correct for this character. The stone is confirmed the same way
(`'Accessories'!B77:C77` — "9/7 and better" → 0.015).

**Three problems worth naming:**

1. `baseApPct = 0.125` omits the accessories, the ark grid core and the side
   node — 8.0 percentage points of bucket. That is not cosmetic: a bigger
   bucket dilutes every flat-AP bracelet line and shrinks the marginal worth of
   an AP-% one.
2. The astrogem calculator's DPS defaults say the same bucket is **13.33%**
   (Adrenaline 9 + accessories 3.1 + Relic cores 2.13, but no gems and no
   stone). The two tools disagree about which sources are even in it.
3. Adrenaline is not in the owner's spec. It is on every real DPS. **Decide
   once and put it in both tools**; I would carry it, at 0.2948.

Resulting attack power, `sqrt(MS·WP/6)·(1+baseApPct) + flatAP`:

| profile | AP |
|---|---:|
| as shipped (0.125 / 2,700) | 208,562 |
| reference (0.2048 / 3,600) | **224,065** |
| reference + Adrenaline (0.2948 / 3,600) | 240,534 |

**Buckets the spec creates that `DEFAULT_PROFILE` has no field for.** These are
real damage on this character and are currently scored nowhere:

| bucket | value | made of |
|---|---:|---|
| Damage to foes (outgoing) | **+4.48%**, +1.65% of it crit-only | Flashy Attack 2.48 + necklace Outgoing Damage 2.00, plus the crit rider |
| Damage to Boss or higher | **+7.98%** | side node lvl 60 5.00 + Smoldering Strike 2.98 |
| order-core outgoing | +1.80% (UNCONFIRMED) | 3 × 0.60, the 18/19/20 pattern |

---

## 4. Support profile

Mirrors `model/gear.js` and `model/support.js`.

### `gear.js`

| field | ships today | **reference** | why |
|---|---:|---:|---|
| `accessoryWpFlat` | 2,400 | **0** | spec says no flat rolls |
| `arkGridWpFlat` | 3,900 | **5,200** | Ancient, not Relic |
| `feastWpFlat` | 2,400 | **2,400** | ✓ |
| `braceletWpFlat` | 0 | **0** | ✓ |
| `earringWpPct` | 0.06 | **0.06** | two high Weapon Power % primaries, 3.00 each |
| `arkGridWpPct` | 0.0294 | **0.0369** | Ancient |
| `karmaWpPct` | 0.021 | **0.021** | level 21; see note |
| `accessoryMainStat` | 66,000 | **71,429** | same accessories as the DPS: 17,857 + 2 × 13,889 + 2 × 12,897 |
| `rosterMainStat` | 2,085 | **2,085** | ✓ |
| `levelMainStat` | 477 | **477** | ✓ |
| `foodMainStat` | 12,000 | **12,000** | ✓ |
| `skinMsPct` / `strongholdMsPct` | 0.08 / 0.01 | **unchanged** | ✓ |
| `stoneApPct` | 0.015 | **0.015** | ✓ |
| `gemApPct` | 0.132 | **0.110** | 11 gems at **level 9** (0.010), not level 10 (0.012) |

Resulting stats, with armour at the spec levels:

```
wpFlat = 241,367 + 0 + 5,200 + 2,400              = 248,967
wpPct  = 0.06 + 0.0369 + 0.021                    = 0.1179
WP     = 248,967 × 1.1179                         = 278,320
msFlat = 71,429 + 2,085 + 477 + 12,000 + 629,835  = 715,826
MS     = 715,826 × 1.09                           = 780,250
basic AP = sqrt(WP·MS/6) × (1 + 0.015 + 0.110)    = 214,026
```

As shipped, `gear.js` gives WP 277,674 / MS 774,333 / basic AP 217,130. The
reference is 1.4% lower on basic attack power, almost entirely the gem level.

**One reading to confirm: the support's second earring line.** "No flat rolls"
kills `accessoryWpFlat`, which is what bebkok's own character carries there
(`'Sup buff calc v3.81'!CR13 = 960`). That leaves the earring's *other* primary
open. The accessory calculator lists only Weapon Power % as a support earring
primary, so I have taken high/high to mean two Weapon Power % lines and nothing
else — `earringWpPct` 0.06, `accessoryWpFlat` 0. If the intended reading is
Weapon Power % **and** Attack Power % at high on each earring, the support also
gains **+3.10% attack power**, the AP bucket becomes 0.156, and basic AP rises
to **219,924** — with every ap-channel step behind it.

**Karma is not in the owner's spec.** `gear.js` runs 2.1% (Karmic Enlightenment
level 21), the bracelet calculator runs 2.5% (level 25), bebkok's own character
runs 3.0% (level 30, `'Sup buff calc v3.81'!CS28`). At level 30 the reference
support reads WP 280,561 and basic AP 214,886. **Pick one and use it in both
tools.**

### `support.js` buff bases — and whether the ark grid spec moves them

The owner asked to keep the accessory calculator's bases unless the ark grid
spec contradicts them. **It does.** Here is the proof, because the bases turn
out to decompose exactly.

The accessory calculator's `METHODOLOGY.md` names an ark grid share inside each
base. Every one of them reconstructs to the last hundredth from side nodes at
**level 50** and **Relic** chaos cores:

| base | claimed ark grid share | decomposes as | check |
|---|---:|---|---|
| ally atk enh 68.25 | 8.25 | node lvl 50 **6.50** + Brave Accent 1.75 | 8.25 ✓ |
| brand 43.13 | 13.13 | node lvl 50 **8.33** + Echoing Brand **Relic** 4.80 | 13.13 ✓ |
| ally dmg (t-skill) 7.13 | 7.13 | node lvl 50 **2.62** + Brave Pulse 2.01 + Faith Enh **Relic** 2.50 | 7.13 ✓ |
| ally dmg (identity) 37.13 | 27.13 + gems 10 | 7.13 + Brave Accent 10 + Brave Pulse 10 | 27.13 ✓ |

Four exact hits is not luck. The bases were built for **side nodes at 50 and
Relic chaos cores** (with the two order cores' 17-point Serenade lines already
at their Ancient +10% value). The owner's spec is nodes at 60 and Ancient
everywhere, so three of the four bases move:

| base in `support.js` | current | **reference** | change | made of |
|---|---:|---:|---:|---|
| `brandPower` | 43.13 | **46.00** | +2.87 | node60 10.00 + Echoing Brand Ancient 6.00, on the same non-grid 30.00 |
| `allyAtkEnh` | 68.25 | **69.55** | +1.30 | node60 7.80 + Brave Accent 1.75, on the same non-grid 60.00 |
| `allyDmgT` | 7.13 | **9.26** | +2.13 | node60 3.15 + Brave Pulse 2.01 + Faith Enh Ancient 4.10 |
| `allyDmg` | 37.13 | **39.26** | +2.13 | 9.26 + Brave Accent 10 + Brave Pulse 10 + gems 10 |

Unchanged, as the owner asked: `spec` 1100, `classCoeff` 0.0005005722461,
`upBrand` 100, `upAp` 95, `upSeren` 70, `upChord` 70, `upTskill` 40,
`partySize` 3.

Also unchanged and still right: the non-grid parts the methodology lists —
evolution T4 44 + gems 10 + bracelet 6 = 60 for ally attack enhancement;
evolution T4 4 + karmic rank 6 + karmic T4 20 = 30 for brand; gems 10 for the
identity bracket.

**Net effect.** Old bases with the old gear against new bases with the new gear:
**+0.340% party damage per dealer** (`100·ln(new/old)` through
`Support.contribution`), so about **+1.02%** across a three-dealer party. Small,
but it is the whole reason the accessory rankings are stable — a base that moves
2 points changes the marginal worth of every ring line that lands in that
bracket.

**One thing the reference support gains that no tool scores:** Echoing Brand
Ancient carries a **+0.50% party damage-taken debuff** (0.10 at 10 points, 0.40
at 17). It is a clean multiplicative bucket on the whole party's damage and it
belongs in the support contribution alongside `brand`. Not added here — that is
a model change, not a spec.

---

## 5. What is still open

1. **The DPS order cores.** Class-specific, not named, not resolvable from the
   data. The +1.80% floor above is a placeholder. Naming the class settles it in
   one lookup.
2. **Adrenaline.** 9% of attack-power bucket, on every real DPS, in neither the
   owner's spec nor the bracelet profile, but in the astrogem baselines. Needs a
   ruling.
3. **Karma level.** Three tools, three values (2.1 / 2.5 / 3.0%).
4. **The burn on Smoldering Strike** and the **Serenade meter gain** on Buckshot
   Acceleration and Faith Enhancement. Both are real damage; neither has a
   number in the data. The meter gain at least has a channel — it feeds
   `upSeren`, currently a flat 70%.
5. **The astrogem per-level constants** still assume a 30-level grid. Rerun
   against a 60-level grid (`levels: 60`, `gridAdd` 0.0220 / 0.0485 / 0.0500)
   they fall to 0.032074 / 0.058367 / 0.079334 — attack 0.96% lower, additional
   1.55%, boss 2.38%. Small, and left alone here on purpose: it moves the grade
   ladder.
6. **`useQualityBlock`** — still off, still unresolved (see `docs/METHODOLOGY.md`).

## Sources

- `tools/.cache/items.json` — every core in §1, by item id (`arkCore.bonuses`)
- `tools/.cache/stats.json` — `arkGridCoreOptions[id].desc` for the core text;
  `arkGridGemOptions["<id>#<level>"]` for the node table in §2
- `data/honing-t4upper.json` — gear stats and item levels
- bebkok's support buff calculator, sheet
  `1le-LqVr9l4dXxBDlPaSMNpf6tDVfvfsFE_QRIAmVONE`, tabs "Sup buff calc v3.81",
  "Ark Grid Cores", "Ark Grid Order/Chaos Cores raw data", "DataHidden",
  "Accessories" — cells cited inline
- `~/loa-bracelet-calc/model/bracelet.js`, `data/gear-data.js` — the DPS profile
- `~/loastuff/lost-ark-accessories/METHODOLOGY.md` — the support buff bases
- `~/loastuff/loa-astrogem-calc/METHODOLOGY.md`, `model/astrogem.js` — the ark
  grid damage constants

---

## Open item, 14 August 2026 — brand power is a point below the table

`model/support.js` ships `brandPower` 45.00, `allyAtkEnh` 68.55 and `allyDmg`
38.26 against the 46.00 / 69.55 / 39.26 in the table above. All three are
exactly one point low, and two of them are explained: the reference runs
**level-9 gems**, and the gem term in each of those two bases is worth its
level.

- ally attack: evolution T4 44 + gems **9** + bracelet 6 = 59, so 7.80 + 1.75 +
  59 = **68.55** ✓
- ally damage: 9.26 + Brave Accent 10 + Brave Pulse 10 + gems **9** = **38.26** ✓

Brand power has no gem term in its own breakdown — evolution T4 4 + karmic rank
6 + karmic T4 20 = 30, plus node60 10.00 and Echoing Brand Ancient 6.00, which
comes to **46.00**. So the shipped 45.00 is a point short with nothing to
account for it.

Worth **0.2619% party damage**, about the size of one whole ark grid band step,
so it is not noise. Either brand carries a gem term the breakdown omits, in
which case the table should say so, or 45.00 is a typo for 46.00. Left alone
until Shizu says which.

### And the split is not even

Separately: the reference is described as 60/60/60 on the side nodes, which is
reachable — six cores of four gems give 240 levels, so it is three quarters of
a perfect 80/80/80 — but it is the wrong **shape**. `tools/arkgrid-split.js`
puts one node level at 0.0689% party damage for ally attack enhancement against
0.0210% for ally damage enhancement, and the best split of a full grid at 120 /
120 / 0. See `docs/research/ark-grid.md`.
