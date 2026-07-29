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

### 2026-07-29 · iteration 6 — round 4: the four-tile strip
Outcomes had not moved in two rounds and was the binding gate constraint (91.6 vs a
91.0 floor). This round is entirely the outcome strip; no data files were rebuilt, so
glyphs and level-refs stay byte-identical to round 2.

**Harness first.** A scratch parallel harness (6 tesseract lanes, one per image, so a
lane's `setParameters` can never interleave with another's `recognize`) scores the
whole corpus in **200s** instead of 6m25s. That is what made a rule-mining loop
possible: `OCR_CELL_EVID=1` makes the cell reader attach the raw evidence it decided
on, and candidate decision rules were then scored against the labels OFFLINE, so a
6-minute run was spent only on ideas that already measured well. `tools/eval-ocr.js`
is untouched and remains the gate.

**Taxonomy of the 101 missed tiles going in** (73 boards; 51 miss exactly one tile):
AMOUNT 32 · TYPE 29 (28 of them `change:effectN` read as `raise:effectN:1`) ·
TARGET 16 · DROPPED 17 · DIRECTION 4 · COSTSIGN 2.

- **"Effect Changed" is the tile with no coloured amount line** (28 tiles). The
  `/chang/` caption test missed 28 of 116 change tiles because the word degrades past
  any regex — measured: "chanaod", "crangod", "cangoc", "cmarged", "charzed", "erect
  crarsed", and the ES client's "camb ado". The signature is STRUCTURAL: a change
  tile's second line is white like the name, while a raise renders a chartreuse
  "Lv. N" and a lower a red one. The corpus is emphatic — among effect-target cells a
  located chartreuse line is a raise **436/436** times, a located red line is a lower
  **55/55**, and NEITHER line means change 114 times against 21 everything-else.
  Defaulting that bucket to raise:1 was the largest single miss class. The rung commits
  flagged (the bucket is 84% pure, not certain) and refuses on a cell with no white ink
  at all, which is a blocked tile rather than a change.
- **The amount OCR crop included the ▲/▼** (10 tiles). `'Lv. 3 ▲'` comes back `'vv 3 4'`
  and the last-bare-digit rule takes the 4; `'+1 ▲'` came back `'+ 4'`. The synthesis
  has clipped at the arrow's measured centroid since round 2 — the OCR and template
  passes never did. `arrowEnd()` now owns that measurement and all three readers share
  it. (The SOLIDITY VETO exists only because an unclipped triangle template-matches '4'.)
- **The caption names its own target** (8 tiles, and it is the only channel that speaks
  at all on 13 boards whose icon renders so dark — v < 0.31 — that the hue test calls it
  grey and the tile came out `do_nothing`). "Efficiency"/"Eficiencia" is unique to
  willpower, "Points/Puntos" to the order axis, and the effect rung reuses `EFFECT_LEX`
  in its own order so "atk. power" cannot become Ally Attack Enh. A bare "power" is
  deliberately not evidence — it is the stem Brand and Attack Power share, and reading
  it as either was the only wrong answer this channel gave. Measured: decisive on 632
  of 1200 cells, agreeing with the label on **629**, and it never once fired on a truly
  grey (cost/reroll/maintained) tile. An override stays flagged.
- **Amount ladder**, three measured rungs: a gradient-only synth may override a weak
  template or caption read at gm ≥ 0.10, double the full-agree bar (+4 tiles, −0); the
  synth's own agree-commit gate went 0.01 → 0.03, since at 0.01 it shipped a '4' on a
  true '1' (+1, −0); and when every channel refuses, the bare OCR digit now stands
  instead of a blind default of 1 (+3, −1) — safe only because the crop is arrow-clipped
  now. A weak template saying '1' against a refused consult's non-1 gradient over the
  noise floor also loses (+3, −0): the asymmetry that makes THAT safe is that a weak
  template firing at all proves there is ink, and the same rule on cells with no digit
  read at all is wrong 7 times in 10.

**Same-labels A/B, full corpus, 302 scored pairs** (A-arm = unmodified HEAD run in a
`git worktree` against the same corrected labels):

