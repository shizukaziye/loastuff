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
`orderScore(level) = level × 0.15987`.

Willpower is deliberately **not** in `gemDamage` — willpower isn't damage, it's
*efficiency* (a cheaper gem of the same damage is strictly better). It enters as a
multiplier next.

---

## 5. Willpower → a FITTED per-cost toll (the 2026-08-09 reweight)

Willpower reduces effective cost (`effectiveCost = baseCost − willpowerLevel`), and a
cheaper gem is better — because the willpower it frees lets a *bigger* gem slot
elsewhere in the 17-per-core budget. We model that as a **percentage multiplier
`M[effectiveCost]`** on the gem's value.

The old model calibrated `M` so a perfect gem of every base cost tied at 100.
That over-rewarded cheapness ~2.5×: simulated optimal grids kept benching the
high-grade cheap gems the scale loved. The current `M` is **fitted to data**:
15,000 accounts were simulated (gems cut by this site's own advisor at three
economy tiers, every finished gem kept), each account's optimal 3×17-core Ark
Grid was found by an exact-verified packer, and `M[cost]` plus the order value
weight were tuned to minimize disagreements between "top 12 by score" and the
packer's real best 12 (held-out: 1.62 vs 2.95 wrong gems per account).

| effective cost | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **M (fitted, DPS)** | 1.110 | 1.053 | 1.000 | 0.955 | 0.898 | 0.825 | 0.735 |
| **M (fitted, support)** | 1.146 | 1.106 | 1.000 | 0.891 | 0.842 | 0.772 | 0.660 |

The constants are the **fixed point** of the cutting↔packing feedback loop:
the score shapes the advisor's cutting play, which shapes what collections
contain, which shapes what the optimal grid sockets. Three cut→pack→refit
iterations converged here. (Cost 9's value is an upper bound — the optimal
grid never sockets one, so the data cannot price it more precisely.)

Read it as the packer's revealed price of budget: **costs 3–6 are all viable,
7 is taxed, 8 is heavy, and 9 is a cliff** — the optimal grid never sockets a
cost-9 gem, even with perfect lines (cost 10 cannot exist; willpower minimum is
1). The curve was cross-checked by direct experiments: probe gems of every cost
dropped into real simulated accounts, and a "monster ladder" (a cost-8 c10 with
perfect lines vs progressively weaker perfect-willpower c8s) whose empirical
crossover the fitted table reproduces.

### The grading value

```
gemValue      = (D(e1) + D(e2) + 0.161 × orderLevel) × M[effCost]        (DPS)
supportValue  = (S(e1) + S(e2) + 0.043 × orderLevel) × M_sup[effCost]    (support)
```

Note DPS order enters at its **fitted value weight** (0.161, close to its
damage weight 0.15987 — the old model had order right all along). Support
order carries proportionally more of the value (its effect lines are weaker),
and support's toll is steeper — both measured by the support's own study, not
carried over from DPS.

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
  scale is open above: perfect c8/c9/c10 grade **95.3 / 98.5 / 103.1** on the
  DPS axis and **96.9 / 101.0 / 101.1** on the support axis (each axis
  anchors on its own perfect grid; support's perfect 9- and 10-costs are a
  near-tie by value).
- **`minValue`** = the worst legal gem (grade 0, both axes).
- A TRUE perfect roll of any cost keeps the animated **rainbow badge** — the
  badge is config-gated, not grade-gated, so it marks perfects at 95.3 and
  103.1 alike.

The letter rank is an explicit threshold table (`RANK_LADDER`) — the familiar
5-point cuts, with one change: **the S+ cut sits at 95.3, the DPS perfect
8-cost's grade**, so every perfect gem on either axis is S+ (S+ still holds
roughly the top 0.3% of cut gems):

| S+ | S | S− | A+ | A | A− | B+ | B | B− | C+ | C | C− | D+ | D | D− | F+ | F | F− |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 95.3 | 90 | 85 | 80 | 75 | 70 | 65 | 60 | 55 | 50 | 45 | 40 | 35 | 30 | 25 | 20 | 15 | 0 |

(The leaderboard's "support main" rule counts these same bands — see
*how-the-leaderboard-ranks.md*.)

---

## 7. Order / Chaos in detail

Order/Chaos is the one line every gem rolls, and it's the strongest (0.15987 D per
point). For **per-gem grading** it's flat: `orderScore = orderLevel × 0.15987`.

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

Everything else (the willpower multiplier, the global grade normalization, the
ranks) works identically — just with `supportValue` instead of `gemValue`. The
Grader's **DPS / Support toggle** picks which axis a loadout is judged on; it
auto-defaults to Support for support classes.

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
Damage 5:

- `gemDamage = 5·0.08127 (boss) + 5·0.05929 (add) + 5·0.15987 (order) = 1.50214`
- `effectiveCost = 10 − 5 = 5` → `M(5) = 1`
- `gemValue = 1.50214 × 1 = 1.50214` → the maximum → **grade 100, rank S+**

Drop willpower to 1 (effective cost 9): `M(9) = 0.607`, so
`gemValue = 1.50214 × 0.607 ≈ 0.911` → grade ≈ 58 → **B−**. Same damage lines, much
worse gem, because the cost is far higher.

---

*See also: `how-the-pipeline-tables-are-computed.md` (cut/fuse/throw EV) and
`how-the-leaderboard-ranks.md` (ranking + the support-main rule).*
