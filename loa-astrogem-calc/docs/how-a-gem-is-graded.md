# How a Gem Is Graded

This explains, in full, the math behind the **Grader** tab — how a single astrogem
gets a 0–100 grade and a letter rank, and how a whole 6-core grid rolls up into a
"% total damage" number. Everything here is implemented in `model/astrogem.js`
(mirrored in `model/astrogem.py`); this doc is the *why* behind those functions.

---

## 1. The game pieces

An **astrogem** sits in one of a character's **6 cores** (Order Sun/Moon/Star,
Chaos Sun/Moon/Star). Each gem has:

| Property | Range | What it does |
|---|---|---|
| **Base cost** | 8, 9, or 10 | The gem's intrinsic cost. Determines the **side-effect pool** (below). |
| **Willpower** (`willpowerLevel`) | 1–5 | **Reduces** the gem's cost: `effectiveCost = baseCost − willpowerLevel`. More willpower = cheaper = better. |
| **Order/Chaos** (`orderLevel`) | 1–5 | Core points. The headline damage stat (every gem can roll it). |
| **Side effect 1 & 2** | from the pool, level 1–5 each | Two stat lines drawn from the gem's base-cost pool. |

The **side-effect pool depends on base cost** (`EFFECT_POOLS`):

| Base cost | Effect pool |
|---|---|
| **8** | Additional Damage · Attack Power · Brand Power · Ally Damage Enh. |
| **9** | Boss Damage · Attack Power · Ally Damage Enh. · Ally Attack Enh. |
| **10** | Boss Damage · Additional Damage · Brand Power · Ally Attack Enh. |

For a **DPS** gem only three of these lines are damage: **Attack Power, Additional
Damage, Boss Damage**. Brand Power / Ally Damage Enh. / Ally Attack Enh. are
*support* lines and contribute **zero** to a DPS grade (and the other way round for support).

The sum `willpower + order + effect1 + effect2` (each 1–5, so 4–20) also sets the
finished-gem **tier**, which only matters for fusion fodder:

| Tier | level-sum |
|---|---|
| Legendary | 4–15 |
| Relic | 16–18 |
| Ancient | 19–20 |

---

## 2. The one assumption everything rests on: **damage is multiplicative**

In Lost Ark your damage multipliers stack *multiplicatively*, not additively. If
one source gives +10% and another +10%, you have ×1.1 × ×1.1 = ×1.21, not +20%.

That single fact drives the whole model. To make multiplicative things **add up**
(so we can score, sum, and compare), we work in **log space**. We measure every
contribution as

> **D = 100 · ln(multiplier)**

Because `ln(a·b) = ln(a) + ln(b)`, multiplicative damage becomes **additive** in D.
D is in "≈ % damage" units: for small contributions `D ≈ %`, and a total D converts
back to real damage with `damage% = (e^(D/100) − 1) · 100`.

This is the key to everything below: **a gem's value is the sum of its lines' D,
and a character's value is built by adding D in log space.**

---

## 3. Where the per-line numbers come from (the baselines)

A stat line (say Attack Power) is only worth what it multiplies. Each damage stat
is modeled as a bucket with two pieces of context (`STAT_BASELINES`):

| Stat | `other` (from gear, outside the grid) | `gridAdd` (a full lvl-30 grid adds) |
|---|---|---|
| **Attack Power** | 0.121 (12.1%) | 0.011 (1.1%) |
| **Additional Damage** | 0.336 (33.6%) | 0.0242 (2.42%) |
| **Boss Damage** | 0.0 | 0.025 (2.5%) |
| **Order/Chaos** | — | flat ×1.0016 per point |

`other` is how much of that stat you already have from gear; `gridAdd` is how much a
**fully-leveled grid** contributes on top. These are the empirical anchors — change
them and every number downstream moves, which is why they live in one place.

### Per-gem yardstick: the lvl-30 marginal

A *single* gem can't see the rest of your grid, so it's graded against a fixed
yardstick: **how much one more level of this stat is worth, on top of an already-full
lvl-30 grid.** That marginal multiplier is

> `D_perLevel = 100 · ln( (1 + other + gridAdd + gridAdd/30) / (1 + other + gridAdd) )`

Plugging in the baselines gives the exact per-line values used for grading:

