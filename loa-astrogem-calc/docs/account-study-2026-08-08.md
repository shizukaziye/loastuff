> **Superseded (2026-08-10):** this documents the first, SELL-WORLD account study.
> The shipped constants now come from the roster-bound ADAPTIVE-FUSION studies —
> see [roster-adaptive-studies-2026-08-10.md](roster-adaptive-studies-2026-08-10.md).

# Account study — what should you cut, when you own everything?

> **STATUS 2026-08-09: shipped, then ROLLED BACK the same day.** Phase 4's
> Option A went live briefly (perfect-grid anchor, 75/82.5/90 ladder), but the
> banded grid model this study fitted against attached core-band penalties to
> the core's own gems (~100× weaker than the intended whole-damage effect), so
> the packer under-valued order thresholds and the fitted constants inherited
> the bias. The site runs the original grading again while the fit is
> re-derived under the corrected band model (whole-damage multiplicative,
> −10/−20/−30) with keep-all pools and a cutting↔packing fixed-point iteration.
> See docs/willpower-reweight-plan.md for the full record.

*2026-08-08 · `tools/account-study.js` · 3 economy tiers × 10,000 synthetic accounts,
fully seeded and reproducible. The character study's blind spot — "we don't know what
else they own" — removed by construction.*

## Design (Shizu interview, 2026-08-08)

**Accounts.** Each account cuts a collection of epic ORDER gems (60% c8 / 30% c9 /
10% c10, uniform random pairs) under the advisor's DP policy at its tier's economy,
advisor-style resets on. Anything below grade 55 (B-) is discarded on the spot. The
kept gems are packed into 3 order cores, 17 willpower supply each (12 sockets),
maximizing raw banded grid damage. Collection sizes come from the DP's own p(above
baseline) per cut at the 60/30/10 mix, targeting ~6 above-baseline gems (6/p):

| Tier | Economy | p(above)/cut | N = 6/p | Used (72/36/12-style split) |
|---|---|---|---|---|
| T1 | gpd 1.5M · baseline 70 | 5.17% | 116 | **120** (72/36/12) |
| T2 | gpd 3.0M · baseline 75 | 2.62% | 229 | **230** (138/69/23) |
| T3 | gpd 5.0M · baseline 80 | 1.44% | 416 | **420** (252/126/42) |

(Advisor resets lift the realized yield: accounts land ~9–10 socketed gems above
baseline rather than 6. Kept as-is — the sizing rule was the anchor, and it is
consistent across tiers.)

**Banded grid damage** (Shizu's order-floor rule, replacing the leaderboard's hard
17-point floor): per core, by its order-point total — 17+: full effect (plus the
standard above-17 order bonus); 14–16: that core's gems' effect levels count at 95%
in the stat buckets; 10–13: 90%; ≤9: 85%. Interpretation: the penalty scales the
core's own gems' bucket contributions.

**Phase 2 (revised same day from "cut 100" to singles).** Per cost, 1,000 single-gem
experiments from the same base state: cut ONE gem (same tier policy), B- filter (a
discard is an automatic no-gain, its gold still spent), then the full-repack delta
with that one gem added to the collection. Reported: p(gain), mean gain GIVEN a gain,
mean gold per cut. Gems come from pre-cut 100,000-gem banks per (tier, cost) — i.i.d.
from the same policy, sliced per account with a prime stride.

**Validation.** Packing optimizer vs brute force on 30 random small pools: 0.000%
worst shortfall. Single-gem fast screen vs from-scratch packs (254 cases): 0 missed
gains; 6 cases where the from-scratch pack found up to 0.27% more — optimizer-seed
variance, not screen failure; the seeded-from-base measurement is the cleaner marginal
contrast and is what the study reports. Cut engine shared verbatim with the character
study (validated vs Solver.W at 1.3–1.7%).

## Results

### T1 — early accounts (gpd 1.5M, baseline 70, 120 gems)

Collection: 39.3 kept · grid 5.652% (p10 5.17 / p90 6.11) · 9.9/12 socketed above
baseline · collection gold 1.80M. Optimal roster effCost mix: **3: 28.6% · 4: 36.4% ·
5: 22.9% · 6: 8.5% · 7: 3.0%**. Cores pushed past 17 points: 74.0% (14–16: 22.2%).

