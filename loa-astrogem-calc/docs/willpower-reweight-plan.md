# Willpower reweight (Option A) — implementation plan

*Adopts the account study's fitted scoring (docs/account-study-2026-08-08.md §Phase 4)
into the live site. Target: halve roster displacements vs the packer (4.13 → 2.32
per account on held-out data).*

## What changes, in one paragraph

The DPS value model becomes `gemValue = (effect damage + 0.048·order) ×
M'(effCost)` with `M'(c) = 1 + 0.078·(5 − c)`, clamped to c ∈ [3, 9] — replacing
the perfect-gems-tie calibration (slope ~0.0984) and the flat 0.15987 order weight.
The grade anchor changes with it (Shizu, 2026-08-08): **100 = the average gem of
the perfect Ark Grid layout** — 3 perfect c8 + 3 perfect c9 + 6 perfect c10, which
is exactly the wp5 packing the 17-willpower cores allow (5+5+4+3 per core, ×3).
Grades are uncapped above: perfect c8 → **90.2**, perfect c9 → **97.7**, perfect
c10 → **106.0**; their 3/3/6 average = 100. Every perfect gem additionally carries
the **PERFECT badge** (the rainbow treatment), regardless of grade. Raw-damage
displays (relDamage, damagePercent, gridDamage, the leaderboard total) do NOT
change — this reweights valuation only. The support axis is untouched (no packing
data; follow-up study).

## Locked decisions

- Constants: M slope **0.078**/cost-level, order value **0.048**/point (global —
  per-tier drift was negligible).
- Scope: the VALUE layer on both axes. `gemDamage`/`relDamage`/`damagePercent`/
  `gridDamage` and the per-core support grid rates keep their current constants
  (they claim damage, not value). Support value constants come from the
  proportional convention (Step 6b), not a separate fit; both axes share the new
  anchor rule, open top, PERFECT badge, and ladder.
- Normalization: `grade = 100 × (value − min) / (m* − min)` with min ≈ 0.0330 (the
  global worst gem) and **m\* = (3·p8 + 3·p9 + 6·p10)/12 ≈ 0.89105** (the
  perfect-grid mean, computed at module init like the M table). Bottom clamps at
  0; the top is OPEN — the scale runs to 106.0 (perfect c10).
- Rainbow/PERFECT: the badge gates on "is a perfect config" (all four stats maxed
  with the cost's top two effects), NOT on grade ≥ 99.9995 — otherwise every
  above-100 c10 would rainbow. Perfect c8/c9/c10 all badge; nothing else does.
- Known trade-off (shipped knowingly): grade-greedy rosters under the new score
  match the packer's membership 2× better but lose slightly more damage (0.48% →
  0.56%) because order's band value is not scalar. Mitigation is a future
  roster-level order treatment, not a weight.

## Step 1 — model core (`model/astrogem.js` + `model/astrogem.py` parity)

1. Add `SCORING.orderValuePerPoint = 0.048` and the M' slope constant; replace the
   `_WP_MULT` perfect-tie IIFE with the slope table (DPS only; `_SUP_WP_MULT`
   stays).
2. Split value from display damage: `gemValue` uses (effects + 0.048·order) × M';
   `gemDamage` (and everything labeled damage) keeps 0.15987.
3. Grade mapping: replace `valueBounds` max-anchoring with the perfect-grid
   anchor m\*; drop the top clamp in `grade()` (keep the bottom clamp and 0.1
   rounding); `gradeToScore` inverts the new line and accepts inputs past 100.
   Audit every `Math.min(100, …)` on the grade path, `rankFromGrade` for g > 100
   (S+ band absorbs it), grade-input fields (clamp entry at 106), and leaderboard
   chip layout for 5-character grades ("106.0").
4. PERFECT badge: `gradeColor`/rank chip takes a perfect-config flag (or the
   config) instead of the 99.9995 grade gate; perfect = wp5 · order5 · the cost's
   top-2 effects @5.
