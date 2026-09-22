# Ark Grid (astrogems) — the support grade ladder

What one grade band costs a support, and what it buys, so the Ark Grid can sit
on the same gold-per-damage axis as honing and accessories.

Everything here is simulated with the shipped astrogem calculator's own model
and cut engine (`~/loastuff/loa-astrogem-calc`, `MODEL_SIG 12u9hug`,
2026-08-13). Nothing in that repo was changed.

---

## 0. First, a correction to the brief

The ladder in the brief — F 5 … A− 60, A 65, A+ 70, S− 75, S 82.5, S+ 90 — is
the **pre-2026-08-10 scale**. The site re-tuned the ladder on 2026-08-10 and the
old numbers survive only in `docs/willpower-reweight-plan.md`. Live today
(`model/astrogem.js` `RANK_LADDER` / `SUPPORT_RANK_LADDER`,
`loadout-econ.js` `GRADE_ROWS_SUPPORT`):

| row | C− | C | C+ | B− | B | B+ | A− | A | A+ | S− | S | S+ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **support** | 60 | 63.3 | 66.7 | 70 | 73.3 | 76.7 | 80 | 83.3 | 86.7 | 90 | 93.3 | **94.6** |
| DPS | 60 | 63.3 | 66.7 | 70 | 73.3 | 76.7 | 80 | 83.3 | 86.7 | 90 | 93.3 | **96.1** |

Each letter is an even third of its 10-point band. Only the S+ cut differs
between the axes: it is pinned at that axis's **perfect 8-cost grade**, derived
from the model at load, so a refit moves it. On support that is 94.6 — which
makes the S → S+ rung **1.3 grade points wide, not 3.3**. Every number below is
on this scale.

---

## 1. How a gem is graded, and what support does differently

### The grade

```
grade = 100 * (value - minValue) / (anchorValue - minValue)      rounded to 0.1, clamped 0..110
```

- `minValue` — the worst legal gem (all levels 1). Grade 0.
- `anchorValue` — the mean value of the **perfect Ark Grid layout**: 3 perfect
  8-costs + 3 perfect 9-costs + 6 perfect 10-costs, the exact wp5 packing
  5+5+4+3 = 17 budget per core. Grade 100 = that mean, so the scale is open
  above it.
- Perfect gems do not tie. Support perfects grade **94.6 / 98.2 / 103.6** for
  c8 / c9 / c10 (`model/astrogem.js:823 supportGrade`, bounds at `:762`,
  anchor at `:811`).

`supportGradeToScore(g)` is the exact inverse and is what turns a grade-based
baseline into the DP's value threshold.

### The value being graded — support vs DPS

```
gemValue(cfg)     = D(effect1) + D(effect2) + 0.159872*(order - 4) + K[effCost]        (DPS)
supportValue(cfg) = S(effect1) + S(effect2) + 0.02879 *order       + K_sup[effCost]    (support)
```

Four things differ on the support axis:

1. **Which lines are damage.** Ally Attack Enh., Brand Power and Ally Damage
   Enh. score; Attack Power, Additional Damage and Boss Damage score **zero**.
   (Exactly inverted from DPS.) `SUPPORT_SCORING`, `model/astrogem.js:597`.

   | line | per-level, per-dealer | source |
   |---|---:|---|
   | Ally Attack Enh. | 0.0586 / 3 = 0.019533 | `SUPPORT_SCORING.allyAttackEnh` |
   | Brand Power | 0.0437 / 3 = 0.014567 | `SUPPORT_SCORING.brandPower` |
   | Ally Damage Enh. | 0.0214 / 3 = 0.007133 | `SUPPORT_SCORING.allyDamageEnh` |
   | Order/Chaos (grade average) | 0.0769 / 3 = 0.025633 | `SUPPORT_SCORING.orderPerPoint` |
   | Willpower | (2/3) × the DPS willpower contribution | `SUPPORT_SCORING.willpowerFactor` |

2. **Order is flat, not centred.** DPS scores `(order − 4)`, so an order-4 gem
   gains nothing. Support scores `order` outright at a fitted 0.02879 per point
   (`SUP_VALUE_ORDER_PER_POINT`, `:734`) — a touch above the model's own
   0.025633, which is the average of the six per-core rates.

3. **Order is worth different amounts per core.** A support gem's order points
   convert at the rate of the core it sits in (`SUPPORT_ORDER_PER_CORE`, `:672`,
   stored ÷3): Chaos Moon (Brand) 0.1052 is worth ~2.2× Order Star (Serenade)
   0.0486. A standalone gem grade uses the average; the packer and the grid
   total use the per-core value. Order Star is flagged provisional in the repo.

4. **Its own fitted willpower credit.** Willpower is budget, not damage
   (`effectiveCost = baseCost − willpowerLevel`), priced as an additive credit
   per effective cost — support's is about 1/4 the size of the DPS one:

   | effCost | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
   |---|---:|---:|---:|---:|---:|---:|---:|
   | K (DPS) | +0.1327 | +0.0896 | 0 | −0.1203 | −0.2504 | −0.3970 | −0.5686 |
   | **K_sup** | +0.0252 | +0.0150 | 0 | −0.0235 | −0.0593 | −0.0986 | −0.1346 |

   Fitted on 107,000 joint Order+Chaos synthetic accounts (~10.8M gems), tiers
   6M/85 · 2.5M/80 · 1M/75 on the support scale.

**Value is not damage.** `supportValue` carries the willpower credit and the
fitted order weight; `supportDamage(cfg)` = effects + order only, no willpower.
Section 4 converts bands to damage with `supportDamage`, which is the honest
party-damage number.

**Per-dealer, not party.** Every support coefficient is stored ÷3. The ×3 party
benefit is reapplied only on the **gold** axis, `SUPPORT_GPD_MULTIPLIER = 3`
(`:615`, applied at `nested.js:169` and `astrogem.js:1209`). So the % damage
reported here is **per dealer**, exactly what the chart wants, and the chart's
own `partySize = 3` supplies the party step.

