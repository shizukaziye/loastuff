# Advisor OCR accuracy campaign — current state

Read this file, not the archive. Full per-round workings live in `ACCURACY-LOG-ARCHIVE.md`
(100KB+; reading it end to end has stalled agents — open it only for a specific round).

## The objective (corrected 2026-07-29 by the user — this supersedes the old goal)

The user's value function is **not linear in error count**. Going from 4 wrong fields to 3
is worth little (they are already reviewing everything). Going from **1 to 0 is decisive** —
it converts "I must check this parse" into "I can press Get advice."

A **flag costs the same as a wrong field**: a review. So a board that parses perfectly but
raises five flags is still untrustworthy.

Rank objectives in this order:
1. **Clean-board rate** — boards with 0 wrong fields AND 0 flags. The real "trust it at a
   glance" number. **Currently 136/472 = 28.8%** (it was 25/472 when this was written).
2. **Whole-parse rate** — boards with 0 wrong fields. **Currently 381/472 = 80.7%.**
3. Per-field average (97.7%) — the metric that HIDES the above. Report it last.

Prefer a fix that clears a board's last error over one that shaves the average.

## Hard invariant

**Zero silent errors** (a wrong field that does not flag → bad advice reaches the user with
no warning). Machine-enforced: `tools/eval-ocr.js` fails the gate on any silent. Never trade
it for headline points. Every corpus expansion so far has broken it on first contact with
unseen boards — that is what expansions are for.

The gate measures this at FIELD granularity, where `outcomes` collapses to one field at the
MIN of four tiles. The window flags tiles one by one, so a wrong tile that does not flag is
a silent error the FIELD test cannot see: it was 4 such tiles at the start of round 12 and
2 at the end. Round 13 cleared both, so **SILENT TILES is now a gate FAIL condition too**
(`tools/eval-ocr.js`) and the invariant holds at the granularity the window renders.

## Where things stand (round 15 shipped)

Both arms measured in one session against the same labels, on the same parallel harness:
the incumbent from a worktree at unmodified HEAD with `samples/` symlinked, the candidate
from the working tree. Two labels changed this round (both disproved by pixel crops, see
round 15) and BOTH arms were re-run against them. The serial `npm run eval-gate` agrees
with the parallel harness on every headline number.

| metric | incumbent (r14) | **round 15** |
|---|---|---|
| **CLEAN boards** (0 wrong, 0 flags) | 47/472 (10.0%) | **136/472 (28.8%)** |
| UI flags (12 scalars + up to 4 tiles) | 1687 (3.6/shot) | **1276 (2.7/shot)** |
| …of which outcome tiles | 733 | **322** |
| …of which scalar fields | 954 | 954 |
| UI flags sitting on CORRECT cells | 1165 | **981** |
| **SILENT fields** | 0 | **0** |
| **SILENT TILES** (wrong yet ≥0.8) | 0 | **0** |
| wrong TILES (of 1880) | 71 | **61** |
| whole-parse | 376/472 (79.7%) | **381/472 (80.7%)** |
| headline per-field | 97.6% | **97.7%** |
| outcomes | 96.2% | **96.7%** |
| flag coverage | 175/175 | 167/167 |
| gate 0.97/0.95 + zero silents + zero silent TILES | PASS | PASS |

**Holdout, reported separately** (the 96 boards `djb2%5==0`, which no trained artefact has
seen): CLEAN 12 → **32** (12.5% → 33.3%), flags 342 → **257**, tile flags 148 → **63**,
whole-parse 75 → 75, outcomes 95.6 → **95.8**, silents 0/0. In-sample (376): CLEAN 35 →
**104**, flags 1345 → **1019**, tile flags 585 → **259**, whole-parse 301 → **306**.
The tile-flag reclamation is the same fraction on both sides — 57% held out, 56% in
sample — which is what says the tables generalise. The whole-parse gain does NOT: it is
9 fixed tiles in sample against 1 on the holdout (see the override, below).

flags/board — incumbent `0:47 · 1:91 · 2:77 · 3:61 · 4:43 · 5:41 · 6:29 · 7:30 · 8+:73`
round 15 &nbsp;&nbsp;`0:136 · 1:87 · 2:53 · 3:45 · 4:44 · 5:25 · 6:24 · 7:20 · 8+:38`

