# Upgrade-cost study — does the willpower multiplier price upgrades right?

*2026-08-06 · `tools/upgrade-cost-study.js` · 10 profiles × 3 costs × 10,000 until-upgrade trials per variant, seeded and reproducible. Data: `docs/study-data-2026-08-06/`.*

## Question

Side effects and order/chaos points add damage; scoring them is arithmetic. Willpower is
priced by the multiplier `M(effectiveCost)` — calibrated only so that perfect gems of
every base cost tie at grade 100. This study measures what that pricing does to real
upgrade hunting: cut epic gems at cost 8, 9, or 10 until one upgrades your grid — how
many gems, how much gold, and how much damage do you actually gain?

## Design

Fixed across all variants (locked by interview):

- **Characters**: Mira, Paroxysmal (Gunslingers), Gettingcards, Craftedswifts
  (Arcanists), Limerent (Bard — support axis). Order and chaos separately: 10 profiles.
- **Policy**: the advisor's exact DP at the grader's per-type recommended baseline
  (bumped 3rd-lowest) and CP-derived gpd (Mira / Paroxysmal / Gettingcards 5M,
  Craftedswifts / Limerent 2.5M). Advisor-style resets included (20k, once per gem,
  taken when the advisor's ranking would take it). Epic gems only (9 turns, 3 rerolls).
- **Gem pool**: every attempt draws a uniform-random effect pair; the DP may dismantle
  a worthless pair unprocessed (0 gold) — that still counts as a gem.
- **Gold**: NRB. Processing (0–1,800 per turn), paid reroll (3,800), resets (20,000).
  Gems themselves free.
- **Gain**: raw whole-grid damage — `gridDamage` (stat buckets with diminishing
  returns, per-core order points with the 17-point floor) for the chosen swap.
  Willpower never enters it. The same swap's value delta (includes M) rides alongside.

**The final criterion (v4, Shizu's rule)**: a finished gem is an upgrade when swapping
it in for an equipped gem of the **same base cost** (like for like) raises raw
whole-grid damage, under the willpower budget. Two facts ground the constraint side:
core cost layouts vary freely by player (Mira runs 10/8/9/9 cores, Craftedswifts has an
8/8/8/8 core), so sockets are not cost-typed — but every observed core packs **exactly**
to its willpower supply:

| Character | Per-core effective-cost sums |
|---|---|
| Mira | 17 17 17 17 17 17 |
| Paroxysmal | 15 15 17 15 15 17 |
| Limerent | 17 17 15 15 17 15 |
| Gettingcards | 15 15 15 17 17 17 |
| Craftedswifts | 15 17 15 15 15 15 |

Zero slack anywhere, so a same-cost swap fits iff **wpLevel(new) ≥ wpLevel(replaced)**.
A cost with no equipped same-cost gem on that side cannot upgrade at all.

Three earlier criterion variants were run on the way here and are kept as the
bracketing evidence (tables at the end):

| Variant | Upgrade rule | What it revealed |
|---|---|---|
| v1 | value (grade scale) beats the weakest equipped | the model's own scale approves damage-LOSING swaps when the weakest-by-value gem is damage-rich but willpower-poor (up to 100% of winners) |
| v2 | best raw swap over ANY same-type slot, no budget | c10 cheapest everywhere — but 26–89% of its picks value-vetoed and mostly unequippable |
| v3 | v2 + budget, cross-cost swaps allowed | the willpower tax is 7–11× at c10; cheapest cost became loadout-dependent |
| **v4** | **same-cost swap + budget (primary)** | see findings |

**Validation**: the rollout reproduces the exact DP's W on leveraged states to within
1.3–1.7% (the documented WoR band); DP selfcheck 8/8 at run time; the fast swap
evaluator self-tests against a full `gridDamage` recompute per cell.

## Primary results — v4 (same-cost, willpower-feasible)

Slots = equipped same-cost gems on that side (the replacement targets). p(wp-free) =
same batch without the willpower requirement — the gap is the pure willpower tax at
fixed cost. value-vetoed = winners whose swap the value scale would reject.

| Profile | Cost | Slots | p(feasible)/gem | p(wp-free) | Gems mean (p50/p90) | Gold mean | …proc/reroll/reset | Δ raw grid | Δ value | value-vetoed | Winner wp | Resets/trial |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Mira order | c8 | 3 | 0.4% | 0.9% | 245.8 (169/561) | 208.3k | 192.0k/16.2k/0 | 0.0665% | 0.0807 | 0.0% | 5.00 | 0.00 |
| Mira order | c9 | 6 | 0.5% | 1.0% | 198.9 (140/456) | 164.3k | 152.2k/12.1k/0 | 0.0876% | 0.0940 | 3.8% | 4.84 | 0.00 |
| Mira order | c10 | 3 | 0.3% | 0.6% | 331.7 (228/763) | 214.5k | 200.3k/14.2k/0 | 0.0885% | 0.0867 | 5.3% | 4.90 | 0.00 |
| Mira chaos | c8 | 4 | **0.0%** | 0.0% | — | — | — | — | — | — | — | — |
| Mira chaos | c9 | 6 | 0.7% | 1.2% | 151.7 (104/344) | 554.4k | 508.1k/46.3k/0 | 0.0544% | 0.1355 | 0.0% | 4.62 | 0.00 |
| Mira chaos | c10 | 2 | 0.8% | 2.0% | 125.7 (88/289) | 252.3k | 232.8k/19.5k/0 | 0.1123% | 0.1190 | 0.0% | 5.00 | 0.00 |
| Paroxysmal order | c8 | 7 | 15.0% | 26.4% | 6.8 (5/15) | 164.9k | 71.4k/13.4k/80.1k | 0.1104% | 0.0889 | 11.8% | 4.70 | 4.00 |
| Paroxysmal order | c9 | 5 | 10.8% | 17.0% | 9.2 (7/20) | 224.6k | 96.8k/18.1k/109.8k | 0.1179% | 0.1106 | 7.8% | 4.69 | 5.49 |
| Paroxysmal order | c10 | 0 | — | — | — | — | — | — | — | — | — | **no slots** |
| Paroxysmal chaos | c8 | 6 | 7.2% | 15.2% | 13.8 (10/31) | 141.8k | 91.1k/12.4k/38.3k | 0.1153% | 0.1266 | 3.8% | 4.83 | 1.92 |
| Paroxysmal chaos | c9 | 6 | 6.6% | 11.9% | 16.0 (11/36) | 163.4k | 104.7k/14.0k/44.7k | 0.1264% | 0.1270 | 5.0% | 4.76 | 2.24 |
| Paroxysmal chaos | c10 | 0 | — | — | — | — | — | — | — | — | — | **no slots** |
| Limerent order | c8 | 10 | 23.6% | 42.4% | 4.1 (3/9) | 70.8k | 36.3k/6.5k/28.0k | 0.0272% | 0.0126 | 28.7% | 4.53 | 1.40 |
| Limerent order | c9 | 2 | 21.2% | 31.9% | 4.5 (3/10) | 75.6k | 38.8k/6.8k/30.0k | 0.0276% | 0.0300 | 22.6% | 4.63 | 1.50 |
| Limerent order | c10 | 0 | — | — | — | — | — | — | — | — | — | **no slots** |
| Limerent chaos | c8 | 8 | 16.1% | 34.3% | 6.1 (4/13) | 59.0k | 39.3k/5.6k/14.2k | 0.0302% | 0.0261 | 16.2% | 4.69 | 0.71 |
| Limerent chaos | c9 | 3 | 6.3% | 12.4% | 16.3 (12/37) | 156.6k | 104.1k/14.5k/38.0k | 0.0224% | 0.0221 | 2.1% | 4.84 | 1.90 |
| Limerent chaos | c10 | 1 | 2.7% | 6.4% | 36.9 (26/85) | 279.6k | 182.2k/20.1k/77.3k | 0.0267% | 0.0276 | 0.0% | 5.00 | 3.86 |
| Gettingcards order | c8 | 7 | 2.7% | 7.1% | 40.9 (29/93) | 140.4k | 129.0k/11.3k/0 | 0.1255% | 0.1525 | 0.0% | 5.00 | 0.00 |
| Gettingcards order | c9 | 4 | 1.1% | 2.2% | 87.6 (61/197) | 320.3k | 293.4k/26.9k/0 | 0.0693% | 0.0757 | 0.0% | 4.77 | 0.00 |
| Gettingcards order | c10 | 1 | 0.9% | 2.3% | 122.8 (88/275) | 246.4k | 227.3k/19.1k/0 | 0.1129% | 0.1137 | 0.0% | 5.00 | 0.00 |
| Gettingcards chaos | c8 | 7 | 4.0% | 7.4% | 27.5 (19/62) | 282.0k | 181.1k/24.6k/76.3k | 0.0556% | 0.0673 | 0.0% | 4.84 | 3.82 |
| Gettingcards chaos | c9 | 3 | 4.6% | 6.1% | 20.6 (15/46) | 210.4k | 135.0k/18.0k/57.4k | 0.0439% | 0.2053 | 0.0% | 4.35 | 2.87 |
| Gettingcards chaos | c10 | 2 | 2.9% | 4.3% | 33.0 (23/76) | 284.1k | 177.7k/19.4k/86.9k | 0.1061% | 0.1306 | 0.0% | 4.57 | 4.34 |
| Craftedswifts order | c8 | 8 | 35.3% | 59.2% | 2.8 (2/6) | 79.8k | 33.4k/7.8k/38.6k | 0.1587% | 0.1439 | 12.8% | 4.63 | 1.93 |
| Craftedswifts order | c9 | 4 | 15.7% | 37.2% | 6.3 (5/14) | 174.7k | 73.4k/16.2k/85.1k | 0.1722% | 0.1826 | 1.8% | 4.91 | 4.25 |
| Craftedswifts order | c10 | 0 | — | — | — | — | — | — | — | — | — | **no slots** |
| Craftedswifts chaos | c8 | 8 | 34.7% | 65.5% | 2.9 (2/6) | 83.5k | 34.9k/8.2k/40.4k | 0.1743% | 0.1960 | 6.4% | 4.60 | 2.02 |
| Craftedswifts chaos | c9 | 3 | 25.5% | 46.0% | 3.9 (3/8) | 108.3k | 45.3k/10.1k/52.8k | 0.1486% | 0.1232 | 13.4% | 4.68 | 2.64 |
| Craftedswifts chaos | c10 | 1 | 7.3% | 18.6% | 13.2 (9/30) | 310.5k | 138.9k/27.2k/144.4k | 0.1108% | 0.1030 | 3.4% | 5.00 | 7.22 |

### v4 gold per 1% raw grid damage

| Profile | c8 | c9 | c10 | cheapest |
|---|---|---|---|---|
| Craftedswifts:chaos | 479.0k | 728.5k | 2.80M | c8 |
| Craftedswifts:order | 502.8k | 1.01M | no slots | c8 |
| Gettingcards:chaos | 5.08M | 4.79M | 2.68M | c10 |
| Gettingcards:order | 1.12M | 4.62M | 2.18M | c8 |
| Limerent:chaos | 1.95M | 7.00M | 10.47M | c8 |
| Limerent:order | 2.60M | 2.74M | no slots | c8 |
| Mira:chaos | degenerate | 10.20M | 2.25M | c10 |
| Mira:order | 3.13M | 1.88M | 2.42M | c9 |
| Paroxysmal:chaos | 1.23M | 1.29M | no slots | c8 |
| Paroxysmal:order | 1.49M | 1.91M | no slots | c8 |

### v4 epic gems cut per 1% raw grid damage

Marginal rate at the CURRENT grid: E[gems per upgrade] ÷ E[raw Δ per upgrade]. Each
landed upgrade raises the bar for the next, so the rate worsens as you climb — these
are the prices for the next stretch of damage, not a flat cost to +1%. Limerent's
units are per-ally party damage.

| Profile | c8 | c9 | c10 | best |
|---|---|---|---|---|
| Craftedswifts:chaos | 16.7 | 26.1 | 119.4 | c8 |
| Craftedswifts:order | 17.6 | 36.5 | no slots | c8 |
| Gettingcards:chaos | 494.9 | 468.5 | 311.0 | c10 |
| Gettingcards:order | 325.7 | 1.3k | 1.1k | c8 |
| Limerent:chaos | 200.8 | 727.9 | 1.4k | c8 |
| Limerent:order | 152.0 | 162.4 | no slots | c8 |
| Mira:chaos | degenerate | 2.8k | 1.1k | c10 |
| Mira:order | 3.7k | 2.3k | 3.7k | c9 |
| Paroxysmal:chaos | 119.6 | 126.3 | no slots | c8 |
| Paroxysmal:order | 61.2 | 78.1 | no slots | c8 |

Per character, taking the best cell on either side (1% of grid damage can come from
order or chaos): Craftedswifts ~17 gems (chaos c8), Paroxysmal ~61 (order c8),
Limerent ~152 per-ally-% (order c8), Gettingcards ~311 (chaos c10), Mira ~1.1k
(chaos c10). Roughly a 65× spread from a mid grid to an S-grade one.

### v4 willpower evidence (winner vs replaced composition)

| Profile | Cost | Δvalue | Δ raw grid | value-vetoed | winner M | replaced M |
|---|---|---|---|---|---|---|
| Craftedswifts:chaos | c8 | 0.1960 | 0.1743 | 6.4% | 1.156 | 1.139 |
| Craftedswifts:chaos | c9 | 0.1232 | 0.1486 | 13.4% | 1.067 | 1.067 |
| Craftedswifts:chaos | c10 | 0.1030 | 0.1108 | 3.4% | 1.000 | 1.000 |
| Craftedswifts:order | c8 | 0.1439 | 0.1587 | 12.8% | 1.159 | 1.151 |
| Craftedswifts:order | c9 | 0.1826 | 0.1722 | 1.8% | 1.090 | 1.089 |
| Gettingcards:chaos | c8 | 0.0673 | 0.0556 | 0.0% | 1.179 | 1.179 |
| Gettingcards:chaos | c9 | 0.2053 | 0.0439 | 0.0% | 1.034 | 0.902 |
| Gettingcards:chaos | c10 | 0.1306 | 0.1061 | 0.0% | 0.958 | 0.938 |
| Gettingcards:order | c8 | 0.1525 | 0.1255 | 0.0% | 1.194 | 1.194 |
| Gettingcards:order | c9 | 0.0757 | 0.0693 | 0.0% | 1.076 | 1.076 |
| Gettingcards:order | c10 | 0.1137 | 0.1129 | 0.0% | 1.000 | 1.000 |
| Limerent:chaos | c8 | 0.0261 | 0.0302 | 16.2% | 1.224 | 1.223 |
| Limerent:chaos | c9 | 0.0221 | 0.0224 | 2.1% | 1.120 | 1.120 |
| Limerent:chaos | c10 | 0.0276 | 0.0267 | 0.0% | 1.000 | 1.000 |
| Limerent:order | c8 | 0.0126 | 0.0272 | 28.7% | 1.201 | 1.170 |
| Limerent:order | c9 | 0.0300 | 0.0276 | 22.6% | 1.089 | 1.000 |
| Mira:chaos | c9 | 0.1355 | 0.0544 | 0.0% | 1.061 | 1.000 |
| Mira:chaos | c10 | 0.1190 | 0.1123 | 0.0% | 1.000 | 1.000 |
| Mira:order | c8 | 0.0807 | 0.0665 | 0.0% | 1.194 | 1.194 |
| Mira:order | c9 | 0.0940 | 0.0876 | 3.8% | 1.082 | 1.082 |
| Mira:order | c10 | 0.0867 | 0.0885 | 5.3% | 0.990 | 0.990 |
| Paroxysmal:chaos | c8 | 0.1266 | 0.1153 | 3.8% | 1.178 | 1.176 |
| Paroxysmal:chaos | c9 | 0.1270 | 0.1264 | 5.0% | 1.074 | 1.072 |
| Paroxysmal:order | c8 | 0.0889 | 0.1104 | 11.8% | 1.165 | 1.165 |
| Paroxysmal:order | c9 | 0.1106 | 0.1179 | 7.8% | 1.067 | 1.063 |

## Findings

1. **Slot composition rules everything.** Four of ten profiles have zero c10 gems
   equipped (Paroxysmal both, Limerent order, Craftedswifts order) — cutting c10 there
   cannot upgrade at all under like-for-like. Single-slot costs hunt one specific gem
   (Gettingcards order c10: beat one c10, 0.9%/gem, ~123 gems). Mira chaos c8 is fully
   degenerate: her four equipped chaos c8s cannot be feasibly out-damaged by a fresh
   c8 at any observable rate (0 winners in 200,000 batch gems).

2. **The pure willpower tax at fixed cost is ~2×.** p(feasible) vs p(wp-free):
   Craftedswifts order c8 35.3% vs 59.2%, Limerent chaos c8 16.1% vs 34.3%,
   Craftedswifts chaos c10 7.3% vs 18.6%. Needing wp(new) ≥ wp(replaced) roughly
   halves upgrade odds across the board — much gentler than v3's cross-cost 7–11×,
   because like-for-like removes the cost-mismatch penalty.

3. **Under the real rules, the value scale is largely vindicated.** Value-vetoed
   swaps: 0% in twelve of twenty-five live cells, under 14% in twenty; the worst is
   28.7% (Limerent order c8, tiny raw deltas where ties flip easily). Winner M ≈
   replaced M almost everywhere, and Δvalue tracks Δraw within ~±30% in most cells.
   The one systematic bias that remains: when the replaced gem's willpower is poor,
   value oversells the swap (Gettingcards chaos c9: Δvalue 0.205 vs Δraw 0.044 —
   4.7×, replaced M 0.902; Mira chaos c9: 2.5×, replaced M 1.000 vs winner 1.061).
   Same direction as v1's failure, now bounded by the like-for-like rule.

4. **Cheapest cost is a property of the loadout, not the game.** Gold per 1% raw:
   c8 wins six profiles (the grids with many c8 slots and a weak one among them),
   c10 wins two (Mira chaos, Gettingcards chaos — their weak gems are the high-cost
   ones), c9 wins one (Mira order). Nothing about "8 vs 9 vs 10" generalizes; the
   answer comes from which same-cost slot is weakest in *your* grid.

5. **Upgrade costs at S-grade grids are brutal but finite**: Mira order ~199–332 gems
   and 164–215k gold per upgrade for ~0.07–0.09% damage each. Mid grids pay 60–110k
   for ~0.15–0.20% (Craftedswifts c8). The support axis mirrors DPS at about a third
   of the raw magnitudes (per-ally units).

6. **The advisor's reset appetite is a dominant cost at mid baselines**: up to 7.2
   resets per upgrade (Craftedswifts chaos c10 — 144.4k of 310.5k gold), 4–5.5/trial
   on Paroxysmal order. At grade 85–90 baselines resets never fire (cut EV < 20k).
   Reset EV is priced on the value scale; given finding 3 that pricing is mostly
   sound, but it deserves its own look if reset gold keeps dominating.

## What this settles and what it does not

- **Settled**: under the game's actual constraints (like-for-like swaps, packed
  cores), the multiplicative M grading agrees with raw whole-grid damage for the
  large majority of real upgrades. Its known bias — overselling swaps that mainly
  repair willpower — is real but bounded here; it was catastrophic only under v1's
  replace-the-weakest-by-value rule.
- **The original worry inverted**: the study set out to test whether M *overvalues*
  willpower; under the final rules the bigger practical failure of a value-only view
  is *structural blindness* — it cannot say "this cost has no slot on your grid,"
  "this cost's target is one specific gem," or "your next feasible upgrade needs
  wp5." Those statements decide where gold should go, and they need the slot-aware
  machinery this study built, not a retuned M.
- **Still open**: multi-gem restructuring (v3 showed budget-neutral cross-cost swaps
  exist; a full core re-solve with the bench would price them), and the reset
  policy's share of spend.

## Feature direction

One candidate stands out now: a **per-character upgrade panel** driven by this
harness's swap evaluator — for each cost on each side: slots available, p(feasible
upgrade)/gem, expected gems and gold, expected raw gain, and which equipped gem the
best swap targets (with "no slots" and "degenerate" stated plainly). The p estimate
needs ~2k simulated gems (seconds in a worker). Secondary: show Δraw next to Δvalue on
advisor verdicts, flagging the low-wp-replacement oversell case from finding 3.