| Cost | p(gain)/cut | gain given gain | EV per cut | p10–p90 p(gain) | keep rate | gold/cut |
|---|---|---|---|---|---|---|
| c8 | 7.27% | 0.0962% | 0.00700% | 3.5–11.9% | 35.7% | 16k |
| **c9** | **11.16%** | 0.1142% | **0.01275%** | 6.5–16.4% | 31.5% | 16k |
| c10 | 7.08% | **0.1551%** | 0.01098% | 4.0–10.5% | 19.2% | **9k** |

Best cost per account by EV/cut: c8 7% · **c9 58%** · c10 35%.

### T2 — mid accounts (gpd 3M, baseline 75, 230 gems)

Collection: 71.0 kept · grid 6.243% · 9.7/12 above baseline · gold 3.61M. Roster mix:
3: 26.2% · 4: 40.0% · 5: 22.6% · 6: 8.0% · 7: 2.7%. Cores 17+: 77.5%.

| Cost | p(gain)/cut | gain given gain | EV per cut | p10–p90 p(gain) | keep rate | gold/cut |
|---|---|---|---|---|---|---|
| c8 | 3.26% | 0.0872% | 0.00285% | 1.4–5.5% | 33.6% | 16k |
| c9 | **6.44%** | 0.0994% | 0.00640% | 3.3–9.7% | 29.6% | 16k |
| **c10** | 4.48% | **0.1470%** | **0.00658%** | 2.5–6.7% | 18.3% | **9k** |

Best cost per account by EV/cut: c8 4% · c9 39% · **c10 57%** (statistically a c9/c10
tie on mean EV; c10 wins more accounts and is ~45% cheaper per cut).

### T3 — late accounts (gpd 5M, baseline 80, 420 gems)

Collection: 101.8 kept · grid 6.637% · 9.2/12 above baseline · gold 4.24M. Roster mix:
3: 26.7% · 4: 39.4% · 5: 22.6% · 6: 7.9% · 7: 2.8%. Cores 17+: 78.9%.

| Cost | p(gain)/cut | gain given gain | EV per cut | p10–p90 p(gain) | keep rate | gold/cut |
|---|---|---|---|---|---|---|
| c8 | 1.66% | 0.0849% | 0.00141% | 0.6–2.8% | 26.2% | 10k |
| c9 | **3.50%** | 0.0946% | 0.00331% | 1.7–5.6% | 22.7% | 10k |
| **c10** | 3.25% | **0.1486%** | **0.00483%** | 1.8–4.8% | 15.6% | **9k** |

Best cost per account by EV/cut: c8 3% · c9 17% · **c10 80%**.

### Bonus — the original "cut 100" formulation (before the singles revision)

Cumulative 100-gem arms with full repack, run before the phase-2 correction (T1
complete, T2/T3 partial from a launcher fault). Same verdicts:

| Tier | c8 +100 | c9 +100 | c10 +100 | best-arm share |
|---|---|---|---|---|
| T1 (10k) | 0.352% | **0.638%** | 0.580% | c9 53% / c10 40% |
| T2 (3.3k) | 0.169% | 0.368% | **0.412%** | c10 53% / c9 40% |
| T3 (2k) | 0.090% | 0.223% | **0.323%** | c10 62% / c9 31% |

## Findings