---

## 2. Method

One advisor policy cuts a shared stream of fresh **epic** gems (9 turns, 3
rerolls) at a **60:30:10** base-cost mix, using the repo's own
`tools/lib/cut-engine.js` — the same rollout `tools/account-study.js` drives, so
the decision semantics are the shipped advisor's (fresh-gem Complete ==
dismantle for 0, reroll and Complete gated until processed once, advisor-style
Reset once per gem at 20,000g, tie-break Process → Reroll → Complete → Reset).

The stream is cut once. Then, for each grade row, the **dud fusion cascade is
replayed** with that row as the keep line, exactly as `rosterEquipFuse` does it:
a dud of relic tier or better (level sum ≥ 16) fuses with two legendary fodder
gems for 500g; a legendary output is dismantled (so the assumed infinite
legendary supply cannot be farmed); a relic/ancient output is regraded and
re-fused if it still misses the row. Gems that grade at or above the row are
**hits**.

Reported per row: **gold per hit** = (all processing + reroll + reset + fusion
gold) / (hits), a ratio estimator over i.i.d. episodes with a delta-method
standard error. **Gems per hit** = fresh gems drawn / hits.

Costs are the model's: processing 900g base (moves 0–1,800 with the cost
multiplier), final reroll 3,800g, reset 20,000g, fusion 500g. **Raw gems
themselves are free** — the repo's convention, and the single biggest caveat
(§5).

### The commands

Run from `~/loastuff/loa-astrogem-calc` (so its relative requires resolve). The
harness is in Appendix A; save it as `band-cost.js` anywhere.

```
node --max-old-space-size=4096 band-cost.js --n=300000 --bl=80 --gpd=2500000 \
     --seed=gpd-2026-08-13 --mix=60,30,10 --fuse-target=same --out=supT2.json
node --max-old-space-size=4096 band-cost.js --n=300000 --bl=85 --gpd=6000000 \
     --seed=gpd-2026-08-13 --out=supT1.json
node --max-old-space-size=4096 band-cost.js --n=300000 --bl=75 --gpd=1000000 \
     --seed=gpd-2026-08-13 --out=supT3.json
```

- **300,000 fresh cuts per policy**, seed `gpd-2026-08-13`, ~50s each.
- Policies are the **support tiers of the account study** (gpd 6M/85, 2.5M/80,
  1M/75 — support bars sit one band below the DPS ones). `--gpd` is the
  pre-multiplier value; the model triples it internally for support.
- **T2 (baseline 80, gpd 2.5M) is the headline.**

### Harness check

Run in roster-bound mode (`--rb`, processing free in the DP) the harness
reproduces the corpus the shipped constants were fitted on. Share of finished
cuts reaching each band, 25,000 cuts per tier:

| tier | C− | B− | A− | S− | S |
|---|---:|---:|---:|---:|---:|
| 6M/85 | 47.7% | 25.1% | 8.8% | 1.72% | 0.60% |
| 2.5M/80 | 50.1% | 27.8% | 11.3% | 1.50% | 0.47% |
| 1M/75 | 50.3% | 28.2% | 11.1% | 1.26% | 0.35% |

The repo quotes C− ~55%, B− ~34%, A− ~14%, S− ~2%, S ~1% cross-tier. Ours sit a
few points lower because those are cross-axis and the repo's own benchmark says
supports read about 5 grade points lower than DPS at equal wealth. Same shape,
right offset.

---

## 3. What each band costs

**Gold per gem produced at or above the row**, duds fused. N = 300,000 per
column, seed `gpd-2026-08-13`, ± is one standard error.

| row | T1 (85 / 6M) | T2 (80 / 2.5M) — headline | T3 (75 / 1M) | gems drawn per hit (T2) |
|---|---:|---:|---:|---:|
| C− | 22,774 ± 69 | **24,583 ± 65** | 18,749 ± 45 | 2.9 |
| C | 26,123 ± 85 | **27,925 ± 80** | 21,397 ± 56 | 3.3 |
| C+ | 31,464 ± 114 | **33,092 ± 105** | 25,471 ± 75 | 3.9 |
| B− | 38,397 ± 157 | **39,972 ± 141** | 30,715 ± 102 | 4.7 |
| B | 49,990 ± 237 | **51,382 ± 210** | 38,725 ± 150 | 6.1 |
| B+ | 67,642 ± 380 | **67,049 ± 319** | 50,263 ± 228 | 7.9 |
| A− | 91,676 ± 611 | **88,045 ± 488** | 73,560 ± 417 | 10.4 |
| A | 127,626 ± 1,018 | **130,043 ± 892** | 121,698 ± 909 | 15.3 |
| A+ | 203,367 ± 2,075 | **252,135 ± 2,447** | 251,695 ± 2,758 | 29.6 |
| S− | 458,133 ± 7,121 | **664,784 ± 10,619** | 652,846 ± 11,670 | 78.0 |
| S | 1,242,755 ± 32,069 | **1,972,469 ± 54,608** | 1,914,577 ± 58,929 | 231.3 |
| S+ | 1,748,339 ± 53,630 | **2,839,821 ± 94,411** | 2,719,546 ± 99,853 | 333.0 |

Fusion pays for itself throughout and matters most at the top: at T2 the
no-fusion column reads 25,036 at C− (+1.8%) and 3,801,506 at S+ (+34%).

### The marginal step — the chart row

Damage per step uses the least-squares slope of `supportDamage` on grade over
**all 11,250 legal support configs grading ≥ 50**:

```
supportDamage% (per dealer) = 0.002948 * grade - 0.036849
=> 0.00983% per dealer per 3.33-point band step  (0.0295% party)
=> 0.00383% per dealer for the 1.3-point S -> S+ step
```