Per-field (unchanged — nothing this round touched a scalar): maxTurns 100 ·
processCostMultiplier 99.8 · gemType 99.4 · currentTurn 99.2 · willpowerLevel 98.5 ·
effect2Level 97.9 · orderLevel 97.7 · baseCost 97.6 · rerollsRemaining 97.4 ·
effect1Level 96.2 · outcomes **96.7** · effect1 95.3 · effect2 94.1.

Arc: headline 89.9 → 97.7, whole-parse 19.6 → 80.7, silents 43 → 0, silent TILES 4 → 0,
CLEAN 0.8 → **28.8%**.

## Round 12 — reclaiming false alarms with independent witnesses

Moved to the archive (search it for "Round 12"). The short version, because round 13 builds
on it: `structural-engine.js` records **cap provenance** per outcome tile under
`OCR_CELL_EVID=1`, an offline replay scores candidate policies before any engine code
changes, and the two witnesses it found — the located amount line's colour as a DIRECTION
witness (1449 of 1450 against labels) and the caption strip re-lexed as an AMOUNT witness
(458/458 where it agrees) — are what the caps below are waived against. `JOINT_SURE` was
re-measured and shipped at 10 (1.6× the corpus maximum margin on a wrong field); 8 was
available at 1.29× and deliberately not taken.

## Round 13 — the last two silent tiles, and the synth cap's fourth witness

Full workings in the archive (search "Round 13"). Both silent-tile labels were verified
against pixels first and both were RIGHT. What shipped, all in `structural-engine.js`:
the synth consult now runs after a TRUSTED `tm` template commit too and takes its digit
when it dissents (5 tiles fixed, 5 for 5 against a wrong template); the icon face is
RE-LOCATED by walking the median patch for the most saturated face, and dissents only
(7 dissents, engine wrong on 5, zero false alarms); the synth amount cap is waived when
raw+gradient or bare+synth name the same digit (137 tiles, 137 right) and the same
predicate joins round 12's `trustedAmt`. `tools/eval-ocr.js` gained SILENT TILES as a
gate FAIL condition.

## Round 14 — the names, read as one hypothesis

Moved to the archive (search it for "Round 14"). The short version: `tools/build-name-model.js`
→ `ocr/name-model.js`, a 12-way joint solve over the two effect names with trained
likelihoods, overrides at 0.66 and an AGREEMENT lift at `NAME_SURE = 12` (1.66x the worst
wrong margin). Names went 93.0/91.7 → 95.3/94.1, scalar flags 1299 → 954, CLEAN 25 → 47.
Round 10's finding that joint framing "does not work for the names" was about SWAPS; it
did not survive trained tables.

## Round 15 — the four tiles, read as one hypothesis

Round 10's move applied to the field two rounds of hand-written witnesses had left at 733
flags. A tile is a better fit than the levels or the names, because its vocabulary is not
merely closed — **it is enumerated by the game**. `model/astrogem.js` OUTCOME_RATES lists
exactly 27 keys, gives each a base probability and says which of them the current
levels/turns exclude. Measured before anything was built: of the 1828 scored tiles in the
corpus **exactly one label falls outside the legal set**, and pixels say that label was the
error. So a tile is a ~20-way choice under a known prior, and the ladder decides it in three
passes — target from the icon hue, kind from the caption and the located line, amount from
whichever of six digit channels spoke first — that never see each other's evidence.

**What shipped**

| # | change | effect |
|---|---|---|
| A | every channel the cell ladder consults is now recorded per tile under `out._debug.tileEvid`, unconditionally | the trained solve and `tools/build-tile-model.js` read the SAME record, so they cannot drift |
| B | `tools/collect-tile-evid.js` → the JSONL cache; `tools/build-tile-model.js` → `ocr/tile-model.js` (9.7 KB) | the reader |
| C | `tileSolve()` in `structural-engine.js`: 27-key enumeration × 4 tiles, joint, with a duplicate penalty | overrides commit at 0.72 (flagged) |
| D | AGREEMENT lift at `TILE_SURE = 9` | **411 flagged tiles reclaimed, every one right** (85 on the holdout) |
| E | the legality mask reads `out.state.turnsRemaining`, not a `currentTurn` that only exists after `constraintSnap` | a real bug the mirror check caught; 1 tile |

