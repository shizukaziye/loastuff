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