Gold per 1% **party** damage = Δgold / (Δdamage_per_dealer × 3), matching this
repo's `partySize = 3` and the astrogem tool's `SUPPORT_GPD_MULTIPLIER`.

| step | Δ gold (T2) | Δ grade pts | Δ dmg per dealer | **gold per 1% party (T2)** | T1 | T3 |
|---|---:|---:|---:|---:|---:|---:|
| C− → C | 3,342 | 3.3 | 0.00973% | **114,500** | 114,766 | 90,723 |
| C → C+ | 5,167 | 3.4 | 0.01002% | **171,822** | 177,613 | 135,490 |
| C+ → B− | 6,880 | 3.3 | 0.00973% | **235,750** | 237,565 | 179,670 |
| B− → B | 11,409 | 3.3 | 0.00973% | **390,930** | 397,195 | 274,455 |
| B → B+ | 15,667 | 3.4 | 0.01002% | **521,030** | 587,046 | 383,708 |
| B+ → A− | 20,996 | 3.3 | 0.00973% | **719,411** | 823,517 | 798,251 |
| A− → A | 41,998 | 3.3 | 0.00973% | **1,439,032** | 1,231,774 | 1,649,396 |
| A → A+ | 122,091 | 3.4 | 0.01002% | **4,060,293** | 2,518,866 | 4,323,203 |
| A+ → S− | 412,649 | 3.3 | 0.00973% | **14,138,978** | 8,729,279 | 13,745,032 |
| S− → S | 1,307,686 | 3.3 | 0.00973% | **44,806,473** | 26,884,251 | 43,231,874 |
| S → S+ | 867,351 | 1.3 | 0.00383% | **75,440,209** | 43,974,513 | 70,014,277 |

The row's shape in one line: **cheap and near-linear up to A−, then the absolute
cost multiplies by 1.5–3× a band, and A+ → S+ is a different economy entirely.**
The last three rungs cost 2,587,686 gold between them against 227,550 for every
rung from C− to A+ — eleven times the whole ladder below them.

For the brief's eight named bands (absolute cost, T2):
C 27,925 → B 51,382 → A− 88,045 → A 130,043 → A+ 252,135 → S− 664,784 →
S 1,972,469 → S+ 2,839,821.

### The other reading: the self-consistent ladder

The table above holds one policy fixed. The other honest reading of "moving up a
band" is that the advisor tracks you: your floor is at band *k*, so you set the
app's baseline to *k* (which is what the app tells you to do — baseline = your
weakest equipped gem's grade) and cut until something lands at *k+1*. Same
engine, gpd fixed at 2.5M, `--bl` = the row you are standing on:

| step | policy baseline | gold per step | SE | raw gems drawn | gems processed | dismantled unprocessed |
|---|---:|---:|---:|---:|---:|---:|
| C− → C | 60 | 43,245 | 121 | 1.6 | 1.6 | 0% |
| C → C+ | 63.3 | 51,870 | 164 | 1.9 | 1.9 | 0% |
| C+ → B− | 66.7 | 63,581 | 228 | 2.3 | 2.3 | 0% |
| B− → B | 70 | 82,554 | 351 | 3.1 | 3.1 | 0% |
| B → B+ | 73.3 | 104,625 | 550 | 4.6 | 4.6 | 0% |
| B+ → A− | 76.7 | 103,021 | 733 | 8.4 | 8.4 | 0% |
| A− → A | 80 | 131,226 | 1,279 | 15.5 | 15.2 | 1.6% |
| A → A+ | 83.3 | 139,981 | 2,384 | 47.1 | 27.5 | 41.6% |
| A+ → S− | 86.7 | 147,517 | 3,532 | 186.2 | 36.7 | 80.3% |
| S− → S | 90 | 156,588 | 8,721 | 996.7 | 42.9 | 95.7% |
| S → S+ | 93.3 | 109,945 | 11,943 | 3,947.4 | 35.8 | 99.1% |

(N = 150,000 cuts for baselines 60–83.3, 300,000 for 86.7–93.3, same seed.)

**The gold ladder is almost flat and the gem ladder is not.** Every step from
C− to S+ costs between 43k and 157k gold, but the raw gems it eats go from 1.6
to 3,947 — a 2,400× climb. The reason is mechanical: as the baseline rises the
DP refuses to touch pairs that cannot reach it, and a refused gem is free, so
gold per cut falls from 27,475g at baseline 60 to 27g at baseline 93.3 while the
number of gems you must sift through explodes.

Use §3's fixed-policy table for the chart. This one is here because it shows,
unambiguously, that **above A+ the Ark Grid is not a gold sink — it is a raw-gem
sink**, and any single gold-per-damage number for the top rows is really a
statement about how many astrogems you can farm.

---

## 4. Band → party damage

`supportDamage` is **per dealer** (coefficients stored ÷3), so the chart's
partySize = 3 multiplies it and the numbers line up with the astrogem tool.
One gem, per-dealer %, two independent readings:

| row | mean of gems **in** the band, from all 11,250 configs | same, from the 300k cut stream | sd (configs) |
|---|---:|---:|---:|
| C− | 0.14497% | 0.13683% | 0.031 |
| C | 0.15317% | 0.14710% | 0.029 |
| C+ | 0.15637% | 0.14926% | 0.024 |
| B− | 0.17363% | 0.16728% | 0.025 |
| B | 0.18408% | 0.17805% | 0.021 |
| B+ | 0.19821% | 0.19164% | 0.019 |
| A− | 0.20572% | 0.20065% | 0.017 |
| A | 0.21903% | 0.21216% | 0.017 |
| A+ | 0.23232% | 0.22534% | 0.017 |
| S− | 0.24575% | 0.23759% | 0.016 |
| S | 0.26179% | 0.25791% | 0.015 |
| S+ | 0.26977% | 0.25951% | 0.019 |