| Line | D per level | Note |
|---|---:|---|
| **Attack Power** | **0.03239** | small (you already have lots of attack from gear) |
| **Additional Damage** | **0.05929** | |
| **Boss Damage** | **0.08127** | biggest per level (0% from gear → least diluted) |
| **Order/Chaos** | **0.15987** | `100·ln(1.0016)` per point — the headline stat |
| **Willpower** | **0.07773** | per cost-level; see §5 |

So a Boss Damage line is worth ~2.5× an Attack Power line *per level* — purely
because you start with 0% boss damage from gear but 12.1% attack, so the grid's
contribution is far less diluted for boss.

---

## 4. A gem's raw damage

`gemDamage` is just the sum of the gem's damage lines in D:

```
gemDamage = effectScore(effect1) + effectScore(effect2) + orderScore(order)
```

where `effectScore(line, level) = level × D_line` (and = 0 for non-DPS lines), and
`orderScore(level) = (level − 4) × 0.15987` (level 4 = neutral).

Willpower is deliberately **not** in `gemDamage` — willpower isn't damage, it's
*efficiency* (a cheaper gem of the same damage is strictly better). It enters as a
fitted credit next.

---

## 5. Willpower → a FITTED per-cost price (the 2026-08-09 roster-bound regrade)

Willpower reduces effective cost (`effectiveCost = baseCost − willpowerLevel`), and a
cheaper gem is better — because the willpower it frees lets a *bigger* gem slot
elsewhere in the 17-per-core budget. Both axes price that as an **additive
credit `K[effectiveCost]`** on the gem's value, each axis with its own fitted
table.

Two model generations died on the way here. The original model calibrated a
willpower multiplier so a perfect gem of every base cost tied at 100 — that
over-rewarded cheapness ~2.5× and simulated optimal grids kept benching the
high-grade cheap gems the scale loved. A first refit priced willpower from
accounts cut by the gold-EV advisor — a world where bad gems are sold or
abandoned. But astrogems are **roster-bound**: you can't sell them, so real
collections keep everything and fuse the spares. The current constants are
fitted to that world, one study per axis with the same protocol: cut gems with
nothing abandoned, equip the best, keep everything within 5 grades of the
equipped floor, fuse every spare relic/ancient with two legendary 10-costs,
repeat until nothing fusable is left — then an exact-verified packer finds
each roster's optimal 3×17-core Ark Grids, and the constants minimize
disagreements between "top N by score" and the packer's real picks on held-out
accounts. The current tables come from the **adaptive-fusion generation**
(2026-08-10): each simulated account *chooses its own fusion target* — c9 or
c10 — by exactly enumerating the fusion-output distribution and scoring every
possible output with the packer's own swap marginal, re-deciding after every
grid upgrade. DPS: **117,000 accounts** at gpd tiers 6M/2.5M/1M (held-out
1.55 wrong gems vs ~2.9 for the original model; the fusion finding: most
accounts should steer fusions at 9-costs, whales split ~50/50 and drift to
10s as their grids strengthen). Support: **107,000 joint Order+Chaos
accounts**, each side cut, packed, fused, and *targeted* at its own per-core
rates (3.33 wrong gems vs 3.79 for the old sell-world constants; the same
fuse-9s law holds side-by-side). Full protocol and findings:
*roster-adaptive-studies-2026-08-10.md*.

| effective cost | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **K (fitted, DPS)** | +0.1327 | +0.0896 | 0 | −0.1203 | −0.2504 | −0.3970 | −0.5686 |
| **K_sup (fitted, support)** | +0.0252 | +0.0150 | 0 | −0.0235 | −0.0593 | −0.0986 | −0.1346 |

Why additive? A multiplier taxes a good gem more gold-for-gold than a bad one
at the same cost; the packer's revealed price of budget is closer to a FLAT
damage toll per cost. On both axes the additive form was the only candidate
that called the correct winner in **every** packer-adjudicated ladder test —
a perfect cost-8 c10 against progressively weaker high-willpower c8s, stripped
line by line (DPS 11/11 rungs; support 9/9; every multiplicative variant
misses at least one rung — on support, the rung where a slightly-weakened
perfect c10 still beats the perfect c8). The support values are ~5× smaller
than the DPS ones only because support effect lines are ~5× smaller — the
shape is the same.