| metric | round 3 | round 4 |
|---|---|---|
| headline per-field avg | 96.4% | **96.7%** |
| whole-parse | 176/302 (58.3%) | **197/302 (65.2%)** |
| flag coverage | 100.0% (189/189) | **100.0%** (157/157) |
| silent errors | 0 | **0** |
| false alarms/shot | 6.2 | 6.3 |
| **outcomes** | **91.4%** | **95.0%** |

Every one of the 12 scalar fields is byte-identical between the arms — the whole gain
is the outcome set, and the 32-board drop in wrong fields is 32 boards whose strip went
from partly wrong to exactly right. Missed tiles 101 → **57**.

Per-field: maxTurns 100 · baseCost 99.7 · currentTurn 99.7 · gemType 99.3 ·
rerollsRemaining 97.7 · processCostMultiplier 97.7 · effect2Level 95.7 · effect1 95.4 ·
effect2 95.4 · **outcomes 95.0** · willpowerLevel 94.7 · orderLevel 94.7 ·
effect1Level 91.7.

Gate: lint-labels 0 errors; 96.7% ≥ 96% · 95.0% ≥ 91% → **PASS**. Outcomes now carries
4 points of headroom instead of 0.6, so **effect1Level (91.7) is the binding field** and
the outcomes gate can ratchet to 0.94 at ship.

**Label fixes (all pixel-arbitrated, all four disproved by the crop):**
- `c-mrwqwzkm-uy8rg9` — wheel reads "Ally Attack Enh. Lv. 3" (W) and "Atk. Power Lv. 4"
  (E); the label said effect1 "Attack Power" / effect2 "Boss Damage". Both names wrong,
  both levels right. The engine already read it correctly.
- `c-mrwgjrp2-1jqlzy` (ES) — wheel reads "Daño de jefe nv. 4" and "Daño adicional nv. 1",
  so effect1 "Brand Power"→"Boss Damage", effect2 "Boss Damage"→"Additional Damage";
  strip tile 2 is "Efecto cambiado" (labelled a raise) and tile 3 "Ver otros objetos
  +1 vez" (labelled do_nothing).
- `c-mrxig5cd-qqr89b` — strip tile 1 reads "Ally Damage Enh. / Effect Changed"; labelled
  `raise_effect effect2 1`.
- `c-mrwpng89-skdblh` — the two `change_side_option` targets were swapped (tile 2 is the
  BLUE "Atk. Power" = effect2). Multiset-neutral for scoring; corrected for honesty.
The first two are the shared-mode class again in reverse: the engine disagreed and was
right, and nobody had corrected the field.

**RULED OUT, with numbers, so nobody re-derives them:**
- *4-way self-calibrated icon hue* for outcome targets (nearest of the image's own
  N/S/W/E node hues, replacing the absolute `hueClass`): over all 1070 target cells the
  current rule is right 1039, nearest-node-hue 1043. It trades 5 willpower drifts for 4
  new effect1↔effect2 and 2 new order confusions. The caption channel fixes the same
  cells without the churn.
- *A relaxed RED line sweep* in the locate ladder: −2 tiles, all raise→lower. Red is the
  willpower face, the ▼ and the ▲'s shadow; only chartreuse is unique to the amount, so
  the loose sweep is chartreuse-only.
- *W/E "dissent + ink-geometry corroboration"* — the round-5 swap idea, and the one with
  a genuinely independent channel (segmentation, not correlation). Offline it looked
  strong: the last column-run's w/h < 0.42 at W catches 92% of true 1s at 17% misfire.
  Inside the engine it collapses — the synth's own line locate yields a usable last run
  on only 210 of 545 W/E consults, and against the labels E splits narrow 15:4 but
  **wide 54:18**, i.e. the measurement is not finding the digit. Wired in it fired 7
  times, 4 right and 3 wrong: effect1Level 25 → 26 misses. Reverted; the negative is
  written into `synthLevelRescue` beside the gate it would have loosened.
- *False alarms*: reclaimed none again, deliberately. The 0.70-0.75 effect band is still
  219 FAs against 1 real miss and `processCostMultiplier` still has 149 FAs whose default
  happens to be right. Nothing this round created new certainty about either.