## The earlier variants (bracketing evidence)

**v1 — value beats the weakest equipped.** The model's own scale, replace-your-worst.
Where the weakest-by-value gem was damage-rich but willpower-poor, value-approved
upgrades LOWERED raw grid damage: Mira order c8 100% of winners (mean −0.089%), Mira
chaos c8 92%, Gettingcards chaos c8 100% (−0.267%), c9 96%. Where the weakest was
damage-poor, v1 and raw agreed (0% negative). Full v1 tables: git history of this file.

**v2 — best raw swap over any slot, no budget.** c10 cheapest per raw 1% in all ten
profiles (e.g. Mira order 1.37M/447k/176.5k for c8/c9/c10); best swaps evicted equipped
c8s almost exclusively; winner willpower stopped mattering (mean wp 3.3–3.8). But the
value scale vetoed 26–89% of those swaps, rising with cost — the shadow of the budget
it was ignoring.

**v3 — raw + budget, cross-cost swaps allowed.** Feasibility effCost(new) ≤
effCost(replaced) produced the willpower tax at full force: p(feasible) vs p(any)
up to 11× apart at c10 (Craftedswifts order 6.0% vs 66.3%); c10 winners wp5 without
exception; cheapest cost split c8×5 / c10×4 / c9×1. Superseded by v4 because
cross-cost single swaps misstate the game's like-for-like reality, but it prices what
restructuring could unlock. v3 gold per 1% raw:

| Profile | c8 | c9 | c10 | cheapest |
|---|---|---|---|---|
| Craftedswifts:chaos | 412.0k | 670.2k | 1.14M | c8 |
| Craftedswifts:order | 502.8k | 769.3k | 3.30M | c8 |
| Gettingcards:chaos | 4.89M | 3.11M | 1.85M | c10 |
| Gettingcards:order | 1.10M | 4.37M | 2.18M | c8 |
| Limerent:chaos | 1.95M | 2.85M | 4.25M | c8 |
| Limerent:order | 2.31M | 2.50M | 1.59M | c10 |
| Mira:chaos | 561.30M | 9.00M | 2.25M | c10 |
| Mira:order | 2.81M | 1.88M | 1.24M | c10 |
| Paroxysmal:chaos | 1.11M | 1.24M | 2.25M | c8 |
| Paroxysmal:order | 1.46M | 1.39M | 1.67M | c9 |

## Reproduce

```bash
node tools/upgrade-cost-study.js --chars=docs/study-data-2026-08-06 --trials=10000 --progress
node tools/upgrade-cost-study.js --validate          # rollout-vs-W gate
node tools/analyze-upgrade-study.js docs/study-data-2026-08-06
```

`docs/study-data-2026-08-06/` holds the character records (worker-cached lostark.bible
pulls, region na, 2026-08-06) and results: `study-*.json` (v4, current criterion),
`v3-study-*.json`, `v2-study-*.json`. Seeds are fixed per cell (fnv1a of the cell
name). The harness computes the v4 criterion; earlier variants are small edits in
`oneGem`/`bestSwap`/`buildCells` recoverable from this file's git history.