**The model.** Five class variables per key — kind / target / amount / cost-sign /
reroll-count — and 17 observation channels plus 3 that encode the engine's own committed
read bucketed by its confidence. Every channel is scored against every candidate, so the
comparison is a like-for-like likelihood and not a count of terms. Weights are per channel,
fitted by coordinate ascent on the 375 non-holdout boards; the prior is OUTCOME_RATES
renormalised over the legal set, and a level bound is applied only when that level is itself
unflagged (round 14's discipline).

**The model does NOT read better, and that is the point.** 5-fold CV inside the training
split: model 1446/1500, engine 1447/1500. Holdout 363/380 vs 362/380. What it adds is a
CALIBRATED margin over the ladder's own reads — the engine's 733 flagged tiles were 90%
right and it had no way to say which 90%.

**The lexical witness is the whole result.** A lift can mint a silent tile, so it carries a
second condition beyond agreement: a TEXT channel — the caption OCR or the dim-grey dilated
pass — must name the same key's target or kind. Every other channel here (icon hue,
relocated face, located line, arrow blob, template, both synth rankings) reads the same
rendered pixels through a colour mask, and they fail together. Measured over the flagged
tiles the solve agrees with:

| gate | population | wrong in it | worst wrong margin | 1.6× bar | lifts |
|---|---|---|---|---|---|
| none | 697 | 40 | 20.06 | 32.1 | 34 |
| lexical witness | 440 | **3** | **5.56** | 8.9 | **411, 0 wrong** |

`TILE_SURE = 9` is 1.62× — the factor rounds 12 and 14 shipped `JOINT_SURE` and `NAME_SURE`
at. The three wrong tiles inside the gate sit at 5.56, 4.82 and 1.77, i.e. all three are in
the bottom 29 of the 441 by margin; under a null where the margin does not rank errors that
is P ≈ 2.6e-4. Both of the >10-margin wrongs the witness removes are non-English captures,
which is the mechanism said out loud: no caption, no second family of evidence.

**The override, gated the same way.** Where the solve disagrees it takes the key only if the
witness names the SOLVE's key, and caps the tile at 0.72 — below the flag line, so it can
never mint a silent. Shipped: **11 disagreements, 10 fixes, 0 breaks** (10 in sample, 1 on
the holdout; the eleventh was already wrong both ways). Ungated it is 36 disagreements for 22 fixes and 5 breaks; that version was
declined, and its holdout record — 2 fixes, 1 break, 2 both-wrong — is why.
Wrong tiles overall: 71 → **61**.

