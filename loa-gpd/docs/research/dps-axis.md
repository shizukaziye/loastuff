# The DPS axis

How `data/rows-dps.json` was built, 2026-08-14. Same systems as the support
chart, scored on what a damage dealer's own damage does. No model file and no
`index.html` was touched; `tools/verify.js` passes unchanged.

## The axis

```
D = 100 * ln(multiplier)        ~= percent damage, exactly additive
gold per 1% damage = gold / damage%
```

**No party multiplier.** A support's 1% lands on every dealer, so the support
chart divides by `partySize = 3`. A dealer's 1% lands on the dealer. The numbers
in `rows-dps.json` are therefore one character's own damage and must not be
multiplied by anything.

Damage comes from `loa-bracelet-calc/model/bracelet.js` — `attackPower`,
`critFactor`, `traitDamage`, `lineDamage` — which is the house authority for DPS
damage. Gold comes from the same places the support side takes it: `model/honing.js`,
`model/karma.js`, `model/gems.js`, `tools/bracelet-price.js`, the accessory
calculator and the astrogem cut engine.

## The reference character

`DEFAULT_PROFILE` with four overrides, as briefed:

| field | value | what it is |
|---|---|---|
| `wpPct` | 0.081 | 6% earring weapon-power lines + 2.1% karma at level 21 |
| `baseApPct` | 0.2948 | accessories, Ancient attack core, node 60, gems, stone, Adrenaline 7 |
| `flatAP` | 3600 | the Ancient **attack** core at 20 points — a DPS does not run the weapon core |
| `flatWP` | 0 | no flat weapon-power rolls |

Everything else is the shipped default: ilvl 1785, `mainStatRaw` 703,826,
`weaponPowerRaw` 241,367, `msPct` 0.09, 90% crit / 280% crit damage, ark grid
60/60/60 on attack power, boss damage and additional damage.

Attack power at that character is **240,097**.

## Row by row

### Honing — 28 rows, +11 to +25

Gold from `model/honing.js` at the briefed prices, so it is the same gold the
support chart shows; only the damage differs. Each step is measured against a
character sitting at the step's starting level, with only the track under test
moving — the support convention.

One thing that had to be got right: the reference build is **not** flat +25.
`loa-bracelet-calc/data/gear-data.js` puts the four armour pieces at +21, gloves
at +23 and the weapon at +25, which is what makes ilvl 1785 and `mainStatRaw`
703,826. So main stat at level L is rebuilt as
`703,826 − 629,835 + armourCurve(L)`, leaving 73,991 of accessories, base and
roster that honing never touches. The armour curve in `data/honing-t4upper.json`
and `GEAR.SERCA` are the same table — both read 686,778 at +25 — so the two
sources agree by construction.

| step | armour, five pieces | weapon |
|---|---:|---:|
| +11 → +12 | 1.192% | 1.373% |
| +16 → +17 | 1.072% | 1.213% |
| +24 → +25 | 1.097% | 1.217% |

The support anchor is 0.33% a level. A DPS honing level is worth **three to four
times** that, which is the whole story of the two axes: a support only ever hands
over 22% of its basic attack power, and only at 95% uptime.

The quality block stays off (`useQualityBlock: false`), matching the support side
and the bracelet calculator.

### Karma — 9 rows, Karmic Enlightenment 21 to 30

Weapon Power %, +0.10 a level, into `wpPct`. Gold from `model/karma.js` with the
energy-bar pity: 682,171g for the whole climb, the same figure `tools/verify.js`
checks. Damage runs 0.0455% at 21→22 down to 0.0452% at 29→30 — the levels get
cheaper in damage terms because the weapon-power percentages are one additive
pool, so the last 0.1 point lands on a bigger denominator. Support reads 0.01382
and 0.01375 on the same steps.

Karmic Evolution (Max HP) and Karmic Leap (Ultimate Awakening damage) are not
charted, same as the support side.

### Skill gems — 3 rows, all 11 gems, level 7 to 10

Gold from `model/gems.js`: one level-8 gem is 420,000g, each level is three of
the one below, so a set upgrade is `11 × 2 × gemGold(level)` — 3.08M, 9.24M,
27.72M. Identical to the support row.

Two damage terms, and the second is much the bigger:

| step | attack power | freed swiftness → crit | total |
|---|---:|---:|---:|
| lv7 → lv8 | 0.926% | 1.839% (76 points, +2.70 crit rate) | **2.765%** |
| lv8 → lv9 | 0.917% | 1.932% (79 points, +2.84 crit rate) | **2.850%** |
| lv9 → lv10 | 0.909% | 2.033% (84 points, +2.99 crit rate) | **2.942%** |

