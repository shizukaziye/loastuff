# Advisor OCR accuracy campaign

Goal: **≥99% per-field accuracy on normal screenshots** (no field blocked by pets/chat/etc.),
then raise the ship gate (`npm run eval-gate`) from 0.95 to 0.99 and keep pushing toward
perfect. Zero silent errors stays a hard invariant — a wrong field must flag.

Method, each iteration:
1. Pull collected parse records (`tools/pull-collected.js`; admin token, header auth).
2. Triage into eval pairs (`tools/triage-collected.js`): user-corrected records are the
   failure gold; confirmed-unchanged records become regression controls. Labels from a
   correction are pixel-verified before they enter the corpus — at these accuracy levels
   label error rivals parser error.
3. `npm run eval-ocr` per-field table on the normal-shot set; taxonomy of misses.
4. Fix the engine (structural thresholds, glyphs, layout, level-refs, confidence wiring).
5. Re-eval; ship verified wins (bump pins, commit, push); log the numbers here.

Baseline going in (from samples/README.md, 2026-07-18, 56-shot corpus):
- structural headline (per-field avg) **97.3%**, outcomes 98.7%, silent errors 0.
- Small-monitor (~713px) frontier fields: orderLevel 71%, effect1Level 87%, currentTurn 90%.
- Ship gate: ≥95/≥95 (passing).

## Iterations

### 2026-07-27 · iteration 1 — corpus expansion + baseline
- Corpus copied into the monorepo working tree (untracked; user screenshots stay out of
  the public repo). `samples/` added to .gitignore.
- Pulled the collected feed: **1,743 records** (618 duplicate images). Triage
  (`tools/triage-collected.js`): **790 unique same-board fixes** (real parser failures
  with user labels), 271 clean confirms, 40 progression records (excluded — the final
  state describes a later board, not the screenshot).
- Old 67-pair corpus baseline: headline **99.7%**, 0 silent errors — the old corpus no
  longer represents production failures.

### 2026-07-27 · iteration 2 — honest labels: per-field trust masks
- Scored 240 candidates (200 fix + 40 clean) with the current engine
  (`--dir=` added to eval-ocr): headline **84.8%**, whole-parse 19.6%, and
  **flag coverage only 87%** — silent wrong fields exist on production shots.
- **Label noise confirmed by pixel review**: `final` freezes collection-time parser
  errors on fields the user never corrected (verified concretely: a label with effect
  names crossed against its own levels while the user only fixed rerolls; another shot
  had the reroll pill hidden under a game tooltip). Labels are per-FIELD trustworthy.
- Added `_mask.skip` scoring to eval-ocr + `tools/promote-candidates.js`: trusted
  fields = user-corrected ∪ engine-agrees; disputed untouched fields are masked and
  queued (samples/review-queue.json, **329 disputes**) for pixel arbitration.
- Promoted all 240 as `samples/c-<id>` pairs. Expanded corpus: **307 pairs**.
- Failure taxonomy to attack (deduped, trusted-field portion):
  1. Effect-name confusion on support/order gems (Boss↔Ally *, order↔chaos) — the old
     corpus had no order-gem-exclusive effects at all.
  2. Level digits at <800px (1↔4, 1↔5, 1↔2 on all four level fields).
  3. baseCost bias to 10 (10→8 ×26, 10→9 ×18 on the candidate set).
  4. rerollsRemaining 3→0 (Charge state / spent free rerolls).
  5. Confidence recalibration — restore 100% flag coverage on the new failure modes.

### 2026-07-28 · iteration 3 — pixel arbitration of all 329 disputes (labels now clean)
- Two agents ran (one died mid-flight to a session limit and was relaunched from its
  on-disk state). Final ledger `samples/review-resolutions.json`: 376 entries.
- Verdicts across the 329 queue disputes: label right 238, engine right 56, both
  wrong 29 (fixed from pixels), plus 3 unusable images (not Processing screens),
  1 obstructed, 1 uncertain. QC re-checked 27 of the 45 user-correction overrides:
  all upheld — they trace to stale collection-time defaults (gemType "order"), the
  reroll convention (model counts pill free + 1 paid Charge), and compensating level
  errors that survive the sum check.