Read the curve as the packer's revealed price of budget: **costs 3 and 4 earn
a bonus, 5 is neutral, 6–9 are taxed harder and harder** — the optimal grid
essentially never sockets a cost-9 gem (cost 10 cannot exist; willpower
minimum is 1). Cost 9's price is an upper bound for the same reason: the data
almost never sockets one, so it cannot price the cliff more precisely.

### The grading value

```
gemValue      = D(e1) + D(e2) + 0.159872 × (orderLevel − 4) + K[effCost]  (DPS)
supportValue  = S(e1) + S(e2) + 0.02879 × orderLevel + K_sup[effCost]    (support)
```

DPS order is **pinned at its exact damage weight** — order damage is
deterministic, so nothing is fitted there (re-fitting K with the pin in place
scored slightly BETTER held-out than the earlier fitted weight, 1.678 vs 1.687
misses) — and centered at level 4: order 4 adds nothing, 5 adds, 1–3 subtract.
Support order keeps its **fitted value weight**, which lands almost exactly on
its damage weight (0.0286 vs 0.0256) — the packer prices order at face value.
Support's constants come from the support's own roster-bound joint Order+Chaos
study, not carried over from DPS; refitting them with the whole sell-world
corpus added to training moves them by less than a rounding step, so they are
not an artifact of one corpus.

---

## 6. From value to a grade and a letter rank

Perfect gems no longer tie — a perfect 10-cost genuinely carries more damage
than a perfect 8-cost, and the grade now says so. The scale is anchored by two
fixed points:

```
grade = 100 × (gemValue − minValue) / (anchorValue − minValue)
```

- **`anchorValue`** = the mean value of the **perfect Ark Grid layout** — 3
  perfect 8-costs + 3 perfect 9-costs + 6 perfect 10-costs (exactly the wp5
  packing 5+5+4+3 = 17 budget per core). **Grade 100 = this average**, so the
  scale is open above: perfect c8/c9/c10 grade **96.1 / 99.7 / 102.1** on the
  DPS axis and **94.6 / 98.2 / 103.6** on the support axis (each axis anchors
  on its own perfect grid).
- **`minValue`** = the worst legal gem (grade 0, both axes).
- A TRUE perfect roll of any cost keeps the animated **rainbow badge** — the
  badge is config-gated, not grade-gated, so it marks perfects at 96.3 and
  102.5 alike.

The letter rank is an explicit threshold table, re-tuned 2026-08-10 to the new
scale's measured percentiles: **each letter is an even third of its 10-point
band** (A− at 80, A at 83.3, A+ at 86.7, and so on), F takes thirds of 0–50,
and **S+ starts at the axis's perfect 8-cost grade** — derived from the model
at load, so a refit moves the cut automatically. On DPS that lands exactly on
the even grid within a step (96.1); on support it sits at 94.6, because "every perfect gem
is S+ on its axis" outranks grid evenness.

| axis | S+ | S | S− | A+ | A | A− | B+ | B | B− | C+ | C | C− | D+ | D | D− | F+ | F | F− |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| DPS | 96.1 | 93.3 | 90 | 86.7 | 83.3 | 80 | 76.7 | 73.3 | 70 | 66.7 | 63.3 | 60 | 56.7 | 53.3 | 50 | 33.3 | 16.7 | 0 |
| support | 94.6 | 93.3 | 90 | 86.7 | 83.3 | 80 | 76.7 | 73.3 | 70 | 66.7 | 63.3 | 60 | 56.7 | 53.3 | 50 | 33.3 | 16.7 | 0 |

Measured meaning under the roster advisor (share of finished cuts reaching
the band, cross-tier): S ~1%, S− ~2%, A− ~14%, B− ~34%, C− ~55%. (The
leaderboard's "support main" rule counts these same bands — see
*how-the-leaderboard-ranks.md*.)

---

## 7. Order / Chaos in detail

Order/Chaos is the one line every gem rolls, and it's the strongest (0.15987 D per
point). For **per-gem grading** it is centered at level 4: `orderScore =
(orderLevel − 4) × 0.15987` — order 4 contributes nothing, 5 adds damage, 1–3
subtract. The weight is the exact in-game value, never fitted.

In the **whole-grid total** (§9) it behaves differently: it's evaluated **per core**
with a **17-point floor**. A core needs ~17 order points before it starts paying
out, and only points above 17 count. With 6 gems × ~4.25 points that floor models
"the grid needs to be mostly built before order does much," and it's why a perfect
maxed grid's order contribution is ~2.9%, not a runaway number.

