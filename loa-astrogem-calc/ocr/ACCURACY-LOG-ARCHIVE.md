# Advisor OCR campaign — FULL ARCHIVE (rounds 1-10)

Chronological detail for every round. **Start with `ACCURACY-LOG.md`** — it carries the
current state and the ruled-out index. Come here only for a specific round's workings;
this file is 100KB+ and reading it end to end has stalled agents.

---

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


### 2026-07-29 · corpus merge — 302 → 385 scored pairs (83 unseen boards added)
samples-v2 merged after round 5 shipped (see samples-v2/MERGE-PLAN.md). Lint 0 errors.
Re-baseline on the EXPANDED corpus — **not comparable to the 302-pair numbers**:

| metric | 302 pairs (seen) | 385 pairs (+83 unseen) |
|---|---|---|
| headline | 96.9% | **95.2%** |
| whole-parse | 68.2% | 60.5% |
| flag coverage | 100% | **98.9%** |
| silent errors | 0 | **3** |

The 1.7pt drop is what unseen data is for — it measures generalization, not regression.
The serious part is the **3 silent errors, all `rerollsRemaining`** (conf 0.80–0.85),
breaking the campaign's hard invariant on its first contact with fresh boards:
- `c-mrxvkvlc-88d6k8` 0≠1 @0.80 — orchestrator pixel-checked: the Charge button is
  plainly GOLD, so the label's 1 is right and the engine is confidently wrong.
- `c-mryrst7q-798yaa` 1≠0 @0.85 and `c-ms2kf8ya-dsa1fs` 1≠0 @0.85 — the OPPOSITE
  direction, so the gold-vs-grey Charge discriminator is not merely biased, it is
  unreliable on boards it was not tuned against.

Gate reset to 0.95/0.94 for the new corpus (a corpus change resets the scale; ratchet
resumes from here). Round 6's first job is restoring silents to 0.

### 2026-07-29 · iteration 8 — round 6: the button's face, and a data rebuild
The corpus merge had broken the campaign's hard invariant: **3 silent errors, all
`rerollsRemaining`, pointing in both directions**. That was the whole of priority 1, and
it turned out to be one test failing in two independent ways. The round's second half is
the reference harvest the merge finally made possible. Harness: round 5's `r5/ph.js`
copied unchanged to `r6/ph.js`; it reproduces HEAD's 385-pair numbers to the digit in
**251s**. Ten full-corpus harness runs this round, plus the serial gate.

- **The Charge gold-vs-grey test was one-sided, and both sides of it broke.**
  `chargeGoldPred` required `v > 0.5`; a real gold button on a dim capture measures
  meanV **0.45**, so only 5% of the located rect passed — 355 px against a 451 px bar —
  and `c-mrxvkvlc-88d6k8`'s plainly amber button was called grey. In the other
  direction the "grown" re-measure reaches **0.55·gap DOWN**, which is where the gold
  CURRENCY COIN icons sit; a coin is small but perfectly compact, so `count ≥
  0.008·gap² && density > 0.45` passed on 271 px at density 0.81 — `c-mryrst7q-798yaa`
  and `c-ms2kf8ya-dsa1fs` called gold. All three crops were read by eye; both labels
  upheld. Replaced by `chargeFace`: a TWO-CLASS measurement of the same pixels — amber
  FRACTION vs neutral fraction, v floor 0.14. Mined over all **177** corpus boards that
  reach this branch, amber is **[0.43, 0.97] on every gold button and [0, 0.07] on every
  grey one** — one gap, no overlap, bar at 0.25. A fraction cannot be carried by a
  compact foreign blob: the coins are 0.9% of the grown rect. The grey side additionally
  requires a grey face to FILL the rect (`neutral ≥ 0.25`, corpus min 0.51) so a rect
  that drifted off the button cannot be read as "spent" by mere absence of amber; when
  it does not, the value still commits but at **0.7 — below the flag line**, where the
  old code committed grey at 0.80, exactly AT the silent threshold, warning nobody.
- **Level-refs rebuilt from the merged corpus, with a locale guard.**
  `tools/build-level-refs.js` gained a `LOCALIZED` exclusion list — the 6 ru + 2 zh-TW
  boards from `samples-v2/manifest.json` plus the two older localized boards named in
  rounds 3-4. It is a LIST on purpose: the supervised verify that guards the W/E digit
  refs ranks candidates against a pool built from the same candidates, so it cannot be
  trusted to expel a whole foreign glyph set — the round-2 "Lv."-fragment shape. Measured
  eligibility (g0 ≥ 110, non-holdout): only `c-mryunsmb` (zh-TW, g0 125) and
  **`c-mrwgjrp2-1jqlzy` (es, g0 122) actually reached the harvest — the Spanish board had
  been filing "Daño de jefe" captions under "Boss Damage" since round 2.** Harvest: 271
  samples, 76 holdout, 10 localized; W/E verify kept 109/138; every name class now has
  its full 6 exemplars on both nodes, and `W|Ally Attack Enh.` goes from **hi=0 to hi=6**
  sharp exemplars (measured per-tier, exactly as the merge promised). Isolated A/B
  (identical engine, only `ocr/level-refs.js` differs): headline 95.2 → **95.5**,
  whole-parse 235 → **247**, willpowerLevel 94.3 → **95.6**, orderLevel 95.1 → **95.8**,
  effect1Level 91.2 → **92.2**, effect1 91.7 → **92.5**.

**Same-labels A/B, full corpus, 385 scored pairs.** A-arm = unmodified HEAD in a
`git worktree` with `samples/` symlinked in, so both arms score the round-6 labels.

| metric | HEAD (A) | round 6 (B) |
|---|---|---|
| headline per-field avg | 95.2% | **95.5%** |
| whole-parse | 232/385 (60.3%) | **246/385 (63.9%)** |
| flag coverage | 98.6% (276/280) | **100.0%** (263/263) |
| **silent errors** | **4** | **0** |
| false alarms/shot | 6.3 (2419) | 6.3 (2434) |
| outcomes | 94.2% | **94.4%** |

Per-field (A → B): willpowerLevel 94.3 → **95.6** · effect1 91.7 → **92.5** ·
rerollsRemaining 96.1 → **97.1** · orderLevel 94.8 → **95.6** · effect1Level 91.2 →
**91.9** · effect2 91.4 → **91.7** · effect2Level 94.8 → **94.3** (the only regression,
−2 boards, from the ref rebuild) · baseCost 96.9 · gemType 99.2 · currentTurn 97.9 ·
maxTurns 99.7 · processCostMultiplier 95.0. Field-level: **42 fixed, 25 broken**; scalar
misses 219 → **202** over 127 → **116** boards; outcome tiles 89 → 87.

Residual wrong fields (B): effect2 32 · effect1Level 31 · effect1 29 · effect2Level 22 ·
processCostMultiplier 19 · willpowerLevel 17 · orderLevel 17 · baseCost 12 ·
rerollsRemaining 11 · currentTurn 8 · gemType 3 · maxTurns 1.

Holdout vs in-sample (djb2%5==0, and the refs were rebuilt this round so the split is
load-bearing): holdout headline 94.9% both arms with whole-parse **45 → 49**; in-sample
95.2 → 95.7 with whole **187 → 197**. The ref gain shows on frames the templates never
saw, proportionally more than in-sample — it is not memorization.

**Label fix (pixel-arbitrated):** `c-mrw7refw-f4n86c` rerollsRemaining 0 → 1. The located
pill rect is a solid amber face (amber fraction 0.93, mean s 0.68) with bright white
"Charge" text — the same rendering as the 100+ boards labelled 1, and nothing like the
grey face (amber 0.00, neutral 0.51-0.75) on every board labelled 0. The collection-time
engine also read 0, so the promotion trust mask kept it: **shared mode again**, and it
means HEAD actually carried 4 silents, not 3.

**RULED OUT, with numbers — the whole "finish the checksum-less boards" line.**
Round 5 named this the tractable part of the level-field frontier. It is not tractable
and it is not worth anything; the population that lacks a checksum is exactly the
population whose node reads refuse. On the expanded corpus **40 boards** have no
checksum, carrying 25 of the 96 level misses. A new `opts.trace` on
`findMaskedTextLine` (kept — a null locate was previously unattributable) showed the
header is PLAINLY LEGIBLE on all of them and the locate is what fails, two ways:
- *`opts.colMinFrac` — a robust band width* (a column must hold ≥20% of the band height
  in mask pixels, so one background sparkle at each side cannot stretch a centred
  1.0·gap header to 2.3-3.1·gap and get it rejected). It recovers 3 checksums alone and
  12 in combination, all matching the label sum, and it is **UNSAFE**: on five boards
  whose header located correctly at dy −0.09..−0.13, narrowing let a DIFFERENT white line
  at dy +0.17..+0.18 clear the width accept first — the scan is bottom-up and stops at
  the first accepted band — and the correct checksums 11/8/6/11/8 became **8/9/8/null/9**.
  The over-wide measurement had been accidentally protecting the header. The dy window
  cannot be tightened past +0.16 either: real headers sit at +0.19 on six boards.
  Reverted, implementation and all.
- *A BRIGHTER second locate predicate* (s<0.3 v>0.78) when the strict locate returns
  null — the other direction from round 5's ruled-out dimmer predicate, and unlike it,
  it works as a locate: **6 boards recover a header and all 6 checksums match the label
  sum**. Still a net LOSS: whole-parse 246 → 245, willpowerLevel 95.6 → 95.3,
  effect1Level 91.9 → 91.7. `_debug.lvl` says why — `c-mrw5h45e` pins N=3 against a
  labelled 5 with W/E/S all `null@0.00`, so a correct pts=8 makes the enumeration push a
  compensating 3 into E: one wrong field becomes two. `c-mrw55ewi` is the same shape.
  Reverted; the negative is written beside the locate it would have extended.
- *Widening the header locate's width cap 1.9 → 2.6·gap* (accept the sparkle-stretched
  bands instead of rejecting them): recovered boards 12 → **4**, because a too-wide band
  then passes the PRIMARY locate and the crop committed to is mostly background.
- *False alarms*: not touched again. 2434 FAs against 0 silents.

Gate: lint-labels 0 errors; **95.5% ≥ 95% · 94.4% ≥ 94% → PASS** (`npm run eval-gate`,
serial; the parallel harness reproduces it to the digit — 246/385 whole, 263/263 flagged,
0 silents). Thresholds untouched: the corpus-change reset stands and the headline clears
by only 0.5, so the ratchet resumes next round, not this one.