Reference points: a perfect support c8 carries 0.23667%, c9 0.26150%,
c10 0.29867% per dealer.

Scale-up rules, in case the chart wants a whole grid rather than one gem:

- A full grid is **24 gems** (6 cores × 4 slots; for a support both the Order
  and Chaos sides are live). Moving the whole grid up one band is 24 × the
  per-gem step, in gold and in damage alike — the **ratio is unchanged**, so the
  chart can plot the per-gem numbers and the y-value is identical.
- Per-gem grades use the lvl-30 marginal yardstick and deliberately do **not**
  sum to the whole-grid total. Do not add these up for a grid figure; call
  `A.gridDamage(gems, "support")`, which uses the level-0 model and the per-core
  order rates.

---

## 5. Caveats worth putting on the chart

**1. The row assumes free raw gems, and that assumption does all the work at
the top.** Gold is not the binding resource above A+. At T2 an S+ costs 2.8M
gold but **333 raw astrogems drawn**. Push the advisor's baseline up and it
dismantles more fresh gems for free, so gold per S+ collapses while the gem
count explodes:

| policy | dismantled unprocessed | gold per S+ | raw gems drawn per S+ |
|---|---:|---:|---:|
| baseline 80 / 2.5M (T2) | 1.6% | 2,839,821 | 333 |
| baseline 85 / 6M (T1) | 8.1% | 1,748,339 | 285 |
| baseline 90 / 6M | 81.5% | 479,865 | 676 |
| baseline 93.3 / 6M | 96.2% | 269,577 | 1,923 |

A tenfold gold saving costs a sixfold gem supply, and §3's self-consistent
ladder pushes that to 3,947 gems for the last rung. If the chart claims a single
gold number for S+, it must state the gem budget it assumes. **Use T2 (333 gems
per S+) unless there is a better estimate of a support's real astrogem income.**

**2. The S → S+ rung is only 1.3 grade points wide**, because S+ is pinned to
the perfect c8 grade (94.6) rather than sitting on the even 3.33 grid. Its
gold-per-damage therefore reads roughly double what a full band would, and that
is a scale artefact, not a game fact. Label it.

**3. The cost mix matters and is loadout-specific.** 60:30:10 is the account
study's mix and is what was asked for, but the repo's own finding is that
**c9 cuts clear ~7× more often than c10 at the whale bar** (5.0% vs 0.7% at DPS
90) — c9 has the effect pool plus one less effective cost, while c10 pays the
deepest budget tax at any willpower short of 5. That shows up in our hit mix: at
T2, S+ hits split 200 c8 / 391 c9 / 310 c10 despite the 60:30:10 draw. The law
from the account study — **fuse spares toward 9s unless the grid is strong
enough that only near-perfect 10s can improve it** — applies here too.

**4. Steering fusion output to c10 helps only at the top, and barely.** At
baseline 85 / 2.5M, `--fuse-target=10` versus keeping the input cost moved C−
by 0.2% and S+ from 940,168 ± 145,925 to 786,661 ± 111,493 — a 0.8 standard-error
gap on 25,000 cuts, so directionally right (c10 has the higher ceiling) but not
measured. Not chart-worthy on its own.

**5. Grade is a noisy proxy for support damage at the bottom of the ladder.**
The in-band damage spread is sd 0.031 at C− against 0.016 at S− — more than
twice as wide. The cause is structural: on the support axis, c8's Attack Power
and Additional Damage and c9's Boss Damage all score exactly zero, so a
high-willpower gem with two dead lines can grade C+ while delivering almost no
party damage. Below B− the band→damage mapping should carry an error bar, or the
chart should start the row at B−.

**6. Nothing here is unreachable, but the top is thin.** Every row was hit at
every policy. S+ landed 901 times in 300,000 cuts at T2 (0.30%), 1,053 at T1.
The standard errors above are 3–5% at the top rows and under 1% below A.

**7. This is a gold-bound cut policy, not the roster-bound one the constants
were fitted on.** `DP.Solver(baseline, gpd, false, ...)` — processing costs
count, so the advisor abandons hopeless pairs. That is the right policy for a
gold question. The fitted-constants corpus used `rosterBound = true` (processing
free), which pushes gems further and reads about 5 percentage points higher at
every band. Do not mix the two.

**8. Related findings from the owner's own account study**, worth showing beside
the row: cut c9 early, c10 late, c8 never; grade-greedy rosters give up 7–9% of
the grid versus letting the packer choose; and the average equipped grade a
support reaches at each wealth tier is 83.7 (A) at 6M, 79.2 (B+) at 2.5M,
74.0 (B) at 1M — which is where on this row a real support actually sits.

---

## Appendix A — the harness

Save as `band-cost.js`, run from `~/loastuff/loa-astrogem-calc`. Requires only
that repo's model files.