---

## 8. Support gems — the parallel axis

Support classes (Bard, Paladin, Artist, Valkyrie) don't deal damage; they buff the
party. There's a complete **parallel scoring axis** with the same structure but
support coefficients (`SUPPORT_SCORING`). The damage lines flip: **Ally Attack Enh.,
Brand Power, Ally Damage Enh.** are the "damage" lines; Attack/Additional/Boss → 0.

A support gem buffs all 3 DPS in the party, so its *raw* party value is ~3× a single
DPS buff. To keep per-gem grades and the leaderboard on a comparable per-character
scale, every support coefficient is stored **÷3** (the ×3 party benefit is reapplied
only at the gold step, `SUPPORT_GPD_MULTIPLIER = 3`).

Each coefficient is a **per-level** party-damage value: one level of the effect grants
a fixed number of buff-stat percentage points (Ally Atk 0.13, Brand 0.167, Ally Dmg
0.052 per level), times how much party damage one such point adds. The second factor
comes straight from the accessory calc's support model (`~/lost-ark-accessories`
METHODOLOGY §3) — so when that model changes, these move with it.

> **Re-derived against the corrected support model (Bebkok sup-buff sheet).** The
> identity channel now runs serenade, **Major Chord** and the t-skill through one
> bracket `base·(1 + ally_dmg)·(1 + spec_eff)`, summed and diluted by the dealer's own
> additional damage. Net effect on per-point party damage: ally-attack ×0.98, brand
> ×1.01, ally-damage **×1.10** (ally damage rides the bracket size, so higher spec
> lifts it further). Values below are the corrected numbers, and they are **live**:
> `model/astrogem.js` carries them and the committed 2026-07-23
> `data/pipeline-support.json` bake was built from them (verified in sync).
> Independent corroboration (2026-08-06): lostark.bible's CP itemization, built on
> the game's own combat-power algorithm, prices ally-damage at 0.95× and brand at
> 0.55× of ally-attack per stat-% — within 10% of this model's 0.90× / 0.58×.

| Support line | per-level value (per-DPS) | was |
|---|---:|---:|
| Ally Attack Enh. | 0.0586 / 3 | 0.0596 |
| Brand Power | 0.0437 / 3 | 0.0434 |
| Ally Damage Enh. | 0.0214 / 3 | 0.0195 |
| Order/Chaos (avg) | 0.0769 / 3 = 0.0256 | 0.0747 |
| Willpower | **(2/3)** × the DPS willpower contribution | — |

**Per-core order values.** Unlike DPS, a support gem's order points are worth
different amounts by core, because each core grants a different party buff. A
*standalone* support gem grade uses the average (0.0769/3); the *whole grid* uses
the per-core value (`SUPPORT_ORDER_PER_CORE`, base values shown, stored ÷3):

| Core | Buff it grants | per-point value | was |
|---|---|---:|---:|
| Order Sun | Ally Attack | 0.0682 | 0.0694 |
| Order Moon | Ally Damage | 0.0702 | 0.0640 |
| Order Star | Serenade | 0.0486 † | 0.0486 |
| Chaos Sun | Ally Damage | 0.0826 | 0.0753 |
| **Chaos Moon** | **Brand (strongest)** | **0.1052** | 0.1044 |
| Chaos Star | Weapon Power | 0.0869 | 0.0869 |

† **Order Star (serenade) is held provisional.** It scores identity-meter generation,
which the sheet models as bar-count steps (5/10/15% base), not a smooth per-point curve
— re-deriving it properly is a separate task from the three buff-stat lines. Chaos Star
(weapon power → support base atk → AP buff) is unchanged: the AP channel kept its shape.

So a support point in Chaos Moon (Brand) is worth ~2.2× one in Order Star.

Everything else works the same way structurally, but with support's OWN fitted
pieces: its willpower credit `K_sup` (additive, same form as DPS), its own
order value weight, and its own grade anchor (its own perfect grid). The rank
ladder shares every cut with DPS except its own S+ pin (94.6, §6). The
Grader's **DPS / Support toggle**
picks which axis a loadout is judged on; it auto-defaults to Support for
support classes.

---

## 9. The whole-character total — "% total damage"