**Honesty checks.** With `ocr/tile-model.js` removed the working tree reproduces the
incumbent **to the board**: CLEAN 47, 1687 flags (733 tiles, 954 scalars), whole-parse 376,
97.6%, 1165 flags on correct cells — identical to the HEAD worktree. Re-training on a cache
collected AFTER the solve ships reproduces the tables byte for byte (the engine channel is
taken from `tileEvid[i].o`, which is written inside `readOutcomeCell` and so cannot see the
solve's own overrides). And the offline trainer's solve and the engine's `tileSolve` agree
on **1880 of 1880 tiles, key and confidence** — the first pass of that check found 1
mismatch and it was change E, a real bug.

**Labels verified against pixels** (`scratchpad/crop-tiles.js`, 3× crops). Two were WRONG
and were fixed; four were RIGHT and the engine is wrong on them.
- `c-mrw7jp61-dyhlfs#2` was `raise effect2 4`; the tile renders "Additional Damage / Lv. 1 ▲".
  It was also the single label OUTCOME_RATES excludes (effect2 at level 2 admits at most +3).
- `c-mrwstng4-kgk3ib#0` was `cost +100`; the tile renders "Processing Cost −100%", and the
  dim-grey pass reads it literally as `cessing cost|-100%`.
- Right, engine wrong: `c-mrxoe1au-ixrhbp#3` ("+100%" read as −100%), `c-mrw7nme7-cd4nfz#0`
  ("Order Points +2" read as +3), `c-mrw7kdtl-taqai2#0` (ES, a red "voluntad: +1" read as
  order), `c-mrxg5t94-dvelwi#3` (RU, "3 ур." read as 2).

**Cost.** The solve is 27 keys × 4 tiles of table lookups plus a 8⁴ enumeration — no pixels,
no OCR. Whole-corpus wall time on the parallel harness 108s → 108s; unmeasurable.

**DEPLOY NOTE — one line this round did not touch.** `ocr/tile-model.js` is a new file. The
background parse worker already loads it (`engineScriptUrls` in `structural-engine.js`), but
the main-thread inline fallback loads its stack from `LAZY_TABS.advisor` in `index.html`,
which needs `"ocr/tile-model.js?v=1"` inserted **before** `"ocr/structural-engine.js"` —
along with the usual `?v=` bumps. Without it the fallback path degrades silently to the
round-14 reader (TMODEL null ⇒ no solve, every tile keeps its round-14 confidence), which is
safe but is not the build measured above.

## What is left

**The tiles are no longer the biggest pot — the scalars are.** 981 of the 1276 remaining
flags (77%) sit on correct cells; the ceiling for CLEAN is the whole-parse rate, 381/472.

| | CLEAN if… |
|---|---|
| every SCALAR flag went away | 136 → **256** |
| every TILE flag went away | 136 → 174 |
| both NAMES never flagged again | 136 → 160 |

**83 whole-parse boards are ONE flag from clean**, and the split has inverted: 30 are a
tile, 53 are a scalar — `rerollsRemaining` 20, `effect1` 11, `effect2` 11, `effect1Level` 9,
`orderLevel` 1, `willpowerLevel` 1.

Scalar flags by field, with the wrong count: effect1Level 182 (18 wrong) · orderLevel 149
(11) · effect2Level 118 (10) · effect2 109 (28) · willpowerLevel 97 (7) · rerollsRemaining
91 (12) · effect1 83 (22) · baseCost 35 (11) · gemType 27 (3) · currentTurn 26 (4) ·
**maxTurns 26 (0 wrong)** · processCostMultiplier 11 (1).

`maxTurns` is 100.0% accurate corpus-wide and still raises 26 flags — 26 pure false alarms
on a field that has never once been wrong. `rerollsRemaining` is 91 flags for 12 errors and
is 20 of the 83 one-flag boards. Those two are the cheapest ground left.

Flagged scalars by confidence band, right/total: `<0.30` 98/149 · `0.30-0.50` 102/131 ·
`0.50-0.60` 296/334 · `0.60-0.68` 60/64 · `0.68-0.75` 150/154 · `0.75-0.80` 121/122.

**The residual TILE flags, by why the solve did not lift them** (322 total): 257 have no
lexical witness (85.6% right), 29 are below `TILE_SURE` (89.7%), 25 are a disagreement the
witness refused (and the engine is right on only 5 of those 25), 11 are the overrides
themselves. The honest floor is now explicit and it is a caption-legibility floor: on a tile
whose caption OCRs to nothing, every remaining channel is the same family of pixels.

`do_nothing` remains the worst rung: 21 of the surviving no-witness flags are `do_nothing`
and only 3 are right. That is the class round 14 predicted would be the floor, and it is.

**The lead for round 16, and an honest note on where the campaign is.** Three fields now
have trained tables and the tile round was the last big structural pot; CLEAN has gone
0.8% → 28.8% and the remaining flags are 77% false alarms spread thin. The two cheapest
targets are both narrow: `maxTurns`, which is 100.0% accurate and still flags 26 boards,
and `rerollsRemaining`, 91 flags for 12 errors and 20 of the 83 one-flag-from-clean boards.
Together they are worth roughly +40 CLEAN and neither needs a model — they need the same
question round 12 asked of the tiles, "what is this cap waiting on and is it already
corroborated". After that the honest ceiling is the residual TILE floor above (a caption
that OCRs to nothing) plus the scalar reads themselves, and the campaign is maintenance:
run the gate on corpus expansions and keep the two silent counts at zero.

## RULED OUT — do not re-litigate without new evidence

Ruled out in **round 15**, all measured per tile:

- **The whole-key margin WITHOUT a lexical witness.** The population is 697 flagged tiles
  the solve agrees with, 40 of them wrong, and the worst wrong reaches margin 20.06; the
  1.6× bar is then 32.1 and lifts 34. The witness is not a refinement of the lift, it IS
  the lift.
- **Per-CAP waivers on per-ASPECT margins** (waive the 0.78 synth cap on the amount margin,
  the sign cap on the kind margin, the capOverride/faceDissent caps on the target margin).
  It sounds right — a cap doubts one aspect, so corroborate that aspect — and it does not
  work: the amount caps leave 3 wrong tiles at EVERY `mA` bar, because the aspect margin
  does not separate them. The whole-key margin does. Best variant: 184 lifts against 411.