```js
"use strict";
var REPO = "C:/Users/Shizu/loastuff/loa-astrogem-calc";
var A = require(REPO + "/model/astrogem.js");
var DP = require(REPO + "/model/dp.js");
var Econ = require(REPO + "/loadout-econ.js");
var Engine = require(REPO + "/tools/lib/cut-engine.js");
var mulberry32 = Engine.mulberry32, fnv1a = Engine.fnv1a, cutOneGem = Engine.cutOneGem;

var ARGS = {};
process.argv.slice(2).forEach(function (a) {
  var m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) ARGS[m[1]] = m[2] === undefined ? true : m[2];
});
var N = parseInt(ARGS.n, 10) || 20000;
var SEED = String(ARGS.seed || "gpd-2026-08-13");
var GPD = parseInt(ARGS.gpd, 10) || 2500000;
var BL = parseFloat(ARGS.bl) || 80;
var FUSE_TARGET = String(ARGS["fuse-target"] || "same");        // "same" | "10"
var MIX = (function () {
  var p = String(ARGS.mix || "60,30,10").split(/[:,/]/).map(Number);
  return { 8: p[0] / 100, 9: p[1] / 100, 10: p[2] / 100 };
})();
var BANDS = ARGS.bands ? String(ARGS.bands).split(",").map(Number) : Econ.GRADE_ROWS_SUPPORT;
var LADDER = A.SUPPORT_RANK_LADDER;
function letterOf(g) { for (var i = 0; i < LADDER.length; i++) if (g >= LADDER[i][1] - 1e-9) return LADDER[i][0]; return "F-"; }

// uniform gem of (cost, tier) -- lifted from tools/account-study.js (roster study)
var _partCache = {};
function partsOfSum(s) {
  if (_partCache[s]) return _partCache[s];
  var out = [];
  for (var w = 1; w <= 5; w++) for (var o = 1; o <= 5; o++)
    for (var a = 1; a <= 5; a++) for (var b = 1; b <= 5; b++)
      if (w + o + a + b === s) out.push([w, o, a, b]);
  _partCache[s] = out; return out;
}
function sampleTierGem(cost, tierName, rand, gemType) {
  var sumDist = A.outputLevelSumDist(tierName);
  var r = rand(), acc = 0, sum = null;
  Object.keys(sumDist).forEach(function (k) { if (sum !== null) return; acc += sumDist[k]; if (r <= acc) sum = parseInt(k, 10); });
  if (sum === null) sum = parseInt(Object.keys(sumDist).pop(), 10);
  var parts = partsOfSum(sum), p = parts[Math.floor(rand() * parts.length)];
  var pool = A.EFFECT_POOLS[cost];
  var i = Math.floor(rand() * pool.length), j = Math.floor(rand() * (pool.length - 1));
  if (j >= i) j++;
  return { baseCost: cost, gemType: gemType || "order", willpowerLevel: p[0], orderLevel: p[1],
    effect1: pool[i], effect1Level: p[2], effect2: pool[j], effect2Level: p[3] };
}
function drawTier(dist, rand) {
  var r = rand();
  if (r <= dist.legendary) return "legendary";
  if (r <= dist.legendary + dist.relic) return "relic";
  return "ancient";
}
function pairsOf(cost) {
  var pool = A.EFFECT_POOLS[cost], out = [];
  for (var i = 0; i < pool.length; i++) for (var j = i + 1; j < pool.length; j++) out.push([pool[i], pool[j]]);
  return out;
}
function pickCost(r) { return r < MIX[8] ? 8 : (r < MIX[8] + MIX[9] ? 9 : 10); }

// ---------- 1. cut the shared stream ----------
var baselineValue = A.supportGradeToScore(BL);
var solvers = {};
var ROSTER_BOUND = !!ARGS.rb;          // --rb reproduces the fit corpus (processing free)
[8, 9, 10].forEach(function (c) {
  solvers[c] = new DP.Solver(baselineValue, GPD, ROSTER_BOUND, { axis: "support", maxTurns: Engine.EPIC.maxTurns });
});
var cutRand = mulberry32(fnv1a("cut:" + SEED + ":" + BL + ":" + GPD));
var pairs = { 8: pairsOf(8), 9: pairsOf(9), 10: pairsOf(10) };
var stream = new Array(N);
var totalCutGold = 0, dismantled = 0, resets = 0;
for (var n = 0; n < N; n++) {
  var cost = pickCost(cutRand());
  var pr = pairs[cost][Math.floor(cutRand() * pairs[cost].length)];
  var res = cutOneGem(solvers[cost], { baseCost: cost, gemType: "order", effect1: pr[0], effect2: pr[1] }, cutRand, true);
  totalCutGold += res.spent; resets += res.resets;
  var rec = { gold: res.spent, cfg: null, grade: 0, dmg: 0, ls: 0 };
  if (res.processes > 0) {
    rec.cfg = res.cfg; rec.grade = A.supportGrade(res.cfg);
    rec.dmg = A.supportDamage(res.cfg); rec.ls = A.levelSum(res.cfg);
  } else dismantled++;
  stream[n] = rec;
}

// ---------- 2. per-row fusion cascade replay ----------
function runBand(band) {
  var fuseRand = mulberry32(fnv1a("fuse:" + SEED + ":" + BL + ":" + GPD + ":" + band));
  var eG = new Float64Array(N), eS = new Float64Array(N), eSc = new Float64Array(N), eGc = new Float64Array(N);
  var fusions = 0, cutSucc = 0, fuseSucc = 0, dmgSum = 0, dmgN = 0, gradeSum = 0;
  for (var n = 0; n < N; n++) {
    var rec = stream[n], g0 = rec.gold, s0 = 0;
    eGc[n] = rec.gold;
    var queue = [];
    if (rec.cfg) {
      if (rec.grade >= band) {
        cutSucc++; s0++; eSc[n] = 1;
        dmgSum += rec.dmg; dmgN++; gradeSum += rec.grade;
      } else if (rec.ls >= 16) queue.push(rec.cfg);
    }
    var guard = 0;
    while (queue.length && guard++ < 500) {
      var fg = queue.pop();
      fusions++; g0 += A.COSTS.fusion;
      var inTier = A.classifyTier(A.levelSum(fg));
      var outTier = drawTier(A.fusionOutputDist([inTier, "legendary", "legendary"]), fuseRand);
      if (outTier === "legendary") continue;                   // dismantled
      var outCost = (FUSE_TARGET === "same") ? fg.baseCost
        : (fuseRand() < 2 / 3 ? parseInt(FUSE_TARGET, 10) : fg.baseCost);
      var outCfg = sampleTierGem(outCost, outTier, fuseRand, "order");
      var og = A.supportGrade(outCfg);
      if (og >= band) {
        fuseSucc++; s0++;
        dmgSum += A.supportDamage(outCfg); dmgN++; gradeSum += og;
      } else if (A.levelSum(outCfg) >= 16) queue.push(outCfg);
    }
    eG[n] = g0; eS[n] = s0;
  }
  function ratio(G, S) {                                       // delta-method SE
    var sg = 0, ss = 0, i;
    for (i = 0; i < N; i++) { sg += G[i]; ss += S[i]; }
    if (ss === 0) return { r: Infinity, se: Infinity };
    var R = sg / ss, mS = ss / N, v = 0;
    for (i = 0; i < N; i++) { var d = G[i] - R * S[i]; v += d * d; }
    v /= (N - 1);
    return { r: R, se: Math.sqrt(v / N) / mS };
  }
  var withF = ratio(eG, eS), noF = ratio(eGc, eSc), succ = cutSucc + fuseSucc;
  return { band: band, letter: letterOf(band), succ: succ, fusions: fusions,
    goldPerHit: withF.r, goldSE: withF.se, gemsPerHit: succ ? N / succ : Infinity,
    processedPerHit: succ ? (N - dismantled) / succ : Infinity,
    goldPerHitNoFuse: noF.r, gemsPerHitNoFuse: cutSucc ? N / cutSucc : Infinity,
    meanDamage: dmgN ? dmgSum / dmgN : null, meanGrade: dmgN ? gradeSum / dmgN : null };
}

var out = BANDS.map(runBand);
console.log("# baseline " + BL + "  gpd " + GPD + " x" + A.SUPPORT_GPD_MULTIPLIER + "  N=" + N +
  "  seed=" + SEED + "  mix=" + (MIX[8] * 100) + ":" + (MIX[9] * 100) + ":" + (MIX[10] * 100) +
  "  fuse-target=" + FUSE_TARGET + "  MODEL_SIG=" + A.MODEL_SIG);
console.log("# cut stream " + Math.round(totalCutGold) + "g, " + dismantled + " dismantled unprocessed, " + resets + " resets");
console.log(["band", "letter", "hits", "gold/hit", "SE", "drawn/hit", "processed/hit", "goldNoFuse", "meanDmg%", "meanGrade", "fusions"].join("\t"));
out.forEach(function (r) {
  console.log([r.band, r.letter, r.succ, Math.round(r.goldPerHit), Math.round(r.goldSE),
    r.gemsPerHit.toFixed(2), r.processedPerHit.toFixed(2), Math.round(r.goldPerHitNoFuse),
    r.meanDamage != null ? r.meanDamage.toFixed(5) : "-",
    r.meanGrade != null ? r.meanGrade.toFixed(2) : "-", r.fusions].join("\t"));
});
if (ARGS.out) require("fs").writeFileSync(ARGS.out, JSON.stringify({
  meta: { N: N, seed: SEED, bl: BL, gpd: GPD, mix: MIX, fuseTarget: FUSE_TARGET, sig: A.MODEL_SIG,
    totalCutGold: totalCutGold, dismantled: dismantled, resets: resets }, rows: out }, null, 1));

// ---------- 3. damage of a gem SITTING IN each band (the §4 cut-stream column) ----------
console.log("\nband\tletter\tn\tmeanDmg%\tsd\tmeanGrade");
for (var bi = 0; bi < BANDS.length; bi++) {
  var lo = BANDS[bi], hi = (bi + 1 < BANDS.length) ? BANDS[bi + 1] : Infinity;
  var s = 0, ss = 0, c = 0, gs = 0;
  for (var k = 0; k < N; k++) {
    var r0 = stream[k];
    if (!r0.cfg || r0.grade < lo || r0.grade >= hi) continue;
    s += r0.dmg; ss += r0.dmg * r0.dmg; c++; gs += r0.grade;
  }
  var m = c ? s / c : 0;
  console.log([lo, letterOf(lo), c, c ? m.toFixed(5) : "-",
    c > 1 ? Math.sqrt(Math.max(0, ss / c - m * m)).toFixed(5) : "-",
    c ? (gs / c).toFixed(2) : "-"].join("\t"));
}
```

