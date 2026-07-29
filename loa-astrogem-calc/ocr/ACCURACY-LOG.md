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

**Loop model policy (2026-07-29):** campaign rounds run on **Opus 5**. The grind —
hundreds of eval cycles, pixel forensics, ref rebuilds — is long-horizon tool work
where Opus 5 is the better rate/throughput trade; Fable 5 hit its session limit twice
mid-round. Reserve Fable 5 for one-shot reasoning-heavy passes (e.g. label arbitration
disputes) when its limit is fresh.

### 2026-07-29 · iteration 5 — round 3: the gem title, and who arbitrates a split vote
Two agents again (the first died to a rate limit mid-round; its working tree was
picked up and finished). **Eval wall-time is 6m25s, not the ~2.5h the round-2 note
assumed** — that number came from a run that also scored the tesseract engine.
`--engines=structural` alone is cheap enough to A/B a whole corpus per idea, and
this round did five full runs. No data files were rebuilt: glyphs and level-refs
are byte-identical to round 2, so every point below is engine work.

- **effect1Level 2→1 ×16 → ×5.** The W synth scan was geometrically unable to see
  a '1': "Lv. N" is node-CENTRED, so a narrow digit pulls the whole line left and
  the digit lands ~0.148 gap left of the old scan centre, outside its reach —
  class-2 refs then won on face texture. Centre moved to +0.125 with reach 0.145,
  plus a fragment-anchored second centre for the 114/604 W/E line locates that come
  back exactly the "Lv." prefix's width. The scan window (σ=9px Gaussian on the
  GRADIENT channel only) stops the green face's diagonal rays from doing the
  matching. Amount-synth kept its own unwindowed calibration — outcome cells are
  not diamond face art.
- **baseCost 93.4% → 99.7%** (20 flagged misses → 1). Three separate causes, all
  in the title read, none of them glyphs:
  1. The title ink is **rarity-coloured**. Measured over all 307 frames by
     widest-located-line: magenta(epic) 174 · cyan(rare) 89 · orange(legendary/
     relic) 31 · blue-violet 7 · gold 3. A magenta-only rescue mask is blind on
     120 boards. The rescue now locates a line under each family and reads the
     best few.
  2. **PSM 7 silently refuses these crops.** On three boards whose mask renders a
     flawless "Order Astrogem: Solidity", psm 7 returns "" at every scale while
     psm 13 (RAW_LINE, layout heuristics bypassed) returns the string. The rescue
     falls back to psm 13 whenever psm 7 comes back short.
  3. The inherited accept guard compared the rescue **against itself**:
     `computeTitleScores()` writes `sfxScore` onto the shared GEM_TITLES objects,
     so reading `keepScores[0].t.sfxScore` after the rescore returns the rescue's
     own number. Whenever the primary's garbage text happened to rank the same
     suffix first — the array-order tie, i.e. most garbage reads — a perfect
     rescue was refused. Two pixel-verified boards read "Order Astrogem:
     Stability" and kept the default cost anyway. Now snapshotted as a number.
  Also: the edit-distance rung grew a **d=3 tier** gated on a 2-distance margin to
  the runner-up (the six suffixes sit ≥4 apart, so d=3 alone is not decisive) and
  priced at 0.45 — inside the soft band, so it can only commit a FLAGGED value.
  "stabnigy" (stability 3, solidity 5, immutability 7) is the live case. The
  ever-present decoy token "astrogem" sits ≥7 from every suffix.
- **The no-checksum fallback.** With no points read and a refused node, a blind
  default-to-1 throws away the consult's channel evidence, but a single channel is
  a coin flip. Three rules measured on the full corpus: agreement-only (default
  to 1 on a split) order 92.1 · decisive-gradient order 93.0 · **fit-quality**
  (trust the channel whose PEAK correlation is higher — 0.47 means it found
  nothing, 0.72 means it locked on) order 94.7. Fit-quality is scoped to N/S:
  applied to W/E it cost effect2Level 95.7→92.4, for the reason the absorber
  family already documented — a W/E patch is a "Lv. N" line inside a COLOURED
  diamond face, so its raw channel correlates on face art.
- ES/RU clients stayed out of scope; the single remaining baseCost miss
  (c-mrw1jzpi) is a Russian title.

**Same-labels A/B, full corpus, 302 scored pairs:**

| metric | round 2 | round 3 |
|---|---|---|
| headline per-field avg | 95.0% | **96.3%** |
| whole-parse | 170/302 (56.3%) | **176/302 (58.3%)** |
| flag coverage | 100.0% | **100.0%** (191/191) |
| silent errors | 0 | **0** |
| false alarms/shot | 6.3 | **6.2** |

Per-field (round 2 → round 3), no field regressed: baseCost **94.0 → 99.7** ·
effect1Level **86.8 → 91.7** · effect2 **92.4 → 94.7** · willpowerLevel 93.0 →
94.7 · effect2Level 95.0 → 95.7 · gemType 98.7 → 99.3 · effect1 94.4 → 94.7 ·
orderLevel 94.4 → 94.7 · currentTurn 99.7 · maxTurns 100 · rerollsRemaining 97.7 ·
processCostMultiplier 97.7 · outcomes 91.6.

Holdout vs in-sample (djb2%5==0, refs unchanged this round): headline 95.4% vs
96.5%, whole 34/64 vs 142/238 — a narrower gap than round 2's 93.6/95.2.

Gate: lint-labels 0 errors; 96.3% ≥ 94% · outcomes 91.6% ≥ 91% → **PASS**.
Ratchet the headline gate to **0.96** at ship; outcomes has no headroom (91.6 vs
91.0) and has not moved in two rounds — it is now the binding constraint.

**Label fix (pixel-arbitrated):** `c-mrwsv1o1-855qdb` baseCost 10 → 8. The raw
title crop reads "Order Astrogem: Stability" (the order-8 gem) at every scale and
psm; both labelled effects sit in the cost-8 pool; two other boards showing the
same title are labelled 8. The 10 is the collection-time default on a field the
user never corrected, and it survived the trust mask because the promotion-time
engine defaulted to 10 as well — a shared-mode failure the "engine agrees" rule
cannot catch.

- Next (iteration 6): the frontier is now **assignment, not digits**. 13 boards
  fail with the points checksum SATISFIED — 5 outright permutations (W↔E ×3,
  W↔S, E↔S) and 8 compensating pairs — which no arithmetic can catch; they need
  stronger per-node evidence than a refused consult's ranking. effect1/effect2
  names (16+16) are the other block, and they are DATA-bound: 9 boards read a name
  at confidence 0 with structuralName and synthNameRescue both refusing, so the
  next win there is NREFS diversity, not another rung. False alarms: the whole
  population is honest low-confidence, with one characterised cluster —
  effect1/effect2 at 0.70-0.75 is 219 false alarms against 1 real miss, worth
  ~0.7/shot, but a threshold move would ship that miss silently, so it needs a
  verifier rather than a lift.

Shipped 2026-07-29 (structural pin 91; gate ratcheted to 0.96/0.91). Verified
independently by the orchestrator: `npm run eval-gate` → PASS, 96.3% / 91.6%, 0 silents,
6m25s wall (the old "~2.5h" figure was a run that also scored tesseract).