**What the freed stat should be: crit.** It barely matters, and that is worth
saying out loud. At 90% crit and 280% crit damage a trait point of crit is worth
0.02457 damage points and a trait point of spec is worth 0.02500 — **within 2% of
each other**. Crit is the pick because the DPS bracelet anchor is built on
crit + spec and crit converts exactly through the model rather than through a
class weight, but a class that wants spec loses nothing: 2.090% instead of
2.033% on the top rung.

**On the gem's own damage bonus.** For a DPS there is no separate third term, and
adding one would double-count. The 11 damage gems' own effect *is* the
attack-power percentage — 9.8% at level 9, 11% at level 10, 1.2 points a level,
which is what `model/gems.js` and `model/gear.js` both carry, and it is the first
column above. Flagged in the open questions: two other files in the house
disagree about the size of that number.

### Ability stone — 1 row, 7-7 → 9-7

**Yes, for a DPS it is just the +1.5%.** Drops of Ether is a support engraving and
does not exist on this axis. Nothing else on the stone is damage for a dealer:
the two positive engravings a DPS cuts feed no bucket in the model, the Vitality
step bonus at 14/15/16 nodes is Max HP, and the bonus does not grow above
combined level 5 — 9/9 and 10/10 pay exactly what 9/7 pays.

So the row is `baseApPct` 0.2798 → 0.2948: **1.148%**, against 0.458% for a
support. Gold is the support row's 14,167,000g unchanged — 704 uncut Ancient
stones above a 7-7, at 0.13793% per stone. The purchase and the odds are
identical on both axes; only what you get differs.

One gap is flagged below: the stone's **negative** engraving.

### Bracelet — 14 rows, D- to S+

The ladder is `loa-bracelet-calc/subrank.js`'s own: S+ 100.1, S 95, S- 90 and so
on down. The roll simulation is `tools/bracelet-axis.js`'s DPS branch, copied
line for line into the scratch harness so the two cannot disagree, and run over
**20 million bracelets**.

```
floor  (both traits at 40)                      1.978
anchor (three best mid families, traits 110)   18.286
span                                           16.308
```

16.308 damage points across the ladder, against 6.004 on support — the figure the
brief expects. A rank's damage is its share of that span, exactly as the support
rows do it: 5 ladder points is 0.815%, and the last rung (S 95 → S+ 100.1) is
0.832%.

Costing follows `tools/bracelet-price.js`: you buy an unrolled bracelet, whose
price is a pure function of the stat pair, and you use all seven rolls, so

```
cost(rank) = min over the stat pair of (listed(statSum) + 20 pheons) / P(hit)
P(hit)     = P( line damage >= rankTarget − traitDamage(crit, spec) )
gold(X→Y)  = cost(Y) − cost(X)
```

Pheons at 2,237g each, 44,737g for twenty.

| rank | buy crit/spec | listed | P(hit) | bracelets | cost | step |
|---|---|---:|---:|---:|---:|---:|
| D- | 61/108 | 2,697 | 89.19% | 1.1 | 53,186 | — |
| C- | 70/120 | 7,184 | 58.38% | 1.7 | 88,943 | 18,350 |
| B- | 78/120 | 11,954 | 20.22% | 4.9 | 280,308 | 103,527 |
| A- | 84/120 | 18,915 | 2.97% | 33.6 | 2,140,233 | 1,189,026 |
| S- | 93/120 | 42,650 | 0.137% | 729 | 63,732,317 | 46,966,061 |
| S+ | 86/120 | 22,352 | 0.0026% | 39,062 | 2,620,652,839 | 2,287,497,803 |

The last three rungs are marked "costs more than it is worth" in `detail`, as on
the support side.

### Ark grid — 12 rows, the whole grid

The astrogem calculator's DPS axis, `MODEL_SIG 12u9hug`, cut with the same
harness as `docs/research/ark-grid.md` Appendix A with `supportGrade → grade`,
`supportDamage → gemDamage` and `axis: "dps"`. Headline policy is the DPS twin of
the support headline: **advisor baseline 85, 2.5M gold per 1%**, 300,000 fresh
epic cuts at a 60:30:10 cost mix, duds fused, seed `gpd-2026-08-14`.

Grade to damage, least squares over the 5,400 legal DPS configs grading 50 or
better (Appendix B of the support note, DPS twin):

```
gemDamage% = 0.013443 * grade − 0.65699
=> 0.04436% a gem per 3.3-point band  (support: 0.00973% per dealer)
```

Reported **for the whole grid at twenty-four gems**, matching the support rows: gold
and damage both multiply by 12, so gold per damage is unchanged.

