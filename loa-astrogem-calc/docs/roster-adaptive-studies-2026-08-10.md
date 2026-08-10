# The Roster-Bound & Adaptive-Fusion Studies (2026-08-09/10)

This documents the simulation campaign behind the constants that grade every
gem on the site today: why the sell-world model died, the roster-bound
protocol that replaced it, the adaptive-fusion refinement, and the numbers
each generation earned. The raw corpora live in session scratch data; every
finding below is reproducible from `tools/account-study.js` (the protocol
flags are documented inline there).

## 1. Why the sell-world fits died

The first fitted willpower tables (see *account-study-2026-08-08.md*) were
trained on accounts cut by the gold-EV advisor — a world where a bad gem is
abandoned and its gold recovered. But astrogems are **roster-bound**: you
cannot sell them. Real collections keep everything and fuse the spares. Two
symptoms forced the redo:

- The support fixed-point loop **oscillated** (populations cut under a high
  order weight refit low, and vice versa) — the sell world's cut policy feeds
  back into the fit, so it never identified one answer.
- The sell-fit constants overpriced the cases the sell world never tests
  (deep-tail costs, support c10s at 105 — the smell test that started the
  redo).

## 2. The roster-bound protocol

Per simulated account, per tier:

1. **Cut** N gems (60:30:10 across base costs 8/9/10 — fusing toward higher
   costs plus selector 10s justifies the mix) with the LIVE site advisor in
   roster-bound mode (processing decisions ignore sunk gold; nothing is
   abandoned).
2. **Equip** the best 12 with an exact-verified packer (17 budget per core,
   band penalties, bucket diminishing returns; brute-force-validated to
   0.000%).
3. **Keep** everything grading within 5 points of the weakest equipped gem.
4. **Fuse** every discarded relic/ancient (level-sum 16+) with two legendary
   10-costs (infinite legendary supply assumed; legendary outputs are
   dismantled so the infinite supply cannot be abused; sub-threshold relic+
   outputs re-queue) until nothing fusable remains.
5. **Re-equip** and dump the roster: which gems the packer socketed is the
   label the fit trains on.

Collection sizes are set so an account *expects 6 of its 12 sockets* (per
side, for supports) to clear the tier's quality bar; lower tiers run more
accounts so every tier contributes equal gem mass. Fits minimize
disagreements between "top 12 by score" and the packer's real best 12 on
held-out accounts; candidate forms also face **packer-adjudicated monster
ladders** (a perfect c8 vs line-stripped c10s, verdict by packed-damage
margin, model-free).

## 3. The adaptive-fusion refinement

The first roster corpus steered all fusion outputs toward 10-costs — which
bakes a policy assumption into the world the fit learns from. The final
generation removes it: **each account computes its own c9-vs-c10 fusion
target**, exactly — the fusion-output distribution (output tier × level-sum ×
level partition × effect pair, exact probabilities) is enumerated and every
concrete output is scored by its exact single-swap packer marginal against
the account's current grid. The account fuses at the winning target and
**re-decides after every upgrade**. Grades and fitted constants never enter
the decision, so the model cannot bias its own training world.

**Tiers (gpd = the gold value the account puts on +1% damage):** DPS 6M/90 ·
2.5M/85 · 1M/80; support 6M/85 · 2.5M/80 · 1M/75 (support bars sit one band
lower — at equal nominal bars a support tier implied budget-incoherent
1,900-gem collections).

**Scale:** DPS 117,000 accounts / ~10.8M gems; support 107,000 joint
Order+Chaos accounts (~10.8M gems, both sides cut, packed, fused, and
targeted independently at per-core rates).

## 4. Findings

### Fusion: 9s or 10s?

| gpd tier | DPS choose-9 | Support choose-9* | paired-control verdict |
|---|---:|---:|---|
| 6M (whale) | 44% | 47–50% | fixed policies tie; per-account choice beats both (+0.008 dmg) |
| 2.5M | 68% | 67–68% | always-9 beats always-10 (+0.008 dmg) |
| 1M | 72% | 75–76% | always-9 beats always-10 (+0.008 dmg) |

*among accounts holding fusion fodder.

**The law: fuse spares toward 9-costs unless the grid is strong enough that
only near-perfect 10s can improve it.** Accounts drift toward target-10 as
they upgrade (every tier's final share shifts 4–8 points toward 10) — the
whale coin-flip is the boundary of that drift. Order and chaos sides agree
within a point, validating the unified support score.

### Why 9-costs dominate

At the whale bar a c9 cut clears ~7× more often than a c10 (5.0% vs 0.7% at
DPS 90): c9's pool plus one less effective cost gives headroom everywhere
below perfection, while a c10 pays the deepest budget tax at every willpower
level short of 5. c10's perfect ceiling is real (102.1 DPS / 103.6 support)
— which is exactly why only near-finished grids should chase it.

### Benchmarks (average equipped grade, live scale)

| gpd tier | DPS | Support |
|---|---|---|
| 6M | 88.8 (A+) | 83.7 (A) |
| 2.5M | 84.3 (A) | 79.2 (B+) |
| 1M | 80.2 (A−) | 74.0 (B) |

These accounts play optimally; a real character a point or two under their
row is normal. Supports read ~5 points lower at equal wealth — structural,
not a skill gap.

## 5. What each generation earned (held-out wrong-gems)

| generation | DPS | support |
|---|---|---|
| original perfect-tie multiplier | ~2.9 | — |
| sell-world fits (2026-08-08/09) | 1.78 | 4.40 / never converged |
| roster-bound K-steep (target-10 fusion) | 1.69 | 3.68 |
| **adaptive-fusion refit (SHIPPED)** | **1.55** | **3.33** |

Shipped constants (both axes additive; order pinned at its exact damage
weight on DPS, level-4 centered):

| effCost | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---:|---:|---:|---:|---:|---:|---:|
| K (DPS) | +0.1327 | +0.0896 | 0 | −0.1203 | −0.2504 | −0.3970 | −0.5686 |
| K_sup | +0.0252 | +0.0150 | 0 | −0.0235 | −0.0593 | −0.0986 | −0.1346 |

Perfects: DPS 96.1 / 99.7 / 102.1, support 94.6 / 98.2 / 103.6; each axis's
S+ cut derives from its perfect c8 at model load, so future refits move the
ladder automatically. The letter bands are even thirds of 10-point bands,
chosen against measured cut-outcome percentiles (S ~1%, A− ~14%, B− ~34%).

The support adoption note, for honesty: the support refit's held-out gain
(3.42 → 3.33 misses vs the intermediate table) traded a floor-inversion
regression (10.0 → 10.8) and was adopted with that trade disclosed — the
world-consistency argument (the site's own fusion advice now creates the
adaptive world) carried the decision.

## 6. Reproduction

- Sizing: `node tools/account-study.js --size-roster [--axis=support] --mix=60,30,10 [--bl=…]`
- Study: `--roster-study --tier=R1 --c8=… --c9=… --c10=… --fuse-target=auto --seed-tag=…`
  (fixed-target control arms: `--fuse-target=9|10` with the same seed-tag —
  identical cut pools, only the fusion selector differs)
- Fits: `tools/fit-support-roster.js` (support bench) and the pinned-order K
  refit pattern (order weight frozen at `SCORING.orderPerPoint`, coordinate
  descent on the credit table, 60/40 train/test by account index).

Every constants change runs the full gate battery before deploy: refs.json
543/543 on both engines, verify-dp frozen pins + the independent Monte-Carlo
battery, both pipeline bakes with meta verified against the derived ladder,
and lint-pins.