## Appendix B — the grade→damage fit

```js
var A = require("C:/Users/Shizu/loastuff/loa-astrogem-calc/model/astrogem.js");
var all = [];
[8, 9, 10].forEach(function (bc) {
  var pool = A.EFFECT_POOLS[bc];
  for (var i = 0; i < pool.length; i++) for (var j = i + 1; j < pool.length; j++)
    for (var w = 1; w <= 5; w++) for (var o = 1; o <= 5; o++)
      for (var a = 1; a <= 5; a++) for (var b = 1; b <= 5; b++) {
        var cfg = { baseCost: bc, gemType: "order", willpowerLevel: w, orderLevel: o,
          effect1: pool[i], effect1Level: a, effect2: pool[j], effect2Level: b };
        all.push({ g: A.supportGrade(cfg), d: A.supportDamage(cfg) });
      }
});
var sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
all.forEach(function (x) { if (x.g < 50) return; sx += x.g; sy += x.d; sxx += x.g * x.g; sxy += x.g * x.d; n++; });
var slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
console.log(slope, (sy - slope * sx) / n, n);   // 0.002948  -0.036849  5452
```

---

## Raw output — the headline run

```
# ark-grid band cost -- axis=support  policy: baseline grade 80 (supportValue 0.21860), gpd 2500000 x3 party inside the model
# N=300000 fresh epic cuts  seed=gpd-2026-08-13  mix=60:30:10  fuse-target=same  MODEL_SIG=12u9hug
# cut stream: 2,512,795,400g total, 8,376g per cut, 4700 dismantled unprocessed (1.6%), 29695 resets, 53s

band  letter hits    p(hit)  gold/hit SE    drawn/hit processed/hit goldNoFuse gemsNoFuse meanDmg% meanGrade fusions hits c8/c9/c10
60    C-     102399  0.34133 24583    65    2.93      2.88          25036      2.99       0.17332  73.41     9044    62964/31262/8173
63.3  C      90221   0.30074 27925    80    3.33      3.27          28724      3.43       0.17869  75.15     13273   55326/27741/7154
66.7  C+     76239   0.25413 33092    105   3.93      3.87          34606      4.13       0.18508  77.23     20173   47026/23152/6061
70    B-     63218   0.21073 39972    141   4.75      4.67          42579      5.08       0.19321  79.30     28328   38053/19863/5302
73.3  B      49277   0.16426 51382    210   6.09      5.99          56005      6.69       0.20132  81.71     38265   29492/15568/4217
76.7  B+     37837   0.12612 67049    319   7.93      7.80          74218      8.86       0.20918  83.93     48253   21913/12555/3369
80    A-     28860   0.09620 88045    488   10.40     10.23         98030      11.70      0.21507  85.71     56358   16183/9977/2700
83.3  A      19576   0.06525 130043   892   15.32     15.08         146750     17.52      0.22220  87.59     65864   9748/7659/2169
86.7  A+     10120   0.03373 252135   2447  29.64     29.18         290295     34.66      0.23227  90.03     77615   4560/4222/1338
90    S-     3845    0.01282 664784   10619 78.02     76.80         797966     95.27      0.24394  92.90     86595   1541/1547/757
93.3  S      1297    0.00432 1972469  54608 231.30    227.68        2620225    312.83     0.25819  95.70     90995   211/674/412
94.6  S+     901     0.00300 2839821  94411 332.96    327.75        3801506    453.86     0.25866  96.43     91766   200/391/310

# support damage of a gem SITTING IN each band (cut stream, not the >= tail)
band  letter n      meanDmg%  sd       meanGrade
60    C-     12886  0.13683   0.03011  61.64
63.3  C      14869  0.14710   0.02701  64.89
66.7  C+     13596  0.14926   0.01931  68.18
70    B-     14148  0.16728   0.02262  71.56
73.3  B      11010  0.17805   0.01981  75.05
76.7  B+     8224   0.19164   0.01947  78.62
80    A-     8510   0.20065   0.01438  81.99
83.3  A      8467   0.21216   0.01471  85.10
86.7  A+     5507   0.22534   0.01475  88.29
90    S-     2190   0.23759   0.01366  91.55
93.3  S      298    0.25791   0.01493  93.98
94.6  S+     661    0.25951   0.01826  96.41
```