**NOT DONE (owner's call at ship time):** version pins in `index.html` were left alone as
instructed — `ocr/layout.js?v=54`, `ocr/level-refs.js?v=3` and
`ocr/structural-engine.js?v=93` all need a bump before this deploys, and level-refs is a
597KB lazily-loaded payload that a stale pin would keep serving from cache.

- Next (iteration 9): the frontier is unchanged in shape and now unambiguous —
  **per-node evidence on a degraded W/E node**, with the checksum route closed by
  measurement. The three name/level blocks are effect2 32 · effect1Level 31 · effect1 29.
  Of the 65 effect-name misses, **35 sit at confidence ≤ 0.30** (22 at 0.00, where both
  `structuralName` and `synthNameRescue` refuse, and 13 at 0.30, the constraint-snap's
  forced-into-pool substitution, which is **0 for 13** — a tier that is always wrong is
  worth a look on its own). Everything at 0.68+ is essentially perfect (0 wrong in 500+),
  so the names are still DATA-bound and the next lever there is more sharp exemplars, not
  another rung. `processCostMultiplier` (19 misses, 95.0%) has not been touched since
  round 1 and is now the largest non-name block. The 8 localized boards remain excluded
  by design; a locale-aware `extractPts` would recover their checksums but they are out
  of the "normal screenshots" goal.

### 2026-07-29 · iteration 9 — round 7: the row the game itself points at
`processCostMultiplier` (95.0%, 19 misses) was the largest non-name block and had not been
touched since round 1; the effect-name "forced into pool" tier at confidence 0.30 was
**0 for 13**, a rung that is never right. Both are fixed. No data files were rebuilt —
glyphs and level-refs stay byte-identical to round 6, so every point below is engine work.
Harness: round 6's `r6/ph.js` copied to `r7/ph.js`, 385 pairs in **267s**; it reproduces the
serial gate to the digit. Eight full-corpus harness runs plus the gate.

- **The cost row was never located either — and the game draws its own anchor.** Same shape
  as round 5's points header, one field over. `costZone` runs goldY+1.13..1.63·gap; the cost
  row's text centre, measured over all 385 boards, sits at **goldY+1.61·gap** (p2 1.50,
  p98 1.75), so the zone's BOTTOM EDGE cuts the row in half. The 19 misses split three ways:
  5 located nothing (a lone '0' carries ~4 ink px per row against a `minRowPx` of gap·0.03≈7),
  7 located the outcome-strip band ABOVE through `findMaskedTextLine`'s untraced top-edge
  fallback, and 7 reached the ZERO rung and were refused by an `iouDigit` of **0.63-0.66** on
  a '0' that is plainly legible by eye. Every one of the 19 sat on a board labelled ±100;
  **not one of the 335 boards labelled 0 was ever over-read**, which is why the historical
  149 false alarms looked harmless.
  The replacement anchors on the **currency COIN**: a vertical PAIR of equal gold discs (the
  cost row's, and the Balance row's one line below), present on **379 of 385** boards —
  pitch 0.24-0.37·gap, top coin 1.79-2.81·gap right of cx and 1.30-2.44·gap below goldY. That
  drift is four times what any fixed offset survives, which is precisely why the offset lost.
  What the strip left of the coin is read FOR is the **digit COUNT, not the digits**: the cost
  is right-aligned and can only be 0, 900 or 1,800, so 1 glyph ⇒ 0, 3 ⇒ 900, 4 (narrow '1' +
  comma + 800) ⇒ 1,800. Counting survives the classification noise that sinks the value read —
  the same '0' scores anywhere from 0.41 to 1.00 across capture scales. Two colour predicates
  must agree: white text, and a white-or-amber one for the boards where the number carries the
  game's gold "changed" glow (on those the white mask keeps only the leading '1'). Measured:
  **369 read, 369 right, 0 wrong, 11 refused** (10 of the 11 default correctly). A neutral-disc
  fallback, which runs only when the gold pass finds no pair, recovers the one client that
  renders the currency SILVER. **processCostMultiplier 94.2 → 100.0%**, and its ~149 false
  alarms went with it (FA 6.3 → 5.9/shot).
- **The 0.30 tier was three bugs, not one pool problem, and none of them was the pool.**
  1. *A defaulted null out-ranked a read.* `constraintSnap` snapped slot 1 first and handed
     its answer to slot 2 as `avoid` — so an ABSENT effect1 took pool[0], and on two boards
     pool[0] was exactly what effect2 had read correctly, bumping the true name off it.
     The snap now SEATS both reads first and fills afterwards. `snapEffectToPool` fell out
     of use and was removed.
  2. *A null cost erased read names.* When the title fails, baseCost stays null, the snap
     defaults 10, and pool 10 erases every committed name it does not contain — 6 correct
     names on 5 boards. The late rescue rungs run with `poolNames === null`, so they
     legitimately emit cost-8/9 names. A **pool backstop** now emits a name-consistent
     baseCost at 0.4 (flagged) when the default pool CONTRADICTS the committed names; on 3
     boards the name pair pins the cost outright (Boss Damage ∧ Ally Damage Enh. is pool 9
     alone, Ally Damage Enh. ∧ Brand Power is pool 8 alone). Boards whose true cost is 10
     are untouched by construction.
  3. *A rescue duplicated the other slot's name.* effect1's late rescue runs AFTER effect2
     commits and passed `avoid = null`, so it could take the name slot 2 already held; the
     snap then force-distinguished them by bumping effect2 into pool order.
  The 0.30 tier is now **empty**. baseCost 96.9 → **98.7** · effect1 92.5 → **93.8** ·
  effect2 91.7 → **93.2**.

**Same-labels A/B, full corpus, 385 scored pairs.** A-arm = unmodified HEAD in a
`git worktree` with `samples/` symlinked in, so both arms score the round-7 labels.

| metric | HEAD (A) | round 7 (B) |
|---|---|---|
| headline per-field avg | 95.5% | **96.3%** |
| whole-parse | 244/385 (63.4%) | **261/385 (67.8%)** |
| flag coverage | 100.0% (266/266) | **100.0%** (226/226) |
| silent errors | 0 | **0** |
| false alarms/shot | 6.3 (2431) | **5.9** (2277) |
| outcomes | 94.4% | 94.4% |

Per-field (A → B): processCostMultiplier **94.2 → 100.0** · baseCost **96.9 → 98.7** ·
effect2 **91.7 → 93.2** · effect1 **92.5 → 93.8** · gemType 99.2 · currentTurn 97.9 ·
maxTurns 99.7 · rerollsRemaining 97.1 · willpowerLevel 95.6 · orderLevel 95.6 ·
effect2Level 94.3 · effect1Level 91.9. Field-level: **40 fixed, 0 broken** — the first
strictly-positive round of the campaign. Scalar misses 205 → **165**, boards with ≥1
scalar miss 118 → **96**. Outcome tiles unchanged (this round touched no cell reader).

Residual wrong fields (B): effect1Level 31 · effect2 26 · effect1 24 · effect2Level 22 ·
willpowerLevel 17 · orderLevel 17 · rerollsRemaining 11 · currentTurn 8 · baseCost 5 ·
gemType 3 · maxTurns 1 · processCostMultiplier **0**.