| step | Δ gold (12 gems) | Δ damage | gold per 1% | T1 (90/6M) | T3 (80/1M) |
|---|---:|---:|---:|---:|---:|
| ungraded → C- | 253,543 | 0.5324% | 476,262 | — | — |
| C- → C | 32,707 | 0.5324% | 61,438 | 58,684 | 50,411 |
| B- → B | 90,516 | 0.5324% | 170,029 | 141,921 | 138,756 |
| A- → A | 323,560 | 0.5324% | 607,787 | 556,845 | 539,412 |
| A+ → S- | 1,649,429 | 0.5324% | 3,098,347 | 1,460,453 | 4,133,331 |
| S- → S | 6,393,241 | 0.5324% | 12,009,295 | 5,977,965 | 16,874,769 |
| S → S+ | 17,625,304 | 0.4517% | 39,020,149 | 20,440,244 | 55,098,605 |

Same shape as the support row: near-linear to A-, then the cost multiplies every
band, and above A+ it is a different economy. The DPS S+ cut is 96.1, so the
S → S+ band is 2.8 grade points wide rather than 3.3 — narrower than a full band,
which lifts its gold-per-damage by about a fifth as a scale artefact.

The astrogem repo's convention that **raw gems are free** carries over, and it
does all the work at the top: an S+ hit at the headline policy eats **419 raw
astrogems**. Any single gold number for the top rungs is really a statement about
how many astrogems you can farm.

### Accessories — 185 rows, neck 87 / earring 45 / ring 53

The DPS market, not the support one. Every line set is enumerated — both
primaries at low, mid, high or absent, plus a third slot holding a flat line
(absent, or Attack Power+ / Weapon Attack Power+ at each tier) — across all five
main-stat quintiles. 560 configurations a slot. Gold is
`accessory_value.value_at(slot, accD(ms, lines), "dps")` from
`loastuff/lost-ark-accessories/accessory_value.py`, whose `verify` passes; the
neck high/high at min main stat reproduces the 3,200,000g DPS anchor exactly.

Damage is recomputed on this chart's reference character, the way the support
lattice was built (the old `tools/accessory-ladder.js`, since removed). The
rows counted in the heading were the cost frontier — sort by damage, keep a
configuration only if nothing cheaper is also better. Since 2026-09-22 the page
builds the ladder itself from the lattice, for the families the switches tick
and as the convex chain a buyer walks; see METHODOLOGY.md, "Accessories".

The slot under test is **stripped out of the reference first**, so the ladder
measures one accessory against the same character wearing nothing in that slot —
the same trick the support build used when it held the other earring at 3%:

| slot | stripped from the reference |
|---|---|
| neck | `addDamage.neck` 0.026 → 0 (the high additional-damage line) |
| earring | `wpPct` −0.03 and `baseApPct` −0.0155 (one high weapon-power % and one high attack-power % line) |
| ring | crit rate −1.55 pp and crit damage −4.0 pp (one high line each) |

Main stat counts only **above the bottom quintile**, again mirroring the support
ladder — the minimum roll is treated as part of the reference character, so this
row never double-counts against honing.

Every slot opens with a **free upgrades** rung: the accessory calculator prices
350 of the 560 neck configurations, 393 earrings and 392 rings at zero, because
they sit under its pricing baseline plus the 60,000g pheon tax. That is 2.363%
free on the neck, 1.925% on the earring and 1.705% on the ring.

**Attack Power+ never reaches a frontier.** On this character a high Attack
Power+ roll is 390 flat attack power on 240,097 — 0.162% — while a high Weapon
Attack Power+ roll is 960 weapon power inside the square root and inside the
`wpPct` bucket — 0.196%. The accessory calculator prices the two within a few
percent of each other, because its own reference has a much smaller attack-power
percentage pool for the flat to escape. So the weapon-power flat dominates at
every tier and every price, and no attack-power flat survives the frontier walk
on any of the three slots.

## Sanity check against the support axis

| step | support | DPS | ratio |
|---|---:|---:|---:|
| one honing level (armour, +24→+25) | 0.338% | 1.097% | 3.2× |
| one gem level (9→10) | 1.112% | 2.942% | 2.6× |
| one karma level (21→22) | 0.0140% | 0.0455% | 3.3× |
| ability stone 7-7 → 9-7 | 0.458% | 1.148% | 2.5× |
| bracelet floor to anchor | 6.004 | 16.308 | 2.7× |
| one ark grid band, whole grid | 0.1168% | 0.5324% | 4.6× |

All larger in raw percent, as expected, and none of them is a party number.

## Flags and open questions

1. **The bracelet price curve.** The brief gives
   `price = 0.0275 * exp(0.0679 * statSum)`. I used `tools/bracelet-price.js`'s
   own fitted integral instead (`a = 0.795`, `pmin = 8,096`), because that is the
   function the support rows were costed with and the two halves of one chart
   should sit on one price scale. The exponential reads **1.5 to 2.7 times
   higher** at the sums that matter — 109g against 40g at 61/61, 6,401g against
   4,725g at 91/91, 40,036g against 29,070g at 104/105. Every bracelet gold in
   `rows-dps.json` scales with that choice; say the word and it is a one-line
   swap.