## Sources

- `~/loastuff/loa-astrogem-calc/METHODOLOGY.md` §1–4, §7a
- `~/loastuff/loa-astrogem-calc/docs/how-a-gem-is-graded.md` §6, §8
- `~/loastuff/loa-astrogem-calc/docs/roster-adaptive-studies-2026-08-10.md` §2–5
- `~/loastuff/loa-astrogem-calc/model/astrogem.js` (`SUPPORT_SCORING` :597,
  `SUPPORT_GPD_MULTIPLIER` :615, `SUPPORT_ORDER_PER_CORE` :672,
  `supportValue` :753, `supportGrade` :823, `supportGradeToScore` :835)
- `~/loastuff/loa-astrogem-calc/loadout-econ.js` (`GRADE_ROWS_SUPPORT` :56)
- `~/loastuff/loa-astrogem-calc/tools/lib/cut-engine.js`,
  `tools/account-study.js` (`rosterEquipFuse`, `sampleTierGem`)

---

## Correction, 14 August 2026 — the grid is twenty-four gems, not twelve

The rows first shipped here priced **twelve** gems. The grid holds **six cores
of four**, so it is **twenty-four**. Order and chaos gems draw from the same
effect pools — maxroll's `arkGridGems` lists `attr` 0 and `attr` 1 with
identical option lists — so all twenty-four feed the same three side nodes.
That is also why a node caps at 120 in `arkGridGemOptions`: forty-eight effect
lines at level five.

Two things changed with it.

**Gold doubled.** The band-cost harness reports gold per hit for one gem, and
the row multiplies by the gem count.

**Damage no longer comes from a fitted line.** It was
`0.002948 x grade - 0.036849` per gem, times twelve — a regression fitted over
gems grading 50 and up, extrapolated below that to price the first rung. It now
comes from `tools/arkgrid-bands.js`, which builds a real twenty-four gem grid
at each band and scores it with the astrogem calculator's own `gridDamage`:
side-node levels with their log dilution, plus each core's bonus for points
above seventeen.

The two errors had been pulling against each other, so the headline barely
moved — a support A grid reads 2.59% per dealer against the old 2.50%. What
moved is the cost. At the same damage the grid now costs twice as much, so it
sits far lower on the chart than it did.

### What the bands look like

Node levels and core points are read off four thousand grids per band, each
twenty-four gems drawn from that band's pool, then straightened with a line
fitted over C- and up. Below C- the sampled levels flatten towards zero and
would drag the fit down; above it they sit almost exactly straight in the grade.

| band | support side nodes | party damage | DPS side nodes | damage |
|---|---|---:|---|---:|
| C-   | 17 / 27 / 26 | 2.71% | 21 / 30 / 27 | 3.57% |
| C    | 25 / 30 / 27 | 3.38% | 24 / 36 / 32 | 4.40% |
| B    | 49 / 42 / 32 | 5.56% | 33 / 49 / 43 | 7.55% |
| A    | 74 / 53 / 37 | 8.13% | 41 / 61 / 52 | 11.21% |
| A+   | 82 / 57 / 39 | 9.01% | 44 / 67 / 56 | 12.45% |
| S    | 98 / 64 / 42 | 10.70% | 49 / 79 / 64 | 14.66% |
| S+   | 101 / 66 / 43 | 11.04% | 51 / 84 / 68 | 15.34% |