- Convention corrections locked in: footer "Process (x/N)" counts processes
  REMAINING → currentTurn = N−x+1; rerollsRemaining = pill + Charge(+1).
- Tooling fixes: triage now carries `change` on reroll/gold-cost outcomes (70 labels
  repaired, linter 0 errors), lint-labels skips metadata files, eval-ocr honors
  `_unusable`. Corpus: 307 labeled pairs, arbitrated and lint-clean.
- Engine round 1 landed (joint title/pool/assignment solve, Charge-state rerolls,
  confidence recalibration across the commit ladder). A/B on identical labels:
  headline 89.9 → 92.0, silents 43 → 5; the 5 were pixel-verified LABEL errors
  (incl. a tooltip-contaminated shot reading a different gem's effect list) — fixed.

**Authoritative post-round eval (304 arbitrated pairs, 3 unusable skipped):**

| metric | iter-2 baseline* | after iter-3 |
|---|---|---|
| headline per-field avg | 89.9% | **92.2%** |
| whole-parse | 42.3% | **47.4%** |
| flag coverage | 90.3% | **100.0%** |
| silent errors | 43 | **0** |
| false alarms/shot | 4.7 | 5.8 |

\* same-label A/B (pre-arbitration numbers 94.8/14 aren't comparable).

Per-field now: maxTurns 100 · currentTurn 99.7 · gemType 98.4 · processCostMult 97.7 ·
rerollsRemaining 96.7 · effect1 94.4 · baseCost 93.4 · effect2 90.8 · willpowerLevel 87.2 ·
effect2Level 85.9 · orderLevel 83.9 · **effect1Level 78.6** (the frontier: level digits).

- Ship gate ratcheted to a corpus-honest 0.92/0.91 (was 0.95 on the legacy-only
  corpus); policy: raise it each iteration the numbers climb, land at 0.99.
- Next (iteration 4): glyph-data rebuild for the level digits at <800px (1↔4, 1↔5,
  1↔2), layout.js panel detection on the two large-frame failures (4K/1080p), tiny
  reroll pills, east-vs-south swap pinning in the joint solver. Localized clients
  (ES/RU name refs) tracked separately — outside the "normal screenshots" goal.

### 2026-07-28 · iteration 4 — round 2: data rebuild from the full corpus + solver provenance
- **Glyph/ref data rebuilt from the 304-pair corpus** (both files dated from the
  56-shot era). Holdout: djb2(name)%5==0 (~20%, 64 samples) excluded from every
  harvest so the eval can report accuracy on samples the templates never saw.
- `tools/build-glyphs.js`: per-resolution-band atlases (n/u2/u3, keyed by the
  engine's own scaleF; a band class needs ≥10 surviving instances or the pooled
  template backfills), instances stored then PURIFIED per band (2 rounds of
  drop-if-another-class-mean-fits-better; kept 1556/2263), sign-geometry guards.
  Root causes dug out along the way: the '+' class was mostly eroded-"Lv."
  fragments — its template rendered as a serif-'1' and outscored real ones,
  which is what killed the points checksum on ×2 boards; native '2'/'3'/'8'
  were threshold-mush from misaligned averaging.
- `tools/build-level-refs.js`: bare digits ink-LOCATED (vivid-gold centroid)
  instead of a fixed +0.175-gap offset — the true offset varies +0.03..+0.18
  with the name layout, and the fixed offset had harvested digit-free face
  patches that then matched any off-center observation confidently. N patches
  bbox-vetted; W/E exemplars verified by correlation against the clean N/S refs
  (30/112 dropped — "Lv."-letter patches had poisoned half the W/E classes);
  3-tier stratification (2 each of g0 ≥180 / 140-179 / 110-139, distinct-g0
  dedup, 6 per class).
- Engine (`ocr/structural-engine.js`), by line:
  49/231 band-atlas pick per parse · 472 Process-pair x-digit ink-IoU veto (the
  '3'→'8'@0.88 turn silents) · 652 reroll pill line-locate-FIRST + right-shifted
  retry (a clipped rect OCRs a half-cut "1/2" as "2/2"; all five 3→2 pills
  fixed) · 1117 synthLevelRescue memoized + always returns channel tops · 1138
  bare-node ink locate, separate-center scoring, wide fallback scan when
  unlocated · 1618 small-'1' template commits (the absorber class) must survive
  a synth cross-check; a gradient-dissented refusal un-commits · 1765 pts
  header letter-run anchor when the 'A' box misclassifies (forced soft) · 2031
  per-node synth votes in the level enumeration (the swap family) · 2127 the
  two-channel corroborator skips synth-sourced values, value-1 at ×2+, and
  soft-pts boards · checksum lifts: sub-0.65 reads can no longer cross the flag
  line (compensating-pair silents) · 2609+ weak-tier (0.85) template amounts
  stay synth-consultable, contradicted ones cap at 0.72.
- Synth budgets: W/E keep the full 6-exemplar × 6-sigma spread (leaning them
  cost effect1Level 82→75, measured); N/S use tier-matched refs at 4 sigmas
  with a two-phase (grad-then-raw) wide scan. Data payload: glyphs 10→29KB,
  level-refs 359→564KB (lazy worker load).

**A/B on identical labels (304 pairs; A-arm = unmodified HEAD, reproduced
byte-for-byte via git stash on a 17-sample deterministic subset):**

| metric | round 1 | round 2 |
|---|---|---|
| headline per-field avg | 92.2% | **94.9%** |
| whole-parse | 47.4% | **55.9%** |
| flag coverage | 100.0% | **100.0%** (249/249) |
| silent errors | 0 | **0** |
| false alarms/shot | 5.8 | 6.3 |

Per-field (round 1 → round 2): effect1Level **78.6 → 86.8** · effect2Level
**85.9 → 95.1** · orderLevel **83.9 → 94.4** · willpowerLevel **87.2 → 93.1** ·
rerollsRemaining 96.7 → 97.7 · effect2 90.8 → 91.8 · effect1 94.4 → 93.8 ·
baseCost 93.4 → 93.4 · gemType/turn/cost fields unchanged. Level-field misses
196 → 93. False alarms rose 0.5/shot — the price of the new sub-evidence caps;
zero-silents outranks it.

Holdout vs in-sample (harvest split): headline 93.6% vs 95.2%, whole 32/64 vs
138/240 — no sharp divergence; willpowerLevel shows the widest gap (89.1 vs
94.2), effect1Level scores HIGHER on holdout (89.1 vs 86.3).

Gate: lint-labels 0 errors; 94.9% ≥ 92% · outcomes 91.4% ≥ 91% → **PASS**
(thresholds applied to the full-corpus run; headroom exists to ratchet the
headline gate to 0.94 next bump — outcomes has only 0.4pt).

The two "panel failures" (3840×2160, 1920×1080) are NOT detection bugs: the 4K
frame is the empty gem-SELECTION screen (no wheel exists) and the 1080p one is
a browser screenshot of loseii.com's calculator whose mock wheel contradicts
its own label. Refusing both is correct; layout.js untouched. They belong in
`_unusable` at the next label pass (labels were owner-locked this round).

- Next (iteration 5): the new #1 class is effect1Level 2→1 ×16 (W reads 2 on
  true-1 boards — a '2'-bias in the W synth/template pair worth a ref audit);
  baseCost 8↔9/10↔8 stands at 20 flagged misses (title-read work, not glyphs);
  7 swap boards remain (3 W↔E, 3 W↔S, 1 E↔S); false alarms 6.3/shot — the FA
  histogram in the eval dump shows the 0.68-0.79 cluster to calibrate against
  once a verifier exists; eval wall-time (~2.5h with dump) wants a coarse-to-
  fine amount-synth and OCR-ladder profiling; willpowerLevel holdout gap
  suggests N-ref diversity work.

Shipped 2026-07-28 (pins glyphs 55 / level-refs 3 / structural 90; gate ratcheted to
0.94/0.91). The two non-Processing large frames are now `_unusable` (302 scored pairs).