A single gem is graded against the lvl-30 marginal yardstick (§3). But the **grid as
a whole** is judged differently: *how much real damage does the entire 6-core grid
add over having no grid at all?* This is the number on the leaderboard and the
"Total % dmg" line in the grader.

It's a **level-0 multiplicative** model (`gridDamage`):

1. **Effects accumulate into stat buckets.** Sum every gem's Attack/Additional/Boss
   levels into three totals. Each bucket is then a multiplicative gain over your
   *other gear*:

   > `D_bucket = 100 · ln( (1 + other + levelSum × gridAdd/30) / (1 + other) )`

   Because of the `ln`, two gems of the same stat give **diminishing returns** — the
   second level of Boss Damage is worth slightly less than the first. This is the big
   difference from per-gem grading (which can't see the rest of the grid).

2. **Order/Chaos is per-core with the 17-point floor.** For each core, add up its
   gems' order points, then

   > `D_core = 100 · ln(1 + 0.0016 × max(0, points − 17))`

   and the **6 cores multiply** (their D add). A fully-maxed grid lands around
   `1.0048⁶ ≈ +2.9%` from order — diminishing returns and the floor fall out of the
   math, no special-casing.

3. Total `gridDamage = ΣD_bucket + ΣD_core` (×100), then displayed as a damage %.

The support total (`supportGridDamage`) is the same shape: support **effects stay
linear** (the party per-level values are flat in this model — no bucket diminishing),
and order is the per-core 17-floor form with each core's own rate. The support
coefficients are stored per-ally (÷3, §8), so this total already IS the per-ally
party % — the UI shows it as-is, with no division.

> **Known limitation — core rarity is not scored.** The grid total sees gems
> (effects + order points over the 17 floor) but not the core items they sit in:
> the 0→17 threshold effects are treated as universal baseline, and the
> relic↔ancient gap in those thresholds (e.g. ancient Faith Enhancement grants
> ~+1.6% more ally damage than relic) is invisible. Two same-gem grids can differ
> by ~±0.2pp real party % per rarity-mismatched core. Found 2026-08-06 comparing
> two live support grids against lostark.bible's ark-grid CP: bible's flip vs this
> model's ordering traced almost entirely to one ancient-vs-relic Chaos Sun core
> (bible credits full thresholds + rarity — though its weapon-type cores hide
> their rarity bonus in base stats, so its ark-grid line isn't apples-to-apples
> either).

> **Important:** per-gem grades use the lvl-30 *marginal* yardstick, while the grid
> total uses the lvl-0 *cumulative* model with diminishing returns. So **the per-gem
> numbers do not sum to the grid total — by design.** A gem's grade answers "how good
> is this gem?"; the total answers "how much does my whole grid do?"

---

## 10. Grid quality (the leaderboard's "avg grade")

Separately from raw damage, a grid has a **quality** score that's *pairing-invariant*
— two builds with the same set of gems tie regardless of which gem sits in which core:

```
gridQuality = Σ ln(gemValue)     (sum over the grid's gems; supportValue for support)
```

Because it's a sum of logs (= log of the product of values), swapping gems between
cores doesn't change it, and the per-gem grades roll straight up into it. The
leaderboard shows this as the **average grade** (rank), separate from the **total
damage %**.

---

## 11. Quick worked example

A cost-10 gem, willpower 5 (→ effective cost 5), order 5, Boss Damage 5, Additional
Damage 5 — the perfect 10-cost:

- effects: `5·0.08127 (boss) + 5·0.05929 (add) = 0.70278`
- order, centered at 4: `(5 − 4) × 0.159872 = 0.15987`
- `effectiveCost = 10 − 5 = 5` → `K(5) = 0`
- `gemValue = 0.70278 + 0.15987 + 0 = 0.86265` → **grade 102.1, rank S+** (above
  100 because grade 100 is the perfect grid's *average*, and the 10-cost is its
  best gem)

Drop willpower to 1 (effective cost 9): `K(9) = −0.5686`, so
`gemValue = 0.86265 − 0.5686 ≈ 0.294` → **grade 71.7 → B−**. Same damage lines,
much worse gem, because the cost is far higher — but note the penalty is a flat
damage toll, so it no longer scales up with how good the lines are.

---

*See also: `how-the-pipeline-tables-are-computed.md` (cut/fuse/throw EV) and
`how-the-leaderboard-ranks.md` (ranking + the support-main rule).*