1. **Cut c9 early, c10 late; c8 never.** By expected damage per cut, c9 wins T1
   (58% of accounts), c9/c10 tie at T2 with c10 ahead on count (57%) and cost, and
   c10 dominates T3 (80%). c8 is last at every tier — its high p(gain) advantage
   never materializes (it doesn't have one: even p(gain) favors c9 everywhere).
   The driver: c9/c10 gains are 1.2–1.6× larger per hit (Boss Damage carriers),
   and as grids mature, the hit RATE converges across costs while the hit SIZE
   stays with c10.

2. **c10 cuts are also the cheapest** (~9k/cut vs ~10–16k) — the advisor resets
   less when the cut EV sits lower relative to the 20k reset. So c10's late-game
   edge is even larger in gold-per-damage: at T3, c10 delivers 3.4× c8's EV per
   cut at 0.9× the price.

3. **The cost-3 overrating hypothesis is confirmed.** Grade-greedy rosters (top-12
   by grade) lose 0.46–0.50% grid damage — **7–9% of the entire grid** — versus the
   raw-optimal pack, agreeing on only ~7.5–8.2 of 12 sockets. Every account benches
   16–43 gems that out-grade something socketed, and 76–80% of those benched
   higher-grade gems are effCost ≤ 4. The optimal roster runs only ~27–29% cost-3
   gems; cost-5/6/7 carriers take a third of the sockets despite grading worse
   (M ≤ 1.0). The value scale's M multiplier overpays for willpower relative to
   what an actual whole-collection packing uses.

4. **Willpower still matters — through packing, not grades.** The optimal mix
   centers on cost-4 (36–40%), not cost-3: the packer wants cheap gems, just not at
   the price the grade scale implies. And the order bands bite: optimizers push
   74–79% of cores past 17 points, holding almost every core out of the penalty
   bands (≤9-point cores: ~0.1%).

5. **Stage costs**: an early account pays ~1.8M gold for its first real grid
   (5.65% damage) and then ~16k per c9 lottery ticket at 11% odds; a late account
   has ~4.2M sunk, and each c10 ticket costs ~9k at 3.3% odds for ~0.15% per hit.

## Phase 3 — anatomy of the inversions

When the raw-optimal roster and the grade-greedy roster disagree (~4 sockets per
account), who gets **promoted** (socketed despite a lower grade) and who gets
**displaced** (benched despite a higher grade)? 1,000 accounts per tier, same seeds
as the study (`--inversions`):

| Tier | Promoted: grade / rawLin / order / effCost mode | Displaced: grade / rawLin / order / effCost | Reason: damage | Extreme pair mean gap |
|---|---|---|---|---|
| T1 | 68.0 / 0.427 / 3.98 / cost-5 (31%) | 78.9 / 0.257 / 4.93 / **cost-3 64%** | **98.1%** | 18.5 pts (max 33.8) |
| T2 | 73.1 / 0.468 / 4.12 / cost-5 (36%) | 84.6 / 0.301 / 4.97 / **cost-3 81%** | **99.3%** | 20.6 pts (max 38.7) |
| T3 | 75.2 / 0.500 / 4.14 / cost-5 (38%) | 87.4 / 0.340 / 4.98 / **cost-3 74%** | **99.2%** | 21.9 pts (max 38.7) |

Extreme pairs (each account's lowest-grade promoted gem over its highest-grade
displaced one): c5≻c3 ~22–23%, c6≻c3 ~17–23%, c4≻c3 ~14–17%, c7≻c3 ~11–16% — the
hypothesized "lower-rated cost-6 over higher-rated cost-3" is the second most common
extreme swap at every tier, and "anything ≻ c3" covers ~75–85% of them.

Three conclusions:

1. **The displaced archetype is singular**: a high-grade cost-3 gem (c8 wp5) with
   near-perfect order (~4.9–5.0) but weak effect lines (rawLin 33–40% below the
   promoted gems). Its grade is manufactured by M(3) = 1.19 × the flat order credit;
   the packed grid converts neither into damage at that price.
2. **It is a pure valuation error, not a packing constraint.** Promotion reasons are
   98–99% "the promoted gem simply out-damages the displaced set"; order-glue and
   budget-glue are noise (< 2%). And the literal top-12-by-grade multiset packs into
   the 3×17 cores in 98.4–100% of accounts — the grade roster always FITS; it is
   just worse.
3. **The grade scale overpays order as well as willpower.** Displaced gems out-order
   promoted ones by a full point (4.9–5.0 vs 4.0–4.1); under the banded grid model,
   order beyond what holds a core's band converts to almost nothing, while
   `gemValue` prices every point at the flat 0.16. The undersold archetype — the
   "workhorse" cost-4/5/6 gem with strong damage lines and ordinary order — runs
   ~20 grade points below what the grid actually values it at. (This conclusion
   leans on the study's banded order model by construction.)

## Phase 4 — scoring transforms: can a per-gem score match the packer?

Goal (Shizu): transform the score — primarily its willpower contribution — to
minimize displacements vs the packer's top 12. Three candidates, fit on accounts
0–7,499 per tier (22,500 pooled), tested on 7,500–9,999 (7,500 held out); the
current `gemValue` is the baseline (`tools/fit-scoring.js`, labels via
`--dump-labels`):

- **A — retuned M**: `(effects + w·order) × (1 + s·(5 − effCost))`. Fitted:
  **s = 0.078**/cost-level (was 0.0984), **w = 0.048**/order point (was 0.1599).
- **B — additive willpower price**: `effects + w·order − λ·effCost`. Fitted:
  **λ = 0.046**, w = 0.048.
- **C — empirical table**: smoothed P(socketed | config) from the train accounts
  (1,715 cells, logistic backoff) — the per-gem-scalar ceiling.

Per-tier refits drift barely (A: s 0.074–0.086, w 0.044–0.048) — one global
parameter set serves all tiers.

**Held-out results (7,500 accounts, pooled):**

| Scorer | mean displacements | exact-12 match | ≤1 displaced | damage loss vs packer |
|---|---|---|---|---|
| base (gemValue) | 4.132 | 0.2% | 3.1% | **0.4785%** |
| A retuned-M | 2.315 | 2.4% | 23.1% | 0.5562% |
| B additive-λ | 2.337 | 2.2% | 22.3% | 0.6067% |
| **C table** | **2.193** | **2.8%** | **26.0%** | 0.5768% |

Findings:

1. **Displacements halve** (4.13 → 2.2–2.3) under all three; A ties C within 6%
   and beats B slightly, so the simple retuned-M form captures nearly everything a
   per-gem scalar can. The scalar ceiling is visible in C: ~2.2 displacements and
   ~3% exact matches — the rest is genuinely contextual (bucket saturation, band
   states, budget interactions no per-gem number can see).
2. **The fitted correction is mostly ORDER, not willpower.** The M slope moves
   only 0.098 → 0.078; the order weight collapses 0.16 → 0.048 (3.3×). Phase 3's
   "grades overpay order as well as willpower" — quantified, and order is the
   larger error.
3. **The trade-off nobody ordered: damage loss gets WORSE** (0.479% → 0.556–0.607%)
   even as membership improves. Cause: order's true value is band-shaped —
   worthless below a threshold, decisive at it. A low scalar order weight misses
   the order-concentration gems the packer uses to hold 74–79% of cores at 17+;
   those misses are damage-expensive. The old inflated order weight buys too many
   order gems (bad membership) but keeps bands alive (cheap misses). A scalar
   score cannot have both; matching WHO is in the roster and matching WHAT the
   roster is worth part company here.

**Implication.** For membership fidelity, adopt A (drop-in: two constants). For
roster damage, no per-gem scalar helps — order needs roster-level treatment (score
gems on effects + willpower, handle order as a packing concern), which is a product
change beyond a constants swap.

## Caveats

- The banded-penalty grid model is this study's custom metric (per Shizu's spec);
  it diverges from the leaderboard's hard-17-floor raw model.
- Single-gem deltas are marginal improvements over the account's standing solution
  under an identical search procedure — a hair conservative vs global re-optimization
  (validated: 0 misclassifications, value agreement 97.6%, max deviation 0.27%).
- Collections are order-only by design; chaos mirrors by symmetry (same pools).
- The B- storage rule and the 60/30/10 cutting mix are fixed inputs; different mixes
  would shift collection quality but not obviously the cross-cost verdicts.

## Reproduce

```bash
# banks (9× ~30s), then shards; everything is seeded — identical numbers on rerun
node tools/account-study.js --make-bank --tier=T1 --cost=8 --size=100000 --out=bank-T1-c8.json
node tools/account-study.js --tier=T1 --banks=<dir> --from=0 --to=10000 --out=... --progress
node tools/account-study.js --selftest        # packer vs brute force
node tools/account-study.js --screen-check --tier=T1 --banks=<dir>
node tools/account-study.js --grades --tier=T1 --accounts=1000       # grade stats
node tools/account-study.js --inversions --tier=T1 --accounts=1000   # phase 3
node tools/analyze-account-study.js <dir>     # these tables
```

Account seeds: fnv1a("T1#<idx>"); bank seeds: fnv1a("bank:T1:c8"). Raw shard outputs
(~55MB) live outside the repo; regeneration is deterministic.