- Next (iteration 7): **effect1Level 91.7 is now the binding field**, and the assignment
  block is where it lives — 13 boards fail with the checksum satisfied. The provenance
  dump added this round (`_debug.lvl`, per node: pinned / enumerated / filled) shows the
  wrong node is FREE on 6 of them and a wrong PIN poisons the enumeration on the rest, so
  a verifier has to be able to un-pin, not just vote. The evidence that looks live: on
  four separate boards the W/E consult reads "raw 4 / grad 1" at gm 0.17-0.24 with a
  labelled 1 — the raw scan correlating on the coloured diamond face — and the refusal
  hands the enumeration a coin flip. Gradient alone was measured as a loss in round 3 and
  the ink-geometry corroborator failed above, so the third channel still has to be found.
  On outcomes the residual 57 is: TYPE 9 (8 of them rule B's own false side, on cells with
  no chartreuse ink at all) · AMOUNT 17 · TARGET 10 · DROPPED 12 (grey-rendered icons with
  unreadable captions) · DIRECTION 4 · COSTSIGN 2. The cheapest-looking next tile is the
  willpower/order **direction**: those amounts render vivid YELLOW ("+1"/"−1"), which
  `isAmountText` (h 55-95) cannot see at all, so those cells reach the fallback with no
  located line — a third locate predicate for the vivid band is the obvious try.

Shipped 2026-07-29 (structural pin 92; outcomes gate ratcheted 0.91 → 0.94). Orchestrator
verified: gate PASS at 96.7% / 95.0%, 0 silents, 100% flag coverage; one of the round's
four label fixes (c-mrwqwzkm) re-checked against pixels — west "Ally Attack Enh. Lv. 3",
east "Atk. Power Lv. 4", levels sum 12 = header. Frontier is now effect1Level (91.7).

### 2026-07-29 · iteration 7 — round 5: the reads that were looking in the wrong place
effect1Level (91.7) was the binding field and round 4 pointed at the assignment block.
The assignment block turned out to be a symptom. Three of this round's four wins are the
same bug in three places: **a read anchored by a fixed offset instead of locating its own
line**, so the crop clips the very ink it is meant to read. No data files were rebuilt —
glyphs and level-refs stay byte-identical to round 2.

**Harness.** Round 4's parallel harness was re-created as `r5/ph.js` (6 dedicated
tesseract lanes, one per image) and extended to mirror `tools/eval-ocr.js`'s `scoreOne`
exactly — headline, whole-parse, flag coverage, silents, FA, per-field — plus the level
provenance and the per-cell evidence. Full corpus in **202s** against the gate's ~6m25s,
and it reproduces HEAD's shipped numbers to the digit. Eleven full-corpus runs this round.

- **The points header was never LOCATED, only offset** — and it is worth more than every
  digit-level idea of the last two rounds combined. `ptsRect = bandRect(redY − 1.10·gap,
  0.13, 1.55)`: a half-height of 0.13·gap against a line whose own half-height is ~0.10
  and whose centre drifts ±0.16, so the band clips the digits (crops verified by eye —
  the gem TITLE's descenders in, the header's baseline out). **48 of 302 boards had no
  checksum at all and carried 31 of the 70 level-field misses**; on a checksum-less board
  the free nodes fall back to a blind default. Replaced with `locateLine` over a 0.36·gap
  zone under `dimBtnWhite` — the title renders rarity-COLOURED, the header plain white,
  and `findMaskedTextLine` scans bottom-up so the header wins the zone regardless. The
  accept bounds the drift (−0.34..+0.20·gap) and the width (≤1.9·gap): the "Reset (1/1)"
  row sits just below at +0.26..+0.37 and is white too, and a rejected candidate keeps
  the scan moving up. **pts-null 48 → 20**, effect1Level 91.7 → 93.0, orderLevel
  94.7 → 95.0, whole-parse 197 → 203.
- **A merged W/E level line.** The "Lv. N" row spans ~0.27·gap of ink; the locate's accept
  allowed up to 0.85·gap, so a band that bridged the name line above (or a neighbour's
  art) passed and the template pass read a digit out of the wrong row. Measured: pins off
  a 0.22-0.34·gap line are right **236/236**, off a ≥0.34·gap line **4/8**. Capping at
  0.34 for the `hasLvPrefix` nodes routes those to the no-line synth rescue (right
  133/139). effect1Level 93.0 → **93.4**, effect2Level 95.7 → 96.0, FA 6.3 → 6.2/shot.