Support nodes read ally attack / brand / ally damage, DPS attack power / boss
damage / additional damage. Support numbers are party damage, three dealers.

### The nodes are not even, and should not be

The draw is uniform within a band, and the three nodes still come out lopsided.
That is the grade talking. The astrogem calculator scores a support gem's lines
at 0.019533 for ally attack enhancement, 0.014567 for brand power and 0.007133
for ally damage enhancement, so a gem carrying ally attack is the gem that
grades well, and a band's pool is full of them.

`tools/arkgrid-split.js` asks the separate question of how a support *should*
divide the levels, scoring each split through `model/support.js` rather than
through the grade. At the reference character one more node level is worth

| node | party damage per level |
|---|---:|
| ally attack enhancement | 0.0689% |
| brand power | 0.0437% |
| ally damage enhancement | 0.0210% |

Same ordering as the grade, and near enough the same ratios — two models built
from different sources agreeing that ally damage enhancement is worth about a
third of ally attack.

**Correction, 15 August 2026.** This section first shipped claiming a best
split of 120 / 120 / 0 from twenty-four cost-10 gems. That build cannot exist:
at willpower five a cost-10 gem still has effective cost 5, four of them need
20 against a core cap of 17, so a core holds at most two. The enumeration now
carries the budget as two closed rules (n10 <= 12, and a two-c10 core has room
for at most one c9), and the honest numbers are smaller.

The best REACHABLE split is **120 ally attack / 30 brand / 90 ally damage** —
six cost-10 and eighteen cost-9 gems — worth 11.47% party damage against
10.72% for an even 80/80/80. A gap of 0.75 points, not the 2.79 first claimed.

The DPS axis, corrected the same way (its pools pair differently: attack rides
c8+c9, boss c9+c10, additional c8+c10): best reachable is **60 attack power /
90 boss / 90 additional** at 17.34% against 16.63% even — 0.71 points.

An even split is the one shape nobody should build, and
60/60/60 on the reference character is about a B grid in total levels but the
wrong shape for any of them.

---

## The account model, 15 August 2026 — what the card actually shows

The band ladder above prices a grid where all twenty-four slots clear a grade.
The card's headline, example and effort figures come from a different machine:
`tools/arkgrid-account.js` simulates an account building its grid under every
constraint the game imposes. The audit that forced this section also found the
first shipped account dataset predated most of these rules; everything below
describes the tool as it stands, and the data is regenerated from it.

**The rules, in the order they bite:**

- **Two halves, never mixed.** Order gems go in order cores, chaos in chaos.
  Twelve slots each, separate inventories, and a superb chaos gem does nothing
  for a weak order core.
- **A core is four gems against two seventeens.** The four effective costs
  (base cost minus willpower) must FIT inside 17 — the perfect core is exactly
  5+5+4+3 — while only order points ABOVE 17 pay anything. Each core is packed
  by an exact DP over (gems used, willpower spent, order points), and all six
  orderings of a half's three cores are tried because the greedy fill is
  order-dependent.
- **Sub-17 cores tax the whole grid** — Shizu's -3/-6/-9 bands, ported from the
  calculator's own account study, sit in the packer's OBJECTIVE so it forces
  seventeens wherever the collection allows. They are NOT subtracted from the
  reported damage: they stand for core thresholds the gear baseline already
  carries, and subtracting them let a low-budget grid report negative damage,
  which no set of equipped gems can do.
- **Unequipped gems are kept.** A core can be re-packed 4+4+4+5 into 3+4+5+5,
  so a cheap high-willpower gem earns its slot by letting an expensive one fit
  beside it. The inventory holds the best twenty-six a side by damage, but a
  gem at effective cost four or less is never pruned while anything dearer
  remains — the enablers are the point.
- **Roster-bound advisor.** The DP that decides each cut runs roster-bound,
  matching the corpus the live constants were fitted on and the calculator's
  own default advice. Off, the advisor abandons gems to save gold the cutter
  charges anyway, and the chart reads cheaper than a player actually pays.
- **The advisor tracks you.** Its baseline is the grade of the weakest gem you
  are wearing, snapped to band cuts; its gold-per-damage is the budget on the
  slider. Both move as the grid improves.

Damage is scored by the astrogem calculator's own `gridDamage` with the
per-core order rates converted to linear form (`exp(v/100) - 1`) exactly as the
calculator converts them — the first port passed the raw log-value and
mis-priced order roughly ninety-fold, which is the kind of thing the packer's
brute-force self-test exists to catch.

Every budget is averaged over four accounts sharing solver caches. The trace
stops where a twelve-socket window's marginal gold per damage crosses the
budget, and the monotone carry guarantees a richer budget never reports a
worse grid.

### The band-vs-account gap, measured on the final data

At a 2M budget, same damage on both sides, roster-bound throughout, on the
deep corrected-stop runs (6,000 gems, two accounts a budget): the band ladder
pays **3.3x the gold and 3.1x the gems** of the account model on epics (8.87M /
331 gems against 2.71M / 107 for 2.09% per dealer) and **3.2x / 3.2x** on
rares. Two earlier figures preceded this one — a 2.5-5x with a floor-damage
artefact, then a 3.9x / 2.4x measured on accounts whose stopping rule quit at
the first drought — both retracted; the comparison is clean now, and still
large. The reason
stands: demanding all twenty-four slots clear one grade buys uniformity that
adds nothing. Shizu ruled on 15 August: **the chart prices the account model.** The rows in
data/arkgrid-rows-{epic,rare}.json are pooled stretches of the account trace
(tools/build-arkgrid-account-rows.js), so the price, the damage, the pill, the
example and the effort all describe one simulated grid. The band ladder stays
in this file as the uniformity-cost reference, nothing more.