5. Consumer audit — these inherit automatically via `gemValue`/`grade`/
   `gradeToScore`: nested `calculateGemValue`, dp `Solver._score`, pipeline
   collector, loadout-econ baselines, leaderboard per-gem grades, advisor
   terminal values. Check `gridQuality` (Σ ln gemValue — shifts; confirm where
   it's displayed) and `effectClass` memo keys (effectScore-based — unchanged).
6. Mirror in `astrogem.py`; the JS↔Python battery must pass bit-identically.
7. New frozen sanity constants: perfect c8/c9/c10 grades = **90.2 / 97.7 / 106.0**
   (3/3/6 average = 100.0); displaced-archetype fixture 28.5; workhorse fixture
   73.6.

## Step 2 — verification gates

1. `node tools/verify-dp.js --selfcheck` — pins WILL trip; re-freeze deliberately
   (the file documents the procedure), then run the FULL MC battery to PASS.
2. JS↔Python reference battery.
3. Reproduction gate: re-run the Phase-4 held-out evaluation against the
   PRODUCTION `grade()` (labels already dumped) — mean displacements must land at
   ~2.32, confirming the shipped code equals the fitted model.

## Step 3 — pipeline rebake (BOTH axes)

- `node tools/collect-stats.js` → new `data/pipeline.json` and
  `node tools/collect-stats.js --axis=support` → new `data/pipeline-support.json`
  (~50 min each, worker-parallel — run them in sequence or on separate shards).
- Collector sanity (methodology §5): 2D ≫ Op > Sub ≫ No at the reference cell.
- Ensure the tab's `pipeline.json` fetch is cache-busted (`?v=` on the fetch URL —
  add one if absent).

## Step 3b — rank-ladder translation (Shizu: "90+ must be S+")

The ladder (Shizu's final call): **5-point steps up through S- = 75, then the S
band splits evenly — S at 82.5, S+ at 90.** This is the best rounded ladder of
every variant tested: the floors sit on the fitted flip-minimizing positions
(fitted C- 28.3, B- 42.6, A- 60.4, S- 76.3, S+ pinned 90) and 82.5 lands almost
exactly on the fitted S cut (83.2). Agreement recovers to the ceiling's
neighborhood: 60.9% band (ceiling 61.7%), 64.0% within one sub-rank, 27.9% exact
— matching the unrounded fit.

| Rank | old cut | new cut | | Rank | old cut | new cut |
|---|---|---|---|---|---|---|
| F | 6.7 | 5 | | B | 60 | 50 |
| F+ | 13.3 | 10 | | B+ | 65 | 55 |
| D- | 20 | 15 | | A- | 70 | 60 |
| D | 26.7 | 20 | | A | 75 | 65 |
| D+ | 33.3 | 25 | | A+ | 80 | 70 |
| C- | 40 | 30 | | S- | 85 | **75** |
| C | 45 | 35 | | S | 90 | **82.5** |
| C+ | 50 | 40 | | **S+** | 95 | **90** |
| B- | 55 | 45 | | | | |

New `GRADE_ROWS` (baseline anchors C-…S+):
`[30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 82.5, 90]`.

Perfect c8 (90.2) → S+ ✓; perfect support c8 (90.2) → S+ ✓ (ladder SHARED with
the support axis, Step 6b). Implementation: a plain threshold table — 5s
through 75, then 82.5 and 90.

Implementation: `rankFromGrade` moves from band+thirds arithmetic to an explicit
threshold table; `bumpedBaselineGrade`/`gradeRowIdx` consume the new GRADE_ROWS;
the pipeline bake keys on the new anchors (rebake covers it). Support keeps its
own ladder pending the support refit (below).

## Step 4 — UI: temporary banners on all four tabs

Shared dismissible banner (one `banner.js`, localStorage key
`wp_reweight_2026_08`), rendered on **Grader, Pipeline, Leaderboard, Advisor**:

Banner copy (Shizu's note, edited; his draft's "a perfect 10-cost now scores
under 100" corrected — under the 3/3/6 anchor the perfect 10-cost is the gem
that goes OVER, at 106.0):

> **Why grades changed (Aug 2026).** When I built the original grading system, I
> made every perfect astrogem score a perfect 100. That kept the scale pretty,
> but it broke the math underneath: a perfect 10-cost is simply worth much more
> than a perfect 8-cost, and a scale that denies that gives worse advice. I've
> reweighted grading to track what a packed Ark Grid actually uses — willpower
> and order points now count for less, damage lines for more.
>
> The new scale stays as close to the old one as I could make it. 100.0 is the
> average gem of a perfect Ark Grid (3 perfect 8-costs, 3 perfect 9-costs, 6
> perfect 10-costs — exactly what the willpower budget allows). Only 10-costs
> can score above 100 now: a perfect 10-cost reads 106.0, a perfect 9-cost 97.7,
> a perfect 8-cost 90.2. Every perfect astrogem keeps the rainbow badge, and the
> letter ranks moved down 5 points (S-tier now starts at 75, with S at 82.5 and
> S+ at 90), so a perfect 8-cost is still S+. Baselines and advice shift with
> the new grades; raw damage numbers do not.

Per-tab notes: Grader — baselines re-derive automatically (may move a rank);
Leaderboard — ranking (grid damage) unchanged, per-gem chips shift; Advisor —
advice values shift with the new terminal values; Pipeline — fresh bake, verdicts
may move.

Version hygiene: bump `?v=` pins in index.html for astrogem.js, banner.js, and
any touched file; advisor.js self-versions since 2026-08-06.

## Step 5 — docs

- `docs/how-a-gem-is-graded.md`: replace the perfect-tie M derivation with the
  fitted constants + link to the account study; state the new perfect-gem grades.
- `METHODOLOGY.md`: value-model note + rebake date.
- `docs/account-study-2026-08-08.md`: "Adopted (A) — <date>" note.

## Step 6 — deploy + live verification

- Push to main (Pages, ~1 min). No worker deploys (scoring is client-side).
- Cache-busted checks: perfect-c8 fixture grades 85.1 in the Grader; Pipeline tab
  loads the new bake; banners render and dismiss on all four tabs; Advisor gives
  coherent advice on a fixtures board (docs/how-the-advisor-works.md fixtures).

## Step 6b — support axis by the proportional convention (Shizu, 2026-08-09)

No separate support study — per the axis's existing convention (its coefficients
have always been derived by documented scaling, not independent fits), the DPS
fit's SHRINK FACTORS transfer to the support constants:

- Shrink factors from the DPS fit: M slope ×0.793 (0.0984 → 0.078), order value
  ×0.300 (0.15987 → 0.048).
- Support M' slope: 0.1310 → **0.1038**/cost-level; `M'(c) = 1 + 0.1038·(5−c)`,
  c ∈ [3, 9].
- Support order value: 0.02563 → **0.00770**/point (the per-core
  `SUPPORT_ORDER_PER_CORE` grid-damage rates are damage, not value — unchanged).
- `supportValue = (support lines + 0.00770·order) × M'(effCost)`; support anchor
  = the 3/3/6 perfect-support-grid mean; uncapped top.
- Resulting support scale: perfect support c8/c9/c10 = **90.2 / 96.5 / 106.6**,
  3/3/6 average = 100.0 — near-identical shape to DPS (90.2 / 97.7 / 106.0), so
  the LADDER IS SHARED between axes and perfect support c8 stays S+.
- The support pipeline bake (`--axis=support`) now DOES rebake (supportValue
  changed) — both axes rebake in Step 3 (~50 min each, run in parallel).
- Follow-up (optional, later): a support account study to validate the
  transplanted constants empirically.

## Step 7 — post-ship

- Leaderboard records re-grade client-side on load (no server-side cached grades —
  confirm during step 1 audit).
- Memory + follow-ups: support-axis packing study; roster-level order treatment
  (the damage-loss half of the trade-off); chaos mirror of the account study.

## Sequence and estimates

Model + parity + fixtures (~1–1.5h) → gates (~40 min) → rebake (~50 min, runs in
parallel with UI/banners ~45 min) → docs (~30 min) → deploy + live checks
(~20 min). Roughly 3.5–4 hours end to end, rebake dominating.