- **The outcome amount row falls outside its own cell.** `capRect` is 0.52·gap tall; a
  two-line caption ("Willpower / Efficiency", "Ally Damage / Enh.") pushes the "+3 ▲" row
  below it, the strict chartreuse locate finds nothing, the RED sweep latches onto the
  willpower diamond's own face and the tile becomes a `lower`. A 0.66·gap zone as a
  FALLBACK rung (after strict chartreuse and strict red, before the relaxed sweep), and
  the vivid-yellow sign read moved off the whole-cell crop onto the located line. Run
  UNCONDITIONALLY it is a loss — the deeper bottom-up scan meets a chartreuse fragment
  below the amount first and the arrow box lands on red: five correct `raise willpower`
  tiles flipped to `lower`, outcomes 95.0 → 94.7 measured. As a fallback: 95.0 → 95.1.
- **A LOWER is always by 1.** `model/astrogem.js` OUTCOME_RATES carries one `change: -1`
  rung per target and no −2/−3/−4, so a parsed "lower by 2" is not a rare event, it is a
  misread — and the wrong channel is the AMOUNT (on a lower tile the amount renders red
  and the chartreuse reader picks up the ▼). Corpus check: **0 of 302 labels** contain a
  lower ≥2; the engine emitted 3 and every one of their labels is the same target lowered
  by 1. Enforced in `snapOutcome` (so manual entry and any other engine get it too) and
  in the cell reader, flagged at 0.7. outcomes 95.1 → **95.4**, whole 204 → 206.