2. **The support bracelet gold column looks off by one rung.** Reconstructing
   `cost(rank)` from the `buy` and `odds` text already in `data/rows.json`,
   `gold` on row *k* reproduces `cost(rank k+1) − cost(rank k)`, not
   `cost(rank k) − cost(rank k−1)` — exactly, for eleven rows in a row (18,742
   against 18,747; 21,030 against 21,023; 99,668 against 99,658 …). The two end
   rows fit neither reading. `rows-dps.json` uses `cost(to) − cost(from)`, which
   is the convention the accessory rows already use. Worth a look before the two
   halves are shown side by side.

3. **`data/rows.json` changed schema while this ran.** It picked up a `total`
   field and per-row `mats` breakdowns, and folded the "free upgrades" accessory
   rung into the first paid one with a cumulative damage figure.
   `rows-dps.json` uses the ten-field schema I was given
   (`series, label, gold, damage, detail, buy, odds, minimum, from, to`), which
   is a subset of the new one, so it should merge without loss — but the
   accessory rows will need the same reshaping the support ones just got.

4. **The gems row credits the freed swiftness as pure gain.** Cooldowns are held
   constant, so swiftness's only job is done and its points move to crit for
   nothing. If instead you charge the lost swiftness at the profile's own
   `traitWeights.swift` of 0.025 a point, the trade cancels exactly and the gem
   row collapses to its attack-power half — about 0.91% a level rather than
   2.9%. This is the same assumption `model/gems.js` already makes for the
   support axis, so the two agree; but it is an assumption, and it is the single
   biggest lever on the gem row.

5. **Three files disagree about what a level-9 gem set is worth in attack
   power.** `model/gems.js` and `model/gear.js` say 9.8% at level 9 and 11% at
   level 10 (1.2 points a level) — used here, per the brief.
   `loa-bracelet-calc/DEFAULT_PROFILE` says 11 gems × 1.0% = 11% at level 9.
   `tools/verify.js` feeds bebkok's saved character 13.2% for level 10.
   Unresolved; the gem row's attack-power half moves with it.

6. **The ability stone's negative engraving is not scored, and for a DPS that
   may be wrong.** The support note establishes that none of the four T4 maluses
   costs a *support* party damage. Two of them plainly could cost a dealer:
   Atk. Power Reduction is 공격력, and Atk. Speed Reduction is worth
   0.1% damage per 1% of speed under the profile's own
   `atkMoveSpeedDamagePerPct`. The malus only applies if that engraving is one of
   your five, and I could not pin down what a real DPS runs or how the negative
   line's level moves with the 7-7 → 9-7 cut, so the row is scored as the +1.5%
   alone. If a dealer typically eats a level-2 Atk. Power Reduction, this row is
   overstated.

7. **The bracelet's cost-minimising purchase always lands on spec 120.** The
   price fit depends only on the stat **sum**, while spec is worth 0.02500 a
   point against crit's 0.02457, so the optimiser spends the whole budget on the
   dearer stat. Real listings price the pair, not the sum. The cost penalty for
   forcing a balanced pair instead is small but unmeasured.

8. **The ark grid row assumes free raw gems**, twenty-four gems for the grid (a full
   grid is 24 slots), and one fixed advisor policy. The T1/T3 columns above are
   the sensitivity: the top rungs move by a factor of two either way.

9. **The `ungraded → C-` ark grid row carries a 3.3-point band's damage**, the
   same convention the support row uses. It is the absolute cost of the first
   gem worth socketing, not a band step, so its damage figure is a stand-in.

10. **Accessory line values stack additively inside their pools.** A
    configuration's lines are applied to the stripped reference all at once, so a
    second attack-power percentage on the same accessory lands on the bigger
    denominator. That is right within one accessory, but the chart does not model
    what happens when five accessories carry the same line — the frontier is a
    per-slot ladder, exactly as on the support side.

## How to reproduce

The support-side tools are unchanged. The DPS harnesses live in the session
scratchpad and take these arguments:

```
# ark grid, DPS twin of the support harness
node --max-old-space-size=4096 band-cost-dps.js --n=300000 --bl=85 --gpd=2500000 \
     --seed=gpd-2026-08-14 --mix=60,30,10 --fuse-target=same --out=dpsT2.json

# bracelet: line-damage distribution, cost per rank, one example per rank
node --max-old-space-size=4096 bracelet-dps-rows.js 20000000

# accessories: every DPS configuration, priced on the DPS market
python dps-accessory-configs.py

# assemble
node build-dps-rows.js
```