- **Fitting the weights to ACCURACY instead of calibration.** Same tables, same channels:
  the worst wrong agreement goes from 5.56 to 11.99 and the 1.6× bar collapses from 411
  lifts to 19. A model that reads marginally better and ranks its errors worse is worth
  less than nothing here. (A log-loss fit with the engine channels dropped: 115 lifts.)
- **Fuzzy WORD HITS on the caption as an extra witness clause.** Built to reach the 257
  no-witness flags, including captions a person can plainly resolve ("aaditiona damage",
  "cpacg poin:", "g paints"). It works, on its face: 459 lifts instead of 411, still 0
  wrong, the 5.56 safety bar untouched. DECLINED on the significance. The population it
  draws from — flagged, solve agrees, margin ≥ 9, strict witness silent — is 198 tiles and
  5.1% wrong; the fuzzy witness picks 48 and gets 0 wrong, which under the null that it
  carries no information is P = 0.083. That is round 13's declined 27-of-27 in a bigger
  coat, and the cost of being wrong is a silent tile on the next corpus expansion. As a
  MODEL channel it is worth nothing at all — it displaces `capt` (fitted weight 0) and
  leaves accuracy flat, 1464/1500 train and 363/380 holdout against 1463 and 363.
  Reproducible: `whObs()` in `tools/build-tile-model.js`, kept and documented.
- **Distinctness as a hard constraint.** 3 of the 457 scored boards genuinely repeat a tile
  key, so it is priced (`wDup`, fitted to −6) rather than forbidden.

Ruled out in **round 14**, all measured per name slot (full text in the archive):

- **The name band's INK EXTENT as a channel.** Built to separate the pair that sets the
  safety bar and it does not — Attack Power's median extent (0.737) is WIDER than Brand
  Power's (0.715). Added to the model it loses: CV 695 vs 699, holdout 178 vs 180.
  Reproducible: `nameMask()` records the extent under `OCR_NAME_EVID=1`.
- **The strip's caption votes as a model channel.** Worth 0 slots, and architecturally
  wrong: the strip resolves its own target THROUGH the committed names.
- **`NAME_SURE` below 12.** 8 is 1.11× the worst wrong margin and 10 is 1.39×; both were
  available and both declined. The 124 slots between 8 and 12 are the price of the factor.

Ruled out in **round 13**, all measured per tile:

- **A naive window-vote icon witness** (count pixels near each of the four node hues over
  the whole tile box, take the winner): 170 dissents, **84 of them on CONFIDENT tiles for
  1 catch**. The tan/gold texture behind the outcome strip votes "order" — one board reads
  order 2305 to 186 on a tile whose face is blue. The saturation-PEAK relocation is the
  version that works; the difference is finding the diamond rather than averaging over it.
- **"An illegible caption ⇒ cap a `tm`/amount-1 effect raise."** 58 newly flagged tiles for
  the same 1 catch; that class is 58/59 = 98.3% right, so the caption's silence is not
  evidence of anything. Superseded by the consult (5 for 5).
- **Unanchored caption-digit agreement as a synth-cap waiver** (accept a bare digit, not
  just `Lv. N`/`+N`): 27 tiles, 0 wrong, +2 CLEAN — and DECLINED. Under the null that a
  loose digit match carries no information, P(0 wrong among 27) ≈ 0.4, so 0/27 is not
  evidence; the two-channel waiver that shipped is 137/137 with a mechanism behind it.
  A channel that could be luck is not worth 2 boards when the cost of being wrong is a
  silent tile on the next corpus expansion.
- **Extending the sign cap's direction-witness waiver to ANY synth amount**: 159 tiles,
  2 wrong (both a willpower face read as order). Scoped to two-channel it is 57 and 0.
- **Waiving the synth amount cap wholesale** (re-measured after C/D): 222 tiles still held,
  9 wrong, and lifting them all would take CLEAN 25 → 35 while minting 9 wrong-and-confident
  tiles. Every one of the 9 is a gradient-only synthesis.

Seven independent channels into the west/east level block, each closed by measurement:

| # | round | channel | why it failed |
|---|---|---|---|
| 1 | 4 | ink geometry as a 1-vs-not verifier | offline 92% catch / 17% misfire; in-engine found a usable digit on only 210 of 545 consults |
| 2 | 5 | "Lv. N" line-width channel | 97.6% precision offline, worth exactly 0 against labels (0 fixes, 2 breaks); 22 of 34 misses have no located line at all |
| 3 | 6 | checksum recovery on the last 40 header-less boards | header is legible on all 40, but a board without a checksum is one whose nodes already refuse — a correct sum turns 1 wrong field into 2 |
| 4 | 7 | pigment separation | the ink is chartreuse over a green face; the gold-text hue band holds 0-25px of 14,400 on 8 of the boards |
| 5 | 8 | reference re-harvesting | +60 sources, measured WORSE than the shipped file on 4 full runs; not shipped |
| 6 | 9 | supervised exemplar selection | goes negative at the engine's real budget; scoring one rung in isolation optimises the wrong thing (its refusals are load-bearing) |
| 7 | 10 | joint framing for the NAMES | only 2 of 72 name misses are a W↔E swap; 31 sit at conf <0.30 with no observation to condition on. **SUPERSEDED by round 14**: that was a finding about SWAPS. Trained likelihoods over the same 12-way enumeration took the names from 93.0/91.7 to 95.3/94.1 |

Also ruled out: un-pinning synth nodes when a checksum exists (7 better / 5 worse, flat);
bounds-defying header OCR (orderLevel −1.0); single-predicate cost digit count (371/5/4 vs
369/0/11); softmax over raw correlations and unfitted naive-Bayes weights for the joint
model. "Caption-name evidence below 0.68 conf (1 silent for 98 FAs)" was on this list and is
now **SUPERSEDED by round 14**: the one silent was a slot swap, the joint name reader decides
slots as one hypothesis and reads that board right, and with the reader in front of it the
extended scope measures 87 corroborated and 0 wrong.

Ruled out in **round 12** (full text in the archive): the direction witness on its own
(257 tiles, 2 wrong, silent tiles 4 → 6 — it speaks about direction only, so it shipped
restricted to trusted amount rungs at 158 tiles and 0 wrong); waiving the synth amount cap
wholesale (336 tiles, 5 wrong); dropping the `panelConf` multiplier from outcome tiles
(80 tiles, 1 wrong); the looser `+N` caption-amount extractor as a dissent channel (4
catches for 5 false dissents, against the `Lv.`-anchored form's 4 for 1).

**What DID work, and why:** round 10's joint reader. The residual errors were swaps and
compensating pairs — wrong only *jointly* — so per-node evidence could never see them.
Scoring all 625 assignments with the header as evidence (not a filter) and nothing pinned
took whole-parse 69.9 → 75.2. Safety is structural: overrides are capped below the flag
line, so they can only shrink the confident set.

## Method

1. Pull records (`tools/pull-collected.js`, admin token in `~/loseii-admin-token.txt`).
2. Triage (`tools/triage-collected.js`) → candidates; promote with per-field trust masks
   (`tools/promote-candidates.js`). **Labels are only trustworthy per-field**: a user's
   `final` freezes collection-time parser errors on fields they never touched, and ~30% of
   collected labels have been wrong in every expansion. Pixel-arbitrate disputes.
3. A/B honestly: worktree at unmodified HEAD with `samples/` symlinked, same labels both
   arms. The incumbent is a real competitor — rounds 8 and 9 both lost to it.
4. `npm run eval-gate` must PASS (thresholds + zero silents + zero silent TILES). Full
   serial run ~10min; a ~108s parallel harness (`--shard=i/N` + `--recjson=`) and the
   `OCR_CELL_EVID=1` offline scoring live in the scratchpad. Also verify that REMOVING the
   round's new artefact reproduces the incumbent board for board.
   The trained artefacts each have a build script under `tools/`, all reading a JSONL
   evidence cache: `build-level-model.js`, `build-name-model.js`, and
   `collect-tile-evid.js` → `build-tile-model.js`.
5. Ship: bump pins in `index.html`, commit, push (Cloudflare Pages auto-deploys).

**Model policy:** rounds run on Opus 5. Append a terse state-of-play block here every ~30
min (tried / worked / ruled out with numbers / next) — agents have been lost mid-round to
rate limits, stalls and connection drops; that note is what saves the successor.

## Corpus

472 scored pairs + 8 `_unusable`, in `samples/` (gitignored — user screenshots stay out of
the public repo; backup at `~/loseii-ocr-corpus-backup.tgz`). 22 non-English/degraded boards
are excluded from the English reference harvest via `LOCALIZED` in `tools/build-level-refs.js`
— a Spanish board filed "Daño de jefe" under "Boss Damage" for four rounds before that guard.
Residual level misses are a resolution tier: native 7.0%, ×2 4.0%, ×3+ 31.3%.