- **Title vocabulary** (from the corpus-expansion pass, verified against samples-v2, which
  stays out of this round's eval): `collapse` (chaos, cost 10) added to GEM_NAME_COST,
  GEM_TITLES and `canonicalGemSuffix` — it sits ≥6 edits from every other suffix (nearest
  solidity 6), so it cannot reach the ≤2 or the d=3-with-margin rung on anything but
  itself, and the minimum pairwise distance among suffixes stays 4. A **green** TITLE_HUES
  family for uncommon gems, a rarity the round-3 survey never saw. Measured on the two
  Collapse boards: HEAD read `corrosion@0.20` and shipped baseCost 10 at conf **0.50** — a
  flagged default that happened to be right; they now read `collapse@1.50` and ship 10 at
  **0.85**. The `Processed ` title PREFIX needs no code: the suffix matcher is not anchored
  and "processed" sits ≥7 edits from every suffix, exactly like the ever-present "astrogem"
  decoy — confirmed by parsing all four affected boards.

**Same-labels A/B, full corpus, 302 scored pairs** (A-arm = unmodified HEAD in a
`git worktree` with `samples/` symlinked in; it reproduces the shipped round-4 numbers
exactly). **No labels were changed this round**, so the arms are identical by construction.

| metric | round 4 (A) | round 5 (B) |
|---|---|---|
| headline per-field avg | 96.7% | **96.9%** |
| whole-parse | 197/302 (65.2%) | **206/302 (68.2%)** |
| flag coverage | 100.0% (157/157) | **100.0%** (147/147) |
| silent errors | 0 | **0** |
| false alarms/shot | 6.3 (1902) | **6.2** (1885) |
| outcomes | 95.0% | **95.4%** |

Per-field (A → B): effect1Level **91.7 → 93.4** · orderLevel 94.7 → **95.4** · outcomes
95.0 → **95.4** · effect2Level 95.7 → **96.0** · willpowerLevel 94.7 → **94.4** (the only
regression, one board — see below) · baseCost 99.7 · gemType 99.3 · currentTurn 99.7 ·
maxTurns 100 · rerollsRemaining 97.7 · processCostMultiplier 97.7 · effect1 95.4 ·
effect2 95.4.

Residual wrong fields (A → B): effect1Level 25 → **20** · willpowerLevel 16 → 17 ·
orderLevel 16 → **14** · effect1 14 → 14 · effect2 14 → 14 · effect2Level 13 → **12** ·
rerollsRemaining 7 · processCostMultiplier 7 · gemType 2 · baseCost 1 · currentTurn 1.
Outcome tiles missed 60 → **56** over 40 boards. Boards with ≥1 level miss 49 → 40.

**The one regression is understood and is not a label error.** `c-mrvlbn9s-qc0o42`:
the recovered checksum (pts=6, correct) plus a wrong W pin forces willpower to 2. The
wheel was cropped and read by eye — N=1, W "Ally Attack Enh. Lv. 2", E "Brand Power Lv.
1", S "Chaos Points 2", sum 6 — the label is right and the engine's W='1' is the miss.
Same shape on `c-mrw7u3ou-v97a0f` (N=3, W Lv.2, E Lv.2, S=5, sum 12) and
`c-mrwinias-d061v7` (N=2, W "Boss Damage Lv. 4", E "Atk. Power Lv. 1", S=2, sum 9): all
three labels verified correct against pixels, all three are a synth-sourced W='1'. A
recovered checksum makes a wrong pin louder — it moves the error rather than adding one,
and the board was already wrong.

**No label changes this round.** Every label the new numbers put in question was checked
against the pixels and upheld.

**RULED OUT, with numbers:**
- *The "Lv. N" LINE-WIDTH channel as a 1-vs-not-1 verifier* — the round-4 lead for an
  independent third channel, and it is genuinely independent (whole-line ink extent, not
  correlation and not per-glyph segmentation). On full-line locates (245 W/E rows)
  `w/h < 2.56` predicts value 1 at **97.6% precision / 66% recall**. Scored against the
  labels it is worth **exactly zero**: 0 fixes, 2 breaks, and 81 no-ops on nodes the
  engine already reads right. The reason is the same one that sank round 4's ink
  geometry, seen from the other end: **22 of the 34 residual W/E misses have no located
  line at all** and 8 more locate as a merged band. The channel is absent precisely where
  it is needed. Any future verifier for this family has to work from a node with NO
  usable line — that is the actual constraint.
- *Un-pinning a synth-sourced W/E read whenever a checksum exists* — round 4's "a verifier
  must be able to UN-PIN", measured directly. 7 boards better, 5 worse: whole-parse
  206 → 210 and orderLevel 95.4 → 96.0, but effect2Level 96.0 → 95.0 and FA 6.2 → 6.3,
  headline flat at 96.9. The losses are boards where BOTH W and E are synth reads — three
  free nodes and the enumeration wanders (`c-mrwrevz3-2gkoti` went from a perfect parse to
  three wrong levels). Gating on "≤2 free nodes" kills the wins too, because nearly every
  case un-pins both. Net −1 field for no headline gain.
- *Accepting a bounds-DEFYING header OCR* (the pts run-crop rescue currently rejects a
  value outside the pinned reads' feasible range; the theory was that the bounds come from
  pins that may be wrong): orderLevel 95.4 → 94.4, whole-parse 206 → 203. The bounds are
  the better evidence.
- *A dimmer white predicate for the header locate* (s<0.36 v>0.42, on the 24 frames where
  the strict locate finds nothing): located **zero** extra headers and changed no board's
  pts. Removed.
- *Tightening the W/E line-locate centring* (|dx| 0.28 → 0.12·gap): byte-identical corpus
  result. Reverted.
- *False alarms*: not touched again, deliberately. 1885 FAs against 0 silents, and nothing
  this round created new certainty about the 0.70-0.75 effect band.

Gate: lint-labels 0 errors; 96.9% ≥ 96% · 95.4% ≥ 94% → **PASS**. Both gate numbers have
headroom now (0.9 and 1.4 points), so the ladder can go to **0.96/0.95** at ship — the
headline is still the binding one.

- Next (iteration 8): the frontier is **a W/E node with no located line**. 20 of the
  remaining level misses are effect1Level and the dominant cause is a synth-sourced W='1'
  on a node whose "Lv. N" row never located — the absorber class, now with a working
  checksum standing behind it, which means one extra channel there converts directly. The
  measured hard constraint on any candidate: it must not need the line locate, because
  that is exactly what is missing. Second: **20 boards still have no checksum**; the
  survivors split into localized clients (a Russian frame reads "Уровень рунита: 4" — a
  different UI), captures whose header carries no white-ish ink at all, and geometry that
  puts "Reset (1/1)" where the header should be. Third: effect1/effect2 names hold at 14
  each and stay DATA-bound (the corpus-expansion pass feeds them). Outcomes' residual 56
  tiles over 40 boards is now the second-largest block.