Holdout vs in-sample (djb2%5==0; no refs were rebuilt, so the split only guards the mined
thresholds): holdout headline 94.2 → **94.7** with whole 47 → 48; in-sample 95.8 → **96.6**
with whole 197 → 213. processCostMultiplier is **100% on both** (73 holdout, 307 in-sample).
Wall time is unchanged (267s vs the A-arm's 268s): the coin blob scan is free against OCR.

**Label fixes (three, all pixel-arbitrated, all shared mode).** Each is a `class: "fix"`
record whose processCostMultiplier the user never corrected, where the collection-time
engine also defaulted 0 — so the "engine agrees" trust mask kept the default. Crops taken
from the coin-anchored row at 4× nearest-neighbour and read by eye:
- `c-mrtozati-lhefaf` 0 → **−100**: the row reads "Processing Cost 0", one lone glyph
  right-aligned against the coin, no ink in the two digit slots left of it under either mask.
- `c-mrxd1quv-ynwd48` 0 → **−100**: same, a single right-aligned glyph.
- `c-mrw7refw-f4n86c` 0 → **+100**: the row reads "Processing Cost 1,800", geometrically
  identical to the eleven boards labelled +100 at the same capture scale. This is the board
  whose rerollsRemaining round 6 corrected — the same shared-mode failure, twice over.
Without these three the new reader would have shown 3 "regressions"; with them it shows none.
Lint: 391 labels, 0 errors.

**RULED OUT, with numbers.**
- *The W/E level PIGMENT route* — the obvious follow-on from the two locate bugs this round
  fixed, and it is closed. On the 33 boards carrying a no-line W/E level miss, a hue histogram
  of every bright saturated pixel (s>0.45, v>0.55) in the below-centre node box shows the
  diamond FACE, not the digit: at W the mass is 70-100° (green), at E 170-210° (blue), and the
  gold band `isGoldText` reads (30-60°) holds **0-412 px out of 1,400-14,400**. On 8 of the 33
  it is 0-25 px — the whole bright content of the crop is face. The "Lv. N" ink on the degraded
  tier is chartreuse over a green face and is not separable from it by hue, which is the same
  wall round 4's ink geometry and round 5's line width hit from their own directions. Any
  future channel here has to work from a node with no located line AND no separable pigment.
- *Naive digit-count on ONE predicate* for the cost: 371 right / 5 wrong / 4 refused against
  the two-predicate agreement's 369 / 0 / 11 (post-label-fix: 372/2 vs 369/0). Two of the
  five errors are boards whose digits fragment under the white mask alone; requiring the
  amber pass to agree converts them from wrong answers into refusals, and a refusal defaults
  to 0, which on this field is right 88% of the time.
- *A run-gap factor of 2.0·median-height* instead of 1.5 when walking the trailing digit run:
  6 wrong instead of 5 — at 2.0 the run swallows a "Processing Cost" label fragment sitting
  1.8 median-heights left of the number and the count becomes 4 on a true 900.
- *False alarms*: not touched as a target again. They fell 2431 → 2277 as a by-product of the
  cost read — those were the 149 "cost unread, default happened to be right" flags round 3
  first characterised. The 0.70-0.75 effect-name band is untouched and still needs a verifier.

Gate: lint-labels 0 errors; **96.3% ≥ 95% · outcomes 94.4% ≥ 94% → PASS** (`npm run eval-gate`,
serial; the parallel harness reproduces it exactly — 261/385 whole, 226/226 flagged, 0 silents,
2277 FAs). Thresholds untouched. The headline now clears by 1.3 points, so the ratchet has room
at last, but **outcomes clears by only 0.4 and is the binding constraint** — a headline ratchet
to 0.96 is safe, an outcomes one is not.

**NOT DONE (owner's call at ship time):** version pins in `index.html` were left alone as
instructed — `ocr/engine.js`, `ocr/layout.js?v=54`, `ocr/level-refs.js?v=3` and
`ocr/structural-engine.js?v=93` still need a bump before this deploys.

- Next (iteration 10): **effect1Level 91.9 (31 misses) is the binding field again**, and the
  frontier is unchanged and now triply-measured: a W/E node with no located line, no usable
  checksum, and no separable pigment. Three independent channels have been ruled out with
  numbers (ink geometry, line width, hue). The honest read is that this block is not an
  engine problem any more — it is the degraded tier of the corpus, and the levers left are
  sharper exemplars (the samples-v3 pass is aimed exactly there) or a different capture. The
  name blocks (effect2 26 · effect1 24) are the same story: everything at 0.68+ is 543/544
  right, and the misses concentrate in the fuzzy "damage" family tie at 0.64-0.66 (14 of 24
  right), which is an NREFS-diversity problem. The cheapest remaining ENGINE work is
  **outcomes 94.4%** — the binding gate constraint, untouched this round, with round 6's
  taxonomy (TYPE 9 · AMOUNT 17 · TARGET 10 · DROPPED 12 · DIRECTION 4 · COSTSIGN 2) still
  standing and the vivid-yellow direction locate still not tried.

### 2026-07-29 · corpus merge 2 — 385 → 472 scored pairs (87 more unseen boards)
samples-v3 merged after round 7 shipped; 12 harvest exclusions added to
`build-level-refs.js` LOCALIZED (now 22 entries) BEFORE any re-harvest.
Re-baseline on the expanded corpus (not comparable to the 385-pair scale):

| metric | 385 pairs | 472 pairs |
|---|---|---|
| headline | 96.3% | **96.1%** |
| whole-parse | 67.8% | 67.4% |
| flag coverage | 100% | **98.9%** |
| silent errors | 0 | **3** |

Barely any headline drop this time (0.2pt vs 1.7pt on merge 1) — the engine now
generalizes far better. But **unseen boards broke the zero-silent invariant a second
time**, in three new places: `currentTurn` 8≠7 @0.85, `gemType` chaos≠order @0.90 (on a
Russian board), and an `outcomes` set @0.84.

**The pattern is now established and worth stating plainly: every corpus expansion has
exposed confident-but-wrong reads that the previous corpus could not see.** Zero silents
measured on boards the engine has grown into is a weaker claim than it looks.

Therefore the gate now ENFORCES it: `tools/eval-ocr.js` fails on any silent error,
alongside the headline/outcomes thresholds. The invariant is machine-checked from here.

### 2026-07-29 · iteration 10 — round 8: the willpower tile, and a reference set that would not improve
The merge left three silent errors and the gate now fails on any. All three are fixed, and the
biggest of them opened the outcome block the last four rounds kept naming: **DIRECTION misses went
from 4 on the 385 corpus to 20 on the 472 corpus**, and 14 of the 20 are one tile — `lower willpower 1`
read off a plainly yellow "+3 ▲". No reference data was rebuilt in the shipped tree (see the ref
sweep below, which is the round's other half and its main negative result). Harness: round 7's
`r7/ph.js` copied to `r8/ph.js`, 472 pairs in **325s**; it reproduces the serial gate to the digit.
Nine full-corpus harness runs plus the gate.

**PRIORITY 1 — the three silents, each checked against pixels before touching anything.**
- `c-mrxn60s5-znug2k` **currentTurn 8 ≠ 7 @0.85 — engine wrong, label right.** The footer crop reads
  "Process (3/9)" at 5×, and the template glyph run reads it perfectly: `3@0.85 /@0.94 9@0.76`. The
  '9' died on `pairDigit`'s open-atlas floor of 0.80, the pair collapsed to the button-OCR voter,
  which read 2/9, and 0.85 is above the flag line. **N can only be 5, 7 or 9** — an open-vocabulary
  floor is the wrong test for it. Below 0.80 the digit may now still commit when the ink-IoU
  restricted to `{5,7,9}` independently picks the same class with margin ≥ 0.08; here it says
  `9:0.48 5:0.30 7:0.21`, margin 0.18. **currentTurn 97.9 → 99.2** (6 boards), maxTurns 99.8 → 100.0.
- `c-mrzz2neu-teo43a` **gemType chaos ≠ order @0.90 — LABEL wrong, engine right.** The board is the
  ES client: the title reads "Astrogema del caos: corrosión" (= Chaos Astrogem: Corrosion) and the S
  node reads "Caos Puntos 1" — two independent readings, both chaos, and its own `_verify` note
  already said "chaos Corrosion" while `config.gemType` still said "order". That is the stale
  collection-time default rounds 3 and 6 documented, surviving the trust mask on a field the user
  never corrected. **The honest fix is to read it correctly, not to refuse it**: the localized guard
  exists to keep foreign glyphs out of the reference HARVEST, and this board is already in that
  exclusion list; nothing about a Spanish title makes the gem type unreadable, and the engine had it
  right. Label corrected; `_verify.fields.gemType` now records both readings.
- `c-ms167ipv-wwujgv` **outcomes @0.84 — engine wrong, label right** (strip reads
  `Ally Damage Enh. Lv. 3 ▲ | Brand Power Lv. 1 ▲ | Brand Power Lv. 2 ▲ | Ally Damage Enh. Lv. 1 ▲`).
  Tile 4 read amount 4. `amtContra` — the rule that caps a weak-template amount the synth
  contradicts — only fired when the consult REFUSED, so **the weaker form of dissent was penalised
  and the stronger one was not**: a consult that actually committed a different value but missed the
  gradOnly override bar (gm 0.095 against a bar of 0.10) shipped at full confidence. Both forms now
  count. The value is fixed too, see the amount rung below.

**PRIORITY 2 — the outcome strip. Missed tiles 96 → 80, imperfect boards 70 → 58.**
- **A located chartreuse line on a willpower cell is itself the direction.** Round 4 proved the rule
  for effect cells ("a raise 436/436 times") and never extended it to willpower, which is where it
  matters: that cell's face IS red, so the ▼ predicate scores the FACE — measured on `c-ms1n13pa`,
  660 px at density 0.63 against a real ▲ of 55 px — and the ▲ then has to clear an absolute `frac`
  bar it misses by a thousandth (0.011 vs 0.012). Re-measured over all **1880 corpus cells by label**:
  among willpower-target cells a strict chartreuse locate fires on **291/304 raises and 0/49 lowers**
  (a willpower lower renders "−1" red on a red face and has no chartreuse ink anywhere). Two edits:
  the rule is scoped to the STRICT locates, and the red-family guard is keyed on the resolved
  **TARGET** instead of `icls` — the willpower diamond reads "gold" on `c-mrtpk4nc-w4732c` and
  `c-mrugq62n-zqc9al`, which dropped both into the count-vs-count branch and lost it 76:80 and 152:632
  to the face.
- **The extended chartreuse zone now outranks the strict RED one.** It sat one rung below, so on a
  willpower cell whose amount row falls past `capRect` the red locate ran first and always won.
  Measured by label, a strict red locate at a willpower cell fires on 47/49 true lowers **and 292/304
  true raises** — 86% uninformative — while the deep chartreuse locate is 301/304 vs 0/49. The
  reorder changes the located line on **exactly 9 cells corpus-wide and all 9 are
  `raise_effect/willpower`**: no lower, no effect and no order cell moves. (This is not round 5's
  ruled-out experiment, which made the deep zone the PRIMARY chartreuse locate and cost 5 tiles; this
  rung still only runs when the strict `capRect` locate found nothing.)
  Together: **DIRECTION 20 → 3.**
- **A weak template should not need double margin to be overruled.** The gradOnly synth override bar
  is 0.10; for `amtSrc === "tm-weak"` it is now the same 0.05 the full-agree synth uses — a 0.85-tier
  template is not a trusted read and the asymmetry had no basis. Measured: **AMOUNT 27 → 23, 4 boards
  better, 0 worse**, and `c-ms167ipv-wwujgv`'s strip goes from 3/4 to perfect.

**PRIORITY 3 — reference exemplar diversity. The picker was broken; fixing it still does not pay.**
- The defect is real and worse than reported. `pickDistinct` deduped on `g0 ===`, which is no dedup
  at all (two captures from one setup measure 244 and 243), and the BACKFILL deduped nothing
  whatsoever — it re-added the very frame the tier picker had just skipped. Measured over the 472-pair
  corpus: **19 of 20 digit classes** carried a |Δg0| ≤ 3 pair, `E|3` picked g0 244 twice, and `E|5`
  filled all six slots from {121, 123}.
- Replaced with **sharpest-first under a minimum relative separation (8% of g0)**, falling back to
  farthest-point (max-min) when a tier is too crowded, and max-min for the cross-tier backfill.
  Near-duplicate classes 19/20 → 15/20, every survivor a genuinely narrow lo tier.
- **The 2×2, one fixed engine, same labels, four full-corpus runs:**

| refs | headline | whole | outcomes | wpLvl | ordLvl | e1Lvl | e2Lvl | eff1 | eff2 |
|---|---|---|---|---|---|---|---|---|---|
| **round-6 incumbent (old picker, 271 src)** | **96.3** | **327** | **95.6** | **96.0** | 95.3 | **91.9** | 94.9 | **93.0** | 91.7 |
| re-harvest, old picker, 331 src | 95.9 | 311 | 94.8 | 95.6 | 95.3 | 90.0 | 94.5 | 92.8 | 91.5 |
| re-harvest, new picker, 331 src | 96.2 | 324 | 95.4 | 94.5 | **97.0** | 91.7 | **95.8** | 92.4 | **91.9** |
| re-harvest, new picker, 271 src | 95.9 | 304 | 95.6 | 95.3 | 94.9 | 89.6 | 96.0 | 92.2 | 90.3 |

  On the current 331-source pool the new picker beats the old by **+0.3 headline / +13 whole**. On
  the 271-source pool **the order reverses**. And the shipped round-6 file beats all three rebuilds.
  Split by batch, the re-harvest gains on samples-v3 (whole 59 → 63 of 87) and loses on the originals
  (220 → 214 of 302): more sources displace exemplars that were serving the older population.
  **The honest read is that the exemplar draw is high-variance — ±5% whole-parse across four
  defensible builds — so g0 spread is not the dominant axis of exemplar quality and no geometric
  proxy will reliably beat a lucky draw.** `ocr/level-refs.js` is therefore left at the round-6
  build, byte-identical; `tools/build-level-refs.js` ships the fixed picker (it is strictly better
  than the code it replaces on the pool that exists now) plus a loud DO-NOT-REGENERATE-WITHOUT-
  RE-MEASURING warning printed at the end of every run, because the tool overwrites a file that
  currently outperforms what it would produce. The 22 LOCALIZED exclusions were left untouched.

**Same-labels A/B, full corpus, 472 scored pairs.** A-arm = unmodified HEAD in a `git worktree` with
`samples/` symlinked in, so both arms score the round-8 labels.

| metric | HEAD (A) | round 8 (B) |
|---|---|---|
| headline per-field avg | 96.1% | **96.3%** |
| whole-parse | 318/472 (67.4%) | **329/472 (69.7%)** |
| flag coverage | 99.3% (280/282) | **100.0%** (262/262) |
| **silent errors** | **2** | **0** |
| false alarms/shot | 5.9 (2801) | 5.9 (2802) |
| outcomes | 94.9% | **95.8%** |

(HEAD carried **3** silents against the pre-round labels; the gemType one is a label fix, so the
same-labels A-arm shows 2.)

Per-field (A → B): currentTurn **97.9 → 99.2** · maxTurns 99.8 → **100.0** · outcomes **94.9 → 95.8** ·
rerollsRemaining 97.2 → 97.4 · gemType 99.4 · baseCost 97.6 · willpowerLevel 96.0 · orderLevel 95.3 ·
effect2Level 94.9 · effect1 93.0 · effect1Level 91.9 · effect2 91.7 · processCostMultiplier 99.8.
Field-level: **8 scalar fields fixed, 0 broken; 15 outcome sets better, 0 worse.** Scalar misses
214 → **206**, boards carrying one 122 → **116**. One board's outcome SCORE fell
(`c-mrw8gmxg-h54rrh`, 0.50 → 0.25) without any tile getting worse: a wrong tile stopped coincidentally
multiset-matching a different wrong tile — positionally the same three tiles are wrong in both arms.

Residual wrong fields (B): effect2 39 · effect1Level 38 · effect1 33 · effect2Level 24 · orderLevel 22 ·
willpowerLevel 19 · rerollsRemaining 12 · baseCost 11 · currentTurn 4 · gemType 3 ·
processCostMultiplier 1 · maxTurns 0. Outcome tiles missed 96 → **80** over 70 → **58** boards;
positional taxonomy (A → B) AMOUNT 26 → **23** · DROPPED 27 → 27 · **DIRECTION 20 → 3** ·
TARGET 14 → 17 · TYPE 9 → 9 · COSTSIGN 3 → 3.

Holdout vs in-sample (djb2%5==0; no refs were rebuilt, so the split only guards the mined rules):
holdout 95.2 → **95.6** with whole 60 → 63; in-sample 96.3 → **96.5** with whole 258 → 266. The gains
are not memorization — they are slightly larger on holdout.

**Label fix (one, pixel-arbitrated):** `c-mrzz2neu-teo43a` gemType `order` → `chaos`, evidence above.
Lint: 480 labels, 0 errors, 5 pre-existing warnings.

**RULED OUT, with numbers.**
- *Re-harvesting the level refs at all*, under either picker, on either source pool — the 2×2 above.
  This closes the "sharper exemplars are the lever" line the round-6 and round-7 notes both named: the
  corpus grew by 60 harvestable sources and the reference set got no better. Any future attempt here
  has to change the SELECTION CRITERION (supervised: score a candidate by how well it classifies a
  held-out set) rather than the geometric proxy.
- *Pure farthest-point (max-min) selection within a tier* — the obvious reading of "enforce g0
  spread", and it is the wrong shape. It takes each tier's two ENDPOINTS, so the second hi exemplar
  falls from g0 ~204 to ~180, hard against the mid tier's edge. The N node pays for it:
  willpowerLevel 95.6 → **94.3** while orderLevel goes 95.3 → 97.2. Sharpest-first with a separation
  floor keeps both (94.5 / 97.0) and is what shipped.
- *The vivid-YELLOW amount locate* — round 4's named next try, and it is the wrong channel. A vivid
  band (h 38-62, s > 0.55, v > 0.60) does locate a line, but measured by label over all 1880 cells it
  fires on 95/293 raise-ORDER cells and 24/48 lower-order ones: it is reading the ORDER icon's own
  gold face, not the "+N". The yellow willpower digits are only half inside it anyway (h ~45-65) and
  the ▲ beside them is already chartreuse, so the existing `isAmountText` locate reaches the row —
  it was the ladder ORDER and the direction guard that were wrong, not the pigment.
- *The DROPPED block (27 tiles, now the largest)* — inspected, not attempted. On all eight boards
  checked the icon reads `grey` AND the caption OCR is pure noise ("et a to|rrp tr tul|et",
  "hl .|ll '|[i a. [l") on captures that are legible to the eye. Both target channels are dead at
  once, which is the degraded tier, not a rule. Two of the boards are the zh-TW client.
- *False alarms*: not touched as a target again. 2802 against 0 silents, and the population is
  unchanged in shape — effect2Level 419 · outcomes 404 · effect1Level 399 · willpowerLevel 388 ·
  orderLevel 385 · effect2 318 · effect1 304, so the four level fields plus the two names carry 79%
  of them and outcomes most of the rest. Measured this round for whoever attacks it next: **1334 FAs
  (48%) sit in 0.68-0.80, against 31 real misses in the same band** — 43:1, and the misses are the
  level fields (willpower 10, effect1Level 8, order 7, effect2Level 3). Lifting the band would ship
  those 31 silently, so it still needs a verifier, not a threshold move.

Gate: lint-labels 0 errors; **96.3% ≥ 95% · outcomes 95.8% ≥ 94% · silent 0 = 0 → PASS**
(`npm run eval-gate`, serial, now machine-enforcing the zero-silent invariant; the parallel harness
reproduces it exactly — 329/472 whole, 262/262 flagged, 0 silents, 2802 FAs). Thresholds untouched:
the headline clears by 1.3 and outcomes by 1.8, so the ratchet has room in both — **0.96/0.95 at
ship** — but note that both merges so far broke the invariant on first contact with fresh boards, so
a ratchet is a claim about boards the engine has grown into.

**NOT DONE (owner's call at ship time):** version pins in `index.html` were left alone as instructed —
`ocr/engine.js`, `ocr/layout.js?v=54`, `ocr/level-refs.js?v=3` and `ocr/structural-engine.js?v=93`
still need a bump before this deploys. `ocr/level-refs.js` is byte-identical to the shipped build this
round, so its pin alone can stay.

- Next (iteration 11): the outcome strip is no longer the cheapest engine work — it clears its gate by
  1.8 and its residual is now **DROPPED 27**, which is the degraded tier with both target channels
  dead. The three name/level blocks (effect2 39 · effect1Level 38 · effect1 33) are unchanged and this
  round closed the last cheap route into them: reference re-harvesting does not help, on top of the
  ink-geometry, line-width and pigment channels ruled out in rounds 4, 5 and 7. **The honest read is
  that engine rounds against this corpus are reaching their floor and the two levers left are
  different in kind**: (a) supervised exemplar selection, which is the only untried idea with a
  mechanism behind it, and (b) a verifier for the 0.68-0.80 confidence band, which holds 1334 of the
  2802 false alarms against 31 real misses — that band is the one place where more evidence converts
  into BOTH fewer misses and fewer false alarms. More data is the weaker investment now: 87 fresh
  boards moved the headline 0.2 points, cost three silent errors (one of them a label error), and
  added 60 harvestable reference sources that made the reference set no better.


### 2026-07-29 · iteration 11 — round 9: verifiers, and the floor
Round 8 named two levers and this round spent itself on both. The first paid: **false
alarms 2802 → 2398 (5.9 → 5.1/shot, −14.4%)** with every parsed VALUE byte-identical —
0 fields fixed, 0 broken, headline 96.3, whole-parse 329, outcomes 95.8, **silents 0**,
flag coverage 100%. The second did not, and its negative is the more useful result.
No data files were rebuilt in the shipped tree. Harness: round 8's design re-created as
`r9/ph.js` (the old scratch dir was gone), 8 lanes, **472 pairs in ~110s** against the
serial gate's ~9m; it reproduces the gate to the digit. Sixteen full-corpus runs.

**The band, re-measured.** 0.68-0.80 holds **1334 false alarms against 39 real misses**
(round 8's "31" counted scalars only; the other 8 are outcome sets). By field:
orderLevel 257:7 · outcomes 242:8 · effect1 193:1 · effect2 184:0 · willpowerLevel 160:10 ·
effect1Level 144:8 · effect2Level 81:3 · rerollsRemaining 34:1 · maxTurns 20:0 ·
currentTurn 19:1. Every rule below was mined OFFLINE from a provenance dump and only then
wired in, so the 110s runs were spent on ideas that already measured.

- **The caption names the effect, and that is a second witness to the wheel's name read**
  (`structural-engine.js:3228, 3282, 3786`). Round 4 read the strip captions to resolve a
  tile's TARGET; the same text, lexed on its own, is an independent witness to the NAME —
  different crop, different mask, a separate OCR call, and the caption renders the name on
  one line at a larger effective size than the diamond's two-line label. STRICT patterns
  only: each name must show its own discriminating token, because the shared stems are
  exactly where a degraded caption would agree with a wrong wheel read for the wrong reason
  ("attack" fits both Attack Power and Ally Attack Enh.; "power" fits Attack Power and Brand
  Power). Measured on in-band reads: **156 corroborated, every one right**, against 221
  uncorroborated of which 1 is wrong. **effect1 304 → 225 FAs, effect2 318 → 240.**
- **The four-way closure the soft-header cap was throwing away**
  (`structural-engine.js:2551, 2605, 2775`). When exactly one level node is free it is
  always S — `lvFull[3]` is never pinned by construction — so that branch means three
  independently-read nodes, a header read, and the S diamond's own luminance hint, and
  `sHint === pts − pinnedSum` is four channels closing on each other. The hint is genuinely
  independent of the header: different region, different predicate (vivid-gold saturation
  vs dim white), different reader. A wrong pin would need a header wrong by the same amount
  AND a hint wrong by the same amount again. Measured by label:
  - S with the hint closing — **239 boards, 239 right, 0 wrong**, and 177 of them were
    capped to 0.70 by the blanket `ptsSoft` rule and flagged. Exempted.
  - the three SIBLINGS on a **hard**-pts closure — **186 fields, 186 right, 0 wrong**,
    87 flagged. Lifted to 0.82.
  - the three siblings on a **soft**-pts closure — 529 right but **2 wrong**
    (`c-mrw6hugm` willpower 2≠5, `c-mrxd1quv` willpower 1≠3). A soft header corroborates
    the node it DETERMINES and nothing else; siblings stay capped. **orderLevel 385 → 211
    FAs, effect2Level 419 → 381, effect1Level 399 → 369, willpowerLevel 388 → 383.**

**Same-labels A/B, full corpus, 472 scored pairs.** A-arm = unmodified HEAD in a
`git worktree` with `samples/` symlinked in. **No labels were changed this round**, so the
arms are identical by construction; the A-arm reproduces the shipped round-8 numbers exactly.

| metric | HEAD (A) | round 9 (B) |
|---|---|---|
| headline per-field avg | 96.3% | 96.3% |
| whole-parse | 329/472 (69.7%) | 329/472 (69.7%) |
| flag coverage | 100.0% (262/262) | 100.0% (262/262) |
| silent errors | 0 | **0** |
| **false alarms/shot** | **5.9** (2802) | **5.1** (2398) |
| outcomes | 95.8% | 95.8% |
| 0.68-0.80 band | 1334 FA / 39 miss | **958 FA** / 39 miss |

Per-field accuracy is unchanged on all 12 scalars plus outcomes — a verifier moves
confidence, never a value, and 0 fixed / 0 broken is the proof. Holdout vs in-sample is
identical in both arms (holdout 95.6%, whole 63/96; in-sample 96.5%, whole 266/376).
Residual wrong fields (unchanged): effect2 39 · effect1Level 38 · effect1 33 ·
effect2Level 24 · orderLevel 22 · willpowerLevel 19 · rerollsRemaining 12 · baseCost 11 ·
currentTurn 4 · gemType 3 · processCostMultiplier 1 · maxTurns 0. Outcome tiles missed 80
over 58 boards.

**PRIORITY 2 — supervised exemplar selection. Built, measured, and it loses.**
`tools/build-level-refs.js` gained a `--supervised` mode that does exactly what round 8
prescribed: the 91 holdout boards (djb2%5==0, which never contribute a patch) become an
evaluation set of observed node patches with known labels — at EVERY resolution, since the
degraded tier is what the consult exists for, and anchored the way the ENGINE anchors
(locate when the line/ink is there, else the consult's own fallback centres, over a 5×5
grid at the consult's step). Every candidate is scored against them with the engine's own
kernels (six blur sigmas, windowed-gradient + raw z-normed correlation), and exemplars are
chosen by GREEDY FORWARD SELECTION on correct-minus-wrong commits (wrong penalised 3:1),
seeded one-per-class because the consult refuses below two scoring classes and a
greedy starting empty stalls with three classes missing.

| level refs (spliced onto the incumbent NAME_REFS, one fixed engine) | headline | whole | silent | wpLvl | ordLvl | e1Lvl | e2Lvl |
|---|---|---|---|---|---|---|---|
| **round-6 incumbent (geometric picker, 271 src)** | **96.3** | **329** | **0** | **96.0** | **95.3** | **91.9** | **94.9** |
| supervised, objective-best prefix (8-12/node) | 95.0\* | 299 | 1 | 91.7 | 90.0 | 89.6 | 91.5 |
| supervised, full 6-per-class budget | 96.1 | 329 | **1** | 95.3 | 94.5 | 91.5 | 94.5 |

\*that row is the whole rebuilt file (its own NAME_REFS too); the spliced level-only run is
the fair one and is the third row.

Both variants introduce the SAME silent error (`c-mrwzbdin-lh4dxl` orderLevel 4≠1 @0.84),
which fails the gate outright, and neither beats the incumbent on any level field. Three
things went wrong and they are worth naming, because they are properties of the *signal*,
not of the implementation:
1. **The objective wants a far smaller set than the engine needs.** Its best prefix is
   8-12 exemplars per node against the engine's 30, and at full budget the greedy's own
   held-out score goes NEGATIVE (W −36, E −11): the exemplars it is forced to add make the
   consult commit more often and wrongly. End-to-end the small set is a disaster
   (whole-parse 329 → 299), which is round 2's "leaning the W/E pools costs
   effect1Level 82→75" measured a second way.
2. **It overfits 91 boards.** With `--half` (select on half the observations, report on
   the other half) N scores 33ok/1bad where it optimized and **26ok/7bad** where it did
   not; W 18ok/2bad → 13ok/4bad. The selection signal is a few dozen commit events
   choosing among 50-130 candidates per node — the variance of the draw is larger than
   the effect.
3. **The proxy is not the objective.** Held-out classification of the synth consult in
   isolation is not end-to-end accuracy: the consult is one rung among six, it is
   memoized and consulted by the enumeration as a *vote*, and its refusals are load-bearing.
   A set that classifies better in isolation can and does read worse in the engine.

`ocr/level-refs.js` is therefore left byte-identical to the round-6 build for the second
round running, and the DO-NOT-REGENERATE warning stands. **This closes the last idea with
a mechanism behind it for the level/name block.**

**RULED OUT, with numbers.**
- *Supervised exemplar selection*, both budgets, spliced and whole — the table above. The
  criterion is not the problem; the amount of supervision available is. Any future attempt
  needs a labelled evaluation set an order of magnitude larger than 91 boards, and even
  then it has to be scored end-to-end rather than on the consult in isolation.
- *The caption-name witness BELOW 0.68*. It would add 92 more corroborations at 0.50-0.60
  with 0 wrong — and 6 with **1 wrong** at 0.60-0.68 (`c-ms0uhvso-gj1ae8`: the wheel reads
  W as the name that truly sits at E, and a tile duly spells that name out). Below 0.68 the
  name did not come from the node's own graded lexical evidence but from a rescue rung
  (patch synthesis, structural line-count, a fuzzy family tie) whose failure mode is a SLOT
  SWAP, and a caption can witness that a name is on the BOARD, never which node holds it.
  One silent for 98 false alarms is not a trade this campaign makes.
- *The located line as an outcome DIRECTION witness*. The evidence is real and was measured
  positionally against the labels over every order/willpower raise-or-lower cell: a strict
  chartreuse locate means raise (willpower **297:0**, order **286:1**) and a strict red
  locate, chartreuse having declined, means lower (willpower **0:44**, order **0:43**).
  Lifting the `!signSeen` cap on a witnessed direction reclaimed only **35 false alarms**
  and cost **one silent error** — and the silent is not in the witnessed cell:
  `c-ms0lcj9n-snau3j` cell 3 reads "Lv. 3 ▲" as amount 1 at oconf 0.85, and the board was
  flagged only because that cap held cell 2 at 0.72. **`outcomes` confidence is a MIN over
  four tiles**, so every per-tile cap is incidental cover for the other three — which is
  also why the yield is so small. The 242 in-band outcome false alarms cannot be reclaimed
  a tile family at a time; they need all four tiles at once. Reverted, negative written
  beside the cap.
- *The soft-pts closure extended to the three siblings* — 529 right, 2 wrong (above).
- *Lifting the checksum-closure siblings on 2-pin or 1-pin boards* (i.e. without the S
  node's hint): nPin=2 measures 68 right / 2 wrong and nPin=1 measures 23 / 1, against
  nPin=3-with-hint's 186 / 0. Three pins is the discriminator, not the closure.

Gate: lint-labels 0 errors; **96.3% ≥ 95% · outcomes 95.8% ≥ 94% · silent 0 = 0 → PASS**
(`npm run eval-gate`, serial; it reproduces the parallel harness exactly — 329/472 whole,
262/262 flagged, 0 silents, 2398 FAs). Thresholds untouched: no accuracy number moved this
round, so there is nothing new to ratchet against.

**NOT DONE (owner's call at ship time):** version pins in `index.html` were left alone as
instructed — `ocr/engine.js`, `ocr/layout.js?v=54`, `ocr/level-refs.js?v=3` and
`ocr/structural-engine.js?v=93` still need a bump before this deploys. `ocr/level-refs.js`
is byte-identical to the shipped build, so its pin alone can stay.

- Next: **this method is at its floor and the remaining levers are different in kind.**
  Four rounds have now closed four independent channels into the W/E level block (ink
  geometry r4, line width r5, checksum recovery r6, pigment r7) and two into its data
  (reference re-harvesting r8, supervised selection r9). What is left after this round is
  958 in-band false alarms against 39 misses, and the 39 are concentrated where no
  independent channel exists: a node with no located line, no usable checksum and no
  separable pigment. The honest reading of six rounds of measurement is that a
  *correlation-and-rule* reader has extracted what this corpus contains. A genuinely
  different approach would have to (a) read the four levels JOINTLY from one crop rather
  than four nodes independently — the failures are assignments and compensating pairs, and
  every channel tried so far is per-node; (b) be trained rather than hand-derived, i.e. a
  small classifier over the wheel crop, which is the only thing that can use the 472 boards
  as *training* data instead of as a test set the way every rule has been mined; or (c)
  change the capture — the residual population is a resolution tier, not a bug, and one
  larger screenshot is worth more than any rule. On false alarms specifically, the next
  real gain is the outcome strip, and it needs the `outcomes` confidence to stop being a
  min over four tiles: per-tile flagging in the UI would let three verified tiles stay
  quiet while the fourth asks.

### 2026-07-29 · iteration 12 — round 10: read the four levels at once, and train it
**Whole-parse 330 → 355 of 472 (69.9% → 75.2%), headline 96.3 → 97.2%, false alarms
2399 → 1715 (5.1 → 3.6/shot), silents 0, flag coverage 100%.**
Round 9's verdict was that a correlation-and-rule reader had taken what this corpus
contains: six independent channels into the W/E level block had been closed by
measurement, and the residual was **assignments and compensating pairs on nodes with no
located line, no usable checksum and no separable pigment** — invisible to any PER-NODE
evidence by construction. It named two different-in-kind approaches. This round does both
at once, because they turn out to be the same thing: score whole four-value HYPOTHESES
against one wheel crop, using tables TRAINED on the corpus rather than rules mined from
it. It is the largest single-round gain of the campaign and the first to move accuracy and
false alarms together. Harness: round 9's design copied to `r10/ph.js`, 472 pairs in
**118s**; it reproduces the serial gate to the digit. Eight full-corpus harness runs plus
two gates.

- **The joint reader** (`ocr/structural-engine.js:2854-2966`, tables
  `ocr/level-model.js`, trainer `tools/build-level-model.js`). Everything above it reads
  four nodes independently: each commits or refuses on its own evidence, the committed
  ones become PINS, and the checksum fills the rest. A swap and a compensating pair are
  only wrong *jointly* — each node alone looks plausible and the sum comes out right
  either way — so that structure cannot see them however good the per-node channel gets.
  The replacement enumerates all 625 assignments and scores each as Σ log P(observation |
  value) over every channel that spoke, plus a term for the header total. Five
  observations per node, all of them things the engine already computes: the template
  pass's argmax, the synthesis consult's raw and gradient argmaxes **each conditioned on
  whether that channel was decisive** (a flat W raw ranking and a decisive one are
  different observations about the same node), the ladder's own committed read keyed by
  source and confidence bucket, and at S the diamond's luminance hint.
  Three things about the shape are load-bearing:
  1. **The header is evidence, not a filter.** `ptsHard`/`ptsSoft` are the measured rates
     at which a header read equals the true sum (**0.981** / **0.992** on the training
     split), so a strong tuple can outvote a wrong header instead of being excluded by
     it. The old solve made pts a hard feasibility gate and then blamed the free nodes.
  2. **Nothing is pinned.** A wrong pin used to be a premise the enumeration inherited;
     round 5 measured un-pinning synth reads specifically and it was a wash (7 better, 5
     worse). Un-pinning *everything* only works when every read is priced, which is what
     the trained tables do.
  3. **The consult now runs on all four nodes, always.** It was previously asked only
     about free nodes and some rescue rungs, so the joint reader sees a channel the
     per-node solve never consulted on pinned nodes — and it is memoized, so the cost is
     under the noise floor (118s vs 118s in the same harness; the serial gate is
     unchanged).
- **Trained, with the holdout kept religiously.** `tools/build-level-model.js` calibrates
  every table on the **376 non-holdout boards** (djb2(stem)%5==0 excluded, exactly as
  `build-level-refs.js` excludes it from the reference harvest) and fits seven channel
  weights by coordinate ascent on the same split. Seven weights and Laplace-smoothed 5×6
  conditionals against 1504 training node-labels is deliberately the smallest fit that can
  say "this channel is worth less than that one" — there is no capacity to memorize a
  board, and the holdout numbers below say it did not. Ships as an 11.6 KB plain-data
  module beside the 597 KB reference file; no new runtime dependency, and the tool needs
  only sharp + tesseract.js, the pair `eval-ocr.js` already uses. Verified reproducible:
  a cold run with no cache (parses all 472 boards itself, ~15 min) emits a file
  **byte-identical** to the shipped one.
- **Why this is safe to put ON TOP of the incumbent rather than in place of it.** An
  override is capped under the flag line, always. The set of fields above 0.8 can
  therefore only shrink, and on those fields the value never changes, so **no override can
  create a silent error** — that is a structural property, not a measurement. Measured
  anyway: 71 overrides, 61 right, 5 wrong, 5 wrong either way (holdout 15 right, 1 wrong),
  and all five wrong ones ship flagged at ≤ 0.68.
- **The verifier round 9 could not find** (`structural-engine.js:2960`). The blanket caps
  (`ptsSoft` → 0.70, no-checksum → 0.78) are worst-case guards against a junk header; they
  fire on 1447 level fields of which ~1400 are right, and the joint margin is the first
  measure of a node that does not depend on the header. Where the joint reader AGREES with
  the per-node value at a decisive margin, the field lifts to 0.85. The bar `JOINT_SURE =
  12` is **twice the highest margin any WRONG level field reaches on the corpus** (6.2, at
  `c-mrugq62n`'s east node) — at the bar it lifts **758 fields, every one correct, 138 of
  them on holdout boards the tables never saw**. The factor of two is the safety margin: a
  calibrated log-likelihood ratio is optimistic about its own tails, and every corpus
  expansion so far has produced a confident read worse than anything the previous corpus
  held. Overrides are excluded from the lift on purpose, so the rule stays "the joint
  reader raises confidence only where it changed nothing".

**Same-labels A/B, full corpus, 472 scored pairs.** A-arm = unmodified HEAD in a
`git worktree` with `samples/` symlinked in; it reproduces the shipped round-9 numbers
exactly (96.3 / 329 / 2398 FA) before this round's one label fix, and 330 / 2399 after it.

| metric | HEAD (A) | round 10 (B) |
|---|---|---|
| headline per-field avg | 96.3% | **97.2%** |
| whole-parse | 330/472 (69.9%) | **355/472 (75.2%)** |
| flag coverage | 100.0% (261/261) | **100.0%** (205/205) |
| silent errors | 0 | **0** |
| false alarms/shot | 5.1 (2399) | **3.6 (1715)** |
| outcomes | 95.8% | 95.8% |

Per-field (A → B): effect1Level **91.9 → 96.2** · effect2Level **94.9 → 97.9** · orderLevel
**95.6 → 97.7** · willpowerLevel **96.0 → 98.5**. Every other field is byte-identical —
effect2 91.7 · effect1 93.0 · rerollsRemaining 97.4 · baseCost 97.6 · currentTurn 99.2 ·
gemType 99.4 · processCostMultiplier 99.8 · maxTurns 100.0 · outcomes 95.8. Field-level:
**61 fixed, 5 broken** (all five flagged, max conf 0.68). Level-field misses **102 → 46**;
boards carrying one **67 → 32**; per node W 38 → **18**, E 24 → **10**, S 21 → **11**,
N 19 → **7**. The joint classes are what moved: PERMUTATION 9 → **5**, COMPENSATING
14 → **6**, SINGLE 35 → 18, MULTI 9 → 3. False alarms by field: effect2Level 381 → **150**,
willpowerLevel 383 → **147**, effect1Level 369 → **200**, orderLevel 212 → **164**.

**Judged on WHOLE-PARSE, which is the metric that matches what the tool is for.** Going
from four wrong fields to three buys the user nothing — they are already checking
everything; going from one to zero is the whole difference between "review this parse" and
"press Get advice". The per-field average hides that, so here is the distribution.

| wrong fields on a board | 0 | 1 | 2 | 3 | 4+ |
|---|---|---|---|---|---|
| HEAD (A) | 331 | 71 | 35 | 25 | 10 |
| round 10 (B) | **356** | 64 | **26** | **19** | **7** |

(“0 wrong fields” is 331/356; the harness’s whole-parse count is 330/355 because one board,
`c-mrwsy5gx-96afo7`, has its outcome set masked out of scoring while still mismatching.)
The multi-error boards are what collapsed — 2-error −9, 3-error −6, 4+ −3 — which is exactly
what a joint reader should do and is the argument for the framing: a swap or a compensating
pair is **two** wrong fields on **one** board, so catching it converts a 2-error board
straight to 0 rather than shaving a field off a board that stays unusable.

**Boards within ONE fix of a perfect parse: 64** (was 71). By the sole remaining field:
**outcomes 28** · **effect2 12** · rerollsRemaining 6 · **effect1 6** · willpowerLevel 4 ·
orderLevel 3 · effect1Level 2 · effect2Level 1 · gemType 1 · currentTurn 1. The four level
fields together now account for **10** of the 64 (they accounted for 24 before this round);
the outcome strip and the two effect NAMES account for **46**. That is the target list, and
it is no longer levels.

**The unmeasured number, now measured: the CLEAN-BOARD rate — 0 wrong fields AND 0 flags —
is 1/472 (0.2%) at HEAD and 4/472 (0.8%) after this round.** A board that parses perfectly
and then raises five confirm-me flags still costs a full review, so this, not whole-parse, is
the true "trust it at a glance" number, and it is essentially zero. Flags per board
(wrong-flagged + false alarms):

| flags on a board | 0 | 1 | 2 | 3 | 4+ | total | per board |
|---|---|---|---|---|---|---|---|
| HEAD (A) | 1 | 13 | 27 | 16 | **415** | 2660 | 5.6 |
| round 10 (B) | 4 | 43 | 108 | 89 | **228** | **1920** | **4.1** |

Round 10 nearly halves the 4+-flag population (415 → 228) but barely moves the clean rate,
and the cross-tab says why in one line. **Of the 356 perfectly-parsed boards, `outcomes`
flags 347 of them (97%)** — it is a MIN over four tiles, so one soft tile silences the whole
set's confidence. After that come the two names (effect2 192, effect1 180) and only then the
levels, which this round cut from 271/269/266/125 to **133/102/86/82**. The ladder, measured
on perfect boards:

| if this family never flagged | clean boards (A) | clean boards (B) |
|---|---|---|
| nothing (today) | 1 (0.2%) | 4 (0.8%) |
| the four level fields | 5 (1.1%) | 5 (1.1%) |
| levels + outcomes | 67 (14.2%) | **74 (15.7%)** |
| levels + outcomes + names | 274 (58.1%) | **294 (62.3%)** |

The one number that moved a lot is **boards whose ONLY flags are `outcomes`: 12 → 40.**
Forty boards are now a single flagging *policy* change away from clean, and per-tile
flagging is that change — it needs no new evidence at all, only for `outcomes` to stop
being one confidence over four independent tiles.

Holdout vs in-sample (djb2%5==0; the tables were trained this round, so the split is fully
load-bearing): **holdout 95.6 → 96.7%** with whole-parse 63 → **68** and FA 467 → **346**;
in-sample 96.5 → 97.4% with whole 267 → **287** and FA 1932 → **1369**. The headline gain is
LARGER on holdout (+1.1 vs +0.9) and the FA cut is the same rate (−26% vs −29%). The solve
scored in isolation by the trainer: holdout **372/384 (96.9%)** against the per-node solve's
358 (93.2%), train 1470/1504 (97.7%) against 1428 (94.9%).

**Label fix (one, pixel-arbitrated):** `c-mrwzbdin-lh4dxl` orderLevel **1 → 4**. The wheel
crop at 6× reads "Willpower Efficiency 1", "Additional Damage Lv. 1", "Ally Damage Enh.
Lv. 1" and a plain gold **4** under "Order Points"; the header reads "**7** Astrogem
Points", and 1+1+1+4 = 7. The label's 1 made the board sum to 4, contradicting its own
header, and its `lower_effect order 1` outcome was the lint warning that vanished when the
level was corrected. Shared mode again — the collection-time engine also read 1, so the
promotion trust mask kept the default on a field the user never corrected. **Round 9's
supervised-refs experiment flagged this exact board as its one silent error and it was
counted against that experiment; it was the corpus that was wrong.** Lint: 480 labels,
0 errors, 4 warnings (was 5).

**RULED OUT, with numbers.**
- *Softmax over the raw correlation vectors* instead of trained confusion tables — the
  obvious first form of a joint reader, and the one that does not need training data. Fit
  the same way (temperatures and weights on the training split), it reaches node accuracy
  **95.4% all / 95.1% holdout** and 411 all-four boards, against the calibrated tables'
  **97.6 / 96.9** and 440. The reason is specific and is the whole argument for training:
  a softmax says a channel's top class is likely, and the W raw channel's top class is
  systematically the diamond FACE's best match. Only a measured P(observation | true) can
  say "raw voted 4 at W with a flat margin — that means almost nothing".
- *Leaving the seven channel weights at 1* (i.e. pure naive Bayes, no fit at all): overrides
  go 61 right / **5** wrong → 58 right / **15** wrong, holdout node accuracy 96.9 → 95.8%.
  The fit is small but not free.
- *Smoothing sweep*: alpha 1 → holdout 95.6%, 14 wrong overrides · **alpha 2 → 96.9%, 5** ·
  alpha 4 → 95.1%, 22 · alpha 8 → 95.1%, 26. Under-smoothing costs the rare cells,
  over-smoothing washes out the asymmetries that carry the signal.
- *A margin bar on the OVERRIDE* (only replace the per-node value when the joint reader is
  decisive): bar 0 is best. bar 1.5 → 44 fixed / 1 broken, bar 2 → 38 / 0, bar 3 → 28 / 0
  against bar 0's 61 / 5. Every bar sheds fixes faster than breaks, and since an override
  is flagged anyway a break costs one accuracy point rather than an invariant.
- *A lower bar for the CONFIDENCE lift*: margin ≥ 8 reclaims 1060 false alarms with **0**
  silents on this corpus and 0 on holdout, and margin ≥ 6 reclaims 1186 with **1** silent
  (`c-mrugq62n-zqc9al` east, 1≠5 at margin 6.2). Both were rejected for the safety factor,
  not for a measured failure: 8 leaves only 1.3× between the bar and the worst wrong node.
  If a later round wants the extra ~300 false alarms, the honest way to earn them is a
  bigger corpus under the same measurement, not a lower bar.
- *Extending the joint framing to the effect NAMES* — measured, not attempted, and the
  measurement says it would not pay. Of the 72 residual name misses only **2** are a pure
  W↔E swap, i.e. the shape a joint reader exists to catch; **31 sit at confidence < 0.30**,
  where both `structuralName` and `synthNameRescue` refuse and there is no observation to
  condition on. Names remain what round 9 called them: DATA-bound.
- *False alarms below 0.68*: untouched. The lift is deliberately confined to fields the
  blanket header caps had pushed down from a real read.

**The residual is now a resolution tier, and it says so numerically.** Of the 32 boards
still carrying a level miss, the split by the engine's own normalization factor is
native **10/143 (7.0%)** · ×2 **12/297 (4.0%)** · ×3+ **10/32 (31.3%)**. The most-upscaled
tier — the smallest original captures — is 5-8× denser in level misses than the rest of the
corpus and holds a third of what is left on 7% of the boards.

Gate: lint-labels 0 errors; **97.2% ≥ 95% · outcomes 95.8% ≥ 94% · silent 0 = 0 → PASS**
(`npm run eval-gate`, serial; the parallel harness reproduces it exactly — 355/472 whole,
205/205 flagged, 0 silents, 1715 FAs). Thresholds untouched: the headline now clears by 2.2
points and outcomes by 1.8, so the ladder has room for **0.97/0.95** at ship — but note that
0.97 is a claim about boards the engine has grown into, and both merges so far broke the
zero-silent invariant on first contact with fresh ones.

**NOT DONE (owner's call at ship time):** version pins in `index.html` were left alone as
instructed — `ocr/engine.js?v=54`, `ocr/layout.js?v=55`, `ocr/glyphs.js?v=55`,
`ocr/level-refs.js?v=4` and `ocr/structural-engine.js?v=97` all need a bump before this
deploys. **`ocr/level-model.js` is a NEW file** and had to be added to `LAZY_TABS.advisor`
(`index.html:86`, pinned `?v=1`) and to `bgWorkerUrls()`
(`ocr/structural-engine.js:4100`) or the browser and the parse worker would never load it;
that is the one pin this round wrote, and it is a new one, not a bump. `ocr/level-refs.js`
and `ocr/glyphs.js` are byte-identical to the shipped build.

- Next (iteration 13), ordered by what actually converts a board:
  1. **Per-tile flagging for the outcome strip — the largest single win left and it needs no
     new evidence.** `outcomes` confidence is a MIN over four tiles, so it flags 347 of the
     356 perfect boards and is the sole flag on 40 of them. Splitting it lets three verified
     tiles stay quiet while the fourth asks. On the accuracy side the same field is the sole
     remaining error on **28** of the 64 one-fix-from-perfect boards.
  2. **The two effect NAMES: effect2 39 and effect1 33 misses, 18 of the 64 one-fix boards,
     and 372 flags on perfect boards.** Measured above: the joint framing does not reach
     them (only 2 of 72 misses are a W↔E swap, 31 sit at confidence < 0.30 where both
     readers refuse). They are data-bound, exactly as round 9 said.
  3. **The trainer is the transferable result, not the level tables.**
     `tools/build-level-model.js` shows the corpus works as TRAINING data and that the
     holdout holds up; the outcome CELL is the natural next subject — its evidence dump
     already exists behind `OCR_CELL_EVID=1`, and a strip is four coupled tiles exactly as
     the wheel is four coupled nodes.
  4. The level residual is now demonstrably a capture-resolution population (×3+ tier is
     5-8× denser in misses): one larger screenshot from a small-monitor user is worth more
     than any further level rule.

---

# Round 12 (2026-07-29) — full workings: reclaiming false alarms

## The measurement that made the round possible

`ocr/structural-engine.js` gained CAP PROVENANCE per outcome tile, recorded only under
`OCR_CELL_EVID=1`: `_capDbg[oi] = {pre, syn, weak, rel, contra, imposs, sign, wit, strong,
had, up, down, aUp, aDown}` plus `capOv` on the `cellEvid` record. Six caps can bind a tile
and the shipped confidence is their MIN, so a flagged tile never said which rung it was
waiting on. With `pre` and the predicates recorded, a scratch script replays any subset of
the caps offline. Faithful on 1880 of 1888 tiles; the 8 misses are the two outcomes-masked
boards (`c-mrw4veza-rjv4k1`, `c-mrwsy5gx-96afo7`), where `tileConf` is empty by design.

Scratch files: `<scratch>/r12/{ph.js,worker.js,an-tiles.js,cf.js,cf2.js,cf3.js,cf4.js,jr.js}`.
`ph.js --lanes=8` runs the whole corpus in 97s; `jr.js` replays the joint level solve from
`lvEvid` and reproduces the shipped levels on 472/472 boards.

## Baseline anatomy (incumbent, 1880 tiles)

    tile flags 1214   wrong tiles 79   flagged-and-wrong 75   flagged-but-CORRECT 1139
    SILENT TILES 4    positional matches 1801 vs multiset 1803  (attribution is sound)

By type: raise 1284 (755 flags, 720 FA, 39 wrong, 4 silent) · lower 187 (168/166/2) ·
change_side 191 (117/107/10) · reroll 74 (74/72/2) · cost 81 (46/42/4) · do_nothing 63
(54/32/22).

By amount source: synth 363 (all flagged, 7 wrong) · none 515 (397/55) · tm-weak 258
(118/3) · bare+synth 114 (all flagged, 1 wrong) · tm 329 (113 flagged, 6 wrong, **all 4
silents**) · ocr 186 (63 flagged, 0 wrong) · synth-override 30 (all flagged, 0 wrong) ·
cap 73 (4 flagged) · bare 8 (all flagged, 4 wrong).

Counterfactual ceilings: all tile flags gone → CLEAN 44; all scalar flags gone → CLEAN 8.
Whole-parse boards by TILE flag count `0:8 · 1:63 · 2:102 · 3:124 · 4:58`; by SCALAR flag
count `0:44 · 1:104 · 2:76 · 3:34 · 4:40 · 5:29 · 6:19 · 7:1 · 8:3 · 10:5`.

Blocking classes on the 44 whole-parse/zero-scalar-flag boards (83 tile flags): 25 at
raw 0.78 (synth amount cap), 34 at raw 0.72 (order/willpower sign cap), 9 reroll at raw
0.80 pushed under by panelConf, 15 assorted.

## The four pre-existing SILENT TILES

    c-mrv2mntg-8t0145#1  0.824  raise effect1 1 (truth 2)  src=tm  cap "acditiona|damage|iv 2 a|"
    c-mrwao04t-olyi6t#0  0.822  raise effect2 1 (truth effect1 1) src=tm  cap "wv 1. a|"
    c-mrxczi6z-ara48b#3  0.832  raise effect1 1 (truth 2)  src=tm  cap "sranc poveer|(k% 7 a|"
    c-ms0lcj9n-snau3j#3  0.846  raise effect1 1 (truth 3)  src=tm  cap "atk. power|v.33 a|"

Identical signature: a HIGH-tier template commit (which SKIPS the synth consult entirely,
`amSy = (amtSrc !== "tm" && lnForSynth) ? ... : null`) reading the absorber digit '1'. The
caption spells the true digit on two of them ("iv 2", "v.33"); the third's caption is
unreadable and the fourth's error is the TARGET, which an amount witness cannot see.
Round 12 flags the first two. The remaining two are the honest residue.

## Witness 1 — the located line as a DIRECTION witness (component-wise)

Measured positionally against the labels, splitting the tile into its three components:

    order/willpower  strict-chartreuse -> raise   n=583  DIRECTION 582  target 580  amount 573  whole 570
    order/willpower  strict-red        -> lower   n= 87  DIRECTION  87  target  86  amount  87  whole  86
    effect1/effect2  strict-chartreuse -> raise   n=684  DIRECTION 684
    effect1/effect2  strict-red        -> lower   n= 95  DIRECTION  95

So the witness is 1449/1450 on DIRECTION and materially weaker on the whole tile — which is
exactly why round 9's unrestricted lift cost a silent. The single direction miss is
`c-ms1leu1v-fvexkp#3` at conf 0.30, far below any lift.

## Witness 2 — the caption as a second read of the AMOUNT

Four extractors measured over the 1468 raise/lower tiles with a parseable label:

    E1 shipped /(lv.|+)N/     fired 406   ==truth 402 (99.0%)   agrees 402 (right 402)   dissents  4 (catches 0)
    E2 v-anchored             fired 289   ==truth 286 (99.0%)   agrees 282 (right 282)   dissents  7 (catches 4)
    E3 v- or +-anchored, last fired 467   ==truth 462 (98.9%)   agrees 458 (right 458)   dissents  9 (catches 4)
    E4 last line, first digit fired 744   ==truth 643 (86.4%)   agrees 637 (right 637)   dissents107 (catches 8)

The nine E3 dissents, in full:

    2aa9a4b2…#0   commit 1 caption 4 TRUTH 1  FALSE  src=synth-override  "brand power|lv. 4a|"
    c-mrv2mntg#1  commit 1 caption 2 TRUTH 2  CATCH  src=tm              "acditiona|damage|iv 2 a|"
    c-mrwgh87c#2  commit 1 caption 3 TRUTH 3  CATCH  src=tm-weak         "poder de mara|nv. 3 a|"
    c-mrwifzcb#3  commit 1 caption 4 TRUTH 4  CATCH  src=tm              "ally attack enn.|iv.4 &|"
    c-mrwr7a1r#3  commit 3 caption 1 TRUTH 3  FALSE  src=ocr             "ywillpower|efficiency|+1 a|"
    c-mrx9avkw#0  commit 1 caption 4 TRUTH 1  FALSE  src=synth-override  "boss damage|lv 4&6|"
    c-mrxod11j#2  commit 3 caption 4 TRUTH 3  FALSE  src=bare            "branc poser|fv 4b|"
    c-ms0lcj9n#3  commit 1 caption 3 TRUTH 3  CATCH  src=tm              "atk. power|v.33 a|"
    c-ms15fny6#0  commit 1 caption 4 TRUTH 1  FALSE  src=tm-weak         "vd|oykut flopsaaxa|+ 4|"

Three conditions cut it to 4 catches / 1 false, each independently motivated: commit == 1
(the absorber class), src != synth-override (that rung already arbitrated OCR vs synth at
5× margin on measured evidence), and the Lv.-anchor only (the bare "+N" form is where the
solid ▲ reads as a '4'). The last condition also scopes the rule to effect targets, which
is the only place a "Lv. N" line renders.

## Policy sweep (offline, then confirmed in-engine)

    BASE                            CLEAN  4  ui 2674  tileFlags 1214  tileFA 1139  tileSILENT 4  gateSILENT 0
    A  caption dissent -> cap       CLEAN  4  ui 2676  tileFlags 1216  tileFA 1139  tileSILENT 2  gateSILENT 0
    B' sign lift, witness only      CLEAN  9  ui 2417  tileFlags  957  tileFA  884  tileSILENT 6  gateSILENT 1
    B  sign lift + trusted amount   CLEAN  8  ui 2516  tileFlags 1056  tileFA  981  tileSILENT 4  gateSILENT 1
    C  caption agree waives synth   CLEAN  4  ui 2638  tileFlags 1178  tileFA 1103  tileSILENT 4  gateSILENT 0
    A+B+C                           CLEAN  9  ui 2482  tileFlags 1022  tileFA  945  tileSILENT 2  gateSILENT 0
    synth cap off wholesale         CLEAN  7  ui  ---  tileFlags  878  tileFA  808  tileSILENT 9  gateSILENT ≥1
    every cap off                   CLEAN 32  ui  ---  tileFlags  350  tileFA  291  tileSILENT 20

Note B alone still shows `gateSILENT 1` despite lifting **zero** wrong tiles: it removes
cell 2's incidental cover on `c-ms0lcj9n-snau3j`, whose cell 3 was already silent. A must
ship with B. This is the concrete mechanism behind round 9's "every per-tile cap is
incidental cover for the other three".

## Witness 3 — the game's own rate table

`OUTCOME_RATES` excludes `change:+k` on a target at level ≥ 6−k, so a raise on a target the
wheel reads at level 4 can only be +1, and a lower needs level ≥ 2. Using the wheel level
(a different crop, a different reader) as the channel, and requiring that level to be
unflagged: **207 forced tiles, 207 right, 119 of them flagged today, 0 wrong.**

Separately, `engine.js:snapOutcome` snaps every lower to −1, so on a lower tile the read
amount never reaches the output at all — the `amtFromSynth` cap there guards a value the
model discards. Waiving it: 49 tiles, 0 wrong.

## Witness 4 — the reroll rung's two OCR passes

Every reroll rung is a disjunction (`gTxt` OR `cap`), commits at exactly 0.80 — the flag
threshold — and is then pushed under by the panelConf multiplier. All 74 corpus reroll
tiles are flagged and 72 are right. Requiring the dim-grey dilated pass and the plain
white-text pass to agree INDEPENDENTLY on both the word and the count: 45 tiles, 45 right.

## `JOINT_SURE` — the round-10 question, re-measured

`jr.js` replays `jointLevelSolve()` from `lvEvid` with the shipped `LEVEL_MODEL` tables and
reproduces the shipped levels on 472/472 boards. Over the 1817 joint-AGREED level fields:

    margin   [0,2) [2,4) [4,6) [6,8)   >=8
    right       32    50    82   129  1488
    WRONG       15    14     6     1     0

Every wrong field, by margin: 6.20 c-mrugq62n effect2Level · 5.26 c-mrw5h45e willpowerLevel ·
5.11 c-mrwip7q5 effect1Level · 5.11 c-mrwip7q5 orderLevel · 5.08 c-mrugq62n effect1Level ·
4.71 c-mrxd1quv willpowerLevel [holdout] · 4.19 c-mrw6hugm willpowerLevel · 3.92 c-mrw8gmxg
effect1Level [holdout] · then 28 more below 3.6. Holdout maximum 4.71; the five highest are
all training boards.

Sweep of additional fields lifted (agreed, currently flagged): 4 → 526 (7 wrong) ·
5 → 484 (5) · 6 → 440 (1) · 7 → 382 (0) · 8 → 313 (0) · 9 → 241 (0) · 10 → 183 (0) ·
11 → 99 (0) · 12 → 18 (0). CLEAN by bar with the tile package: 12 → 13, 11 → 15, 10 → 15,
9 → 15, 8 → 16, 7 → 16. Shipped at 10.

## Result

                        incumbent      round 12
    CLEAN boards        4/472 (0.8%)   18/472 (3.8%)
    UI flags            2674 (5.7/sh)  2221 (4.7/sh)
      tiles             1214            922
      scalars           1460           1299
    flags on CORRECT    2450           1995
    SILENT TILES        4              2
    whole-parse         355/472        355/472
    headline            97.2%          97.2%
    flag coverage       100%           100%
    gate silents        0              0

455 of the 2450 false alarms reclaimed (18.6%), no value changed, two silent tiles removed.


# ===== Round 12 (moved out of the working log by round 13) =====

## Round 12 — reclaiming false alarms with independent witnesses

The measurement first. `structural-engine.js` now records **cap provenance** per outcome
tile under `OCR_CELL_EVID=1` (the pre-cap score plus which of the six caps fired), and a
scratch counterfactual replays every tile's confidence from that record — faithful on
1880 of 1888 tiles, the 8 misses being two outcomes-masked boards. Candidate policies were
scored offline before a line of engine code changed.

What that exposed:

- **Tiles are the gate on CLEAN, not scalars.** If every tile flag vanished CLEAN goes
  4 → 44; if every scalar flag vanished, 4 → 8. Forty-four whole-parse boards already had
  zero scalar flags; only eight had zero tile flags.
- **Four SILENT TILES already existed** (wrong yet ≥0.8). The gate cannot see them because
  it scores `outcomes` as a MIN over four tiles, so another tile's cap is incidental cover.
  At the granularity the window renders, they are confident bad advice. All four were
  `src=tm` template commits of amount **1** — the documented absorber class.
- Positional tile↔label alignment is exact (1801 positional vs 1803 multiset of 1880), so
  a miss can be attributed to a tile.

**Two independent witnesses, measured against labels over all 1880 cells.**

1. **Direction** — the strict located amount line's colour, which comes from the line
   locator rather than from clustering inside the arrow box. chartreuse ⇒ raise 582/583
   (order/willpower) and 684/684 (effects); red ⇒ lower 87/87 and 95/95. **1449 of 1450.**
2. **Amount** — the caption strip re-lexed on its own crop, mask and OCR call. Where it
   agrees with the committed amount it is right **458/458**; where it dissents, 9 tiles,
   4 of them a real error including two of the four silent tiles.

**What shipped** (all in `ocr/structural-engine.js`):

| # | change | effect |
|---|---|---|
| A | caption dissent (Lv.-anchored, against a committed `1`, not a synth-override) caps the tile | silent tiles 4 → 2 |
| B | the sign cap lifts when the located line witnesses the direction AND the amount came from a trusted rung (tm/ocr/cap) | +158 tiles |
| C | caption agreement waives the synth amount cap | +36 tiles |
| D | the synth amount cap does not apply to a LOWER — `engine.js` snaps every lower to −1, so the cap guards a value the model discards | +49 tiles |
| E | …nor to a RAISE whose target the wheel reads (unflagged) at level 4: OUTCOME_RATES excludes +2/+3/+4 there, so the amount is forced to 1 | +16 tiles |
| F | a reroll tile whose grey and white OCR passes independently agree on both the word and the count scores 0.9 instead of 0.8 | +45 tiles |
| G | `JOINT_SURE` 12 → 10 | +161 level fields |

A is a tightening: it can only lower a confidence. B-F change no value at all, only whether
a tile asks to be confirmed, and each was measured to lift **zero wrong tiles**. A waiver is
not structurally safe the way round 10's overrides were — a tile can be wrong for a reason
its witness does not cover, which is exactly how the unrestricted version of B cost two —
so every one of them is scoped to what its witness actually measures.

**`JOINT_SURE` re-measured** (the round-10 question). An offline replay of the shipped
joint solve from `lvEvid` is faithful (0/472 mismatches). Margin distribution over the
1817 joint-AGREED level fields:

| margin | [0,2) | [2,4) | [4,6) | [6,8) | ≥8 |
|---|---|---|---|---|---|
| right | 32 | 50 | 82 | 129 | 1488 |
| **WRONG** | **15** | **14** | **6** | **1** | **0** |

The 6.20 outlier is `c-mrugq62n`'s east node and it stands alone — the next wrong field is
at 5.26, only 7 of 36 clear 4, nothing clears 6.2, and on HOLDOUT boards the worst is 4.71.
Extra fields lifted per bar, all currently flagged and all right: 7 → 382, 8 → 313,
9 → 241, **10 → 183**, 11 → 99, 12 → 18. Bar 6 is the first that touches a wrong field.
Shipped at 10: 1.6× the corpus maximum, 2.1× the holdout maximum. **8 is available at
1.29× and was not taken** — the primary objective barely moves (CLEAN 18 → 19) and a
calibrated log-likelihood ratio is optimistic about its own tails.

## Round 13 — the last two silent tiles, and the synth cap's fourth witness

Both silent-tile labels were VERIFIED against pixels at 4× before anything was built —
both are RIGHT. `c-mrwao04t-olyi6t#0` is "Atk. Power / Lv. 1 ▲" (effect1; the engine said
effect2). `c-mrxczi6z-ara48b#3` is "Brand Power / Lv. 2 ▲" (amount 2; the engine said 1).

**What shipped** (all in `ocr/structural-engine.js` unless noted):

| # | change | effect |
|---|---|---|
| A | the synth consult now runs after a TRUSTED `tm` template commit too; when it commits a DIFFERENT digit the tile takes that digit (`src=tm-contra`) and is capped at 0.72 | 5 tiles fixed, silent tile `ara48b#3` gone |
| B | the icon face RE-LOCATED: walk the median patch ±0.30·gap, take the most saturated face, and cap the tile at 0.72 when it names another node | silent tile `wao04t#0` gone |
| C | the synth amount cap is waived when the synthesis rests on TWO channels — raw+gradient naming the same digit, or the `bare+synth` rung (a bare OCR digit and the gradient top agreeing) | +137 tiles |
| D | the same two-channel predicate joins round 12's `trustedAmt`, so the sign cap's direction-witness waiver reaches synth-sourced amounts | +54 tiles |
| E | `tools/eval-ocr.js`: SILENT TILES is now a gate FAIL condition, like the field-level one | invariant locked |

**A — the consult was switched off exactly where it was needed.** `synthAmountDigit` was
skipped whenever the glyph atlas committed at the 0.95 tier (`amtSrc !== "tm"`), which left
the template as the ONLY reader of its own line. `ara48b#3` is what that costs: a template
'1' over a caption that OCRs to `sranc poveer|(k% 7`, so round 12's caption channel had
nothing to dissent with and a wrong tile shipped at 0.83. Consulting anyway is behaviour-
neutral by construction (the override branch keeps its `amtSrc !== "tm"` guard, and a
record-only run reproduced round 12 to the board: 18 CLEAN / 2221 flags / 355 whole-parse).
Measured over 329 `tm` tiles: the consult commits a different value on **5, and the template
is wrong on all 5** — 2, 4, 2, 3, 3 against a template '1' every time, the documented
absorber. It never contradicts a template that was right. On confident tiles it fires once.
No new threshold: "the consult committed" is its own calibrated gate. Taking the value AND
capping is what makes it safe in both directions — the tile is flagged either way, so this
can only move a doubtful tile, never mint a confident wrong one.

**B — the target had no witness at all.** effect1-vs-effect2 comes from ONE 13×13 median
patch at `cx ± {1.39,0.47}·gap`. Where the real outcome-row pitch is a few percent wider
that point slides off the diamond and medians the BACKGROUND: `wao04t#0`'s patch is
(40,50,60) → h 210 → "blue" → effect2, at 4° from the east node, on a plainly green
Atk. Power diamond. The walk keeps the most saturated face (s ≥ 0.50) and speaks only when
it lands within 20° of one node hue with the runner-up 25° further out. Over the 1828
tiles an offline probe could reproduce the geometry for:
**7 dissents, the engine's target wrong on 5**, and on currently-confident tiles it fires
exactly once — the silent tile. Zero false alarms. Dissent only: the walk can reach a
neighbour's diamond when the true face is dim, so it may cap but never set a target.

**C/D — the fourth witness the synth amount cap needed is the synthesis' own raw channel.**
`synthAmountDigit` scores each candidate twice, a z-normed cosine on the patch and one on
its gradient; the cap exists because the gradient is allowed to commit ALONE (the raw
channel votes background over an outcome cell, which is why the engine trusts it
asymmetrically). Of the 413 flagged tiles the cap held down, **137 have both channels
naming the committed digit and all 137 are right**; every one of the 9 wrong tiles in the
population is gradient-only — and 6 of those 9 are a wrong TARGET, for which this cap was
only incidental cover (B now flags them on their own evidence). The `bare+synth` rung is
the same shape across a different pair — a bare OCR digit and the gradient top agreeing,
whose own comment already says "either alone is a trap, together usable": 98 flagged tiles,
1 wrong, and that one is a target error B catches. Feeding the same predicate into round
12's `trustedAmt` was measured first at 57 tiles / 0 wrong; loosening it to ANY synth source
is 159 tiles and 2 wrong (both a willpower face read as order — a target the amount evidence
cannot speak for), so it stays scoped.

Per-arm tile deltas, measured: C lifted 70 tiles / 0 wrong / 0 dropped, D 54 / 0 / 0,
C-for-`bare+synth` 67 / 0 / 0. No tile changed value except A's five.

**Cost.** A adds ~0.7 `synthAmountDigit` calls per board (the exemplar pool is cached per
scale band) and B adds 124 median patches of 13×13. Whole-corpus wall time on the parallel
harness: 97s → 107s, about +10% on a parse that already spends 1.5-2.7s in OCR.

## Round 12 — RULED OUT (moved from the working log, round 14)

Ruled out in **round 12**, all measured per tile:

- The direction witness on its **own** (round 9's shape): 257 tiles, **2 wrong**, silent
  tiles 4 → 6. Both were `tm-weak` amounts whose direction was right and whose digit was
  not — the witness speaks about direction only. Restricted to trusted amount rungs it is
  158 tiles and 0 wrong, and that is what shipped. (Round 9's "35 FAs for 1 silent" was a
  MIN-over-tiles artefact; the silent it found was a pre-existing silent TILE on another
  cell, now flagged on its own evidence by the caption-dissent rule.)
- Waiving the synth amount cap **wholesale**: 336 tiles, 5 wrong, silent tiles 4 → 9.
- Dropping the `panelConf` multiplier from outcome tiles: 80 tiles, 1 wrong. Worth noting
  that panelConf is 0.95-1.00 on 451 of 470 boards, so it is close to a flat 5% haircut
  and it is what pushes rungs written at exactly 0.80 under the line — but the reroll
  two-channel corroborator recovers the same CLEAN boards with evidence, so this was not
  taken.
- The looser caption-amount extractor (`+N` as well as `Lv. N`) as a dissent channel:
  4 catches for 5 false dissents, three of them a solid ▲ read as '4' behind a bare '+'.
  The `Lv.`-anchored form is 4 catches for 1.
- `change_side_option`'s structural rung (81 tiles at 0.62) is 72/81 = 89% pure and
  `do_nothing`'s 0.2 rung is 31/53 = 58%. Both are flagged for a real reason; leave them.
