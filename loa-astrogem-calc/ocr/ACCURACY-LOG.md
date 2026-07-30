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
   glance" number. **Currently 147/472 = 31.1%** (it was 25/472 when this was written).
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

## Where things stand (round 16 shipped — the campaign is now on maintenance)

Current build: **CLEAN 147/472 (31.1%)** · UI flags **1234 (2.6/shot)** — 322 tiles, 912
scalars · whole-parse 381/472 (80.7%) · headline 97.7% · **SILENT fields 0 · SILENT TILES
0** · gate PASS. The round-16 A/B table and the verdict are below.

Every round measures both arms in one session against the same labels, on the same parallel
harness: the incumbent from a worktree at unmodified HEAD with `samples/` symlinked, the
candidate from the working tree. When a round fixes a label, BOTH arms are re-run against it.
The serial `npm run eval-gate` agrees with the parallel harness on every headline number.

Per-field, current build: maxTurns 100 · processCostMultiplier 99.8 · gemType 99.4 ·
currentTurn 99.2 · willpowerLevel 98.5 · effect2Level 97.9 · rerollsRemaining 97.9 ·
orderLevel 97.7 · baseCost 97.6 · outcomes 96.7 · effect1Level 96.2 · effect1 95.3 ·
effect2 94.1.

Arc across sixteen rounds: headline 89.9 → 97.7, whole-parse 19.6 → 80.7, silents 43 → 0,
silent TILES 4 → 0, CLEAN 0.8 → **31.1%**.

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

Moved to the archive (search it for "Round 15"). The short version: a tile's vocabulary is
not merely closed, it is ENUMERATED by the game — `model/astrogem.js` OUTCOME_RATES lists 27
keys with base probabilities and says which the current levels/turns exclude, and exactly one
label in the corpus fell outside the legal set (pixels said that label was the error). So
`tools/collect-tile-evid.js` → `tools/build-tile-model.js` → `ocr/tile-model.js`, and
`tileSolve()` in `structural-engine.js` enumerates 27 keys × 4 tiles jointly with a duplicate
penalty. Overrides commit at 0.72 (below the flag line, so they cannot mint a silent):
11 disagreements, 10 fixes, 0 breaks. The AGREEMENT lift at `TILE_SURE = 9` reclaimed
**411 flagged tiles, every one right**.

**The lexical witness is the whole result, and it is the template every later round follows.**
A lift can mint a silent tile, so agreement alone was not enough: a TEXT channel — the caption
OCR or the dim-grey dilated pass — must independently name the same key's target or kind.
Every other channel (icon hue, relocated face, located line, arrow blob, template, both synth
rankings) reads the same rendered pixels through a colour mask, and they fail together.
Measured over the flagged tiles the solve agrees with: no gate → 697 tiles, 40 wrong, worst
wrong margin 20.06, so the 1.6× bar lifts 34; with the witness → 440 tiles, **3 wrong**,
worst wrong margin **5.56**, so `TILE_SURE = 9` is 1.62× and lifts **411 with 0 wrong**.
Both of the >10-margin wrongs the witness removes are non-English captures — no caption, no
second family of evidence, which is the mechanism said out loud.

Results: tile flags 733 → 322, wrong tiles 71 → 61, CLEAN 47 → 136, whole-parse 376 → 381.
With `ocr/tile-model.js` removed the tree reproduces the incumbent to the board. Two labels
were disproved by pixel crops and fixed; four more were checked and were right.

## Round 16 — the turn-1 invariant, and the end of the campaign

Round 15 named two targets and priced them at "roughly +40 CLEAN". **The price was wrong,
and so was one of the targets.** Measured first, built second:

| target | flags it clears | **CLEAN it buys** |
|---|---|---|
| `maxTurns` | 26 | **0** |
| `rerollsRemaining` | 42 of 91 | **+11** |

**`maxTurns` is worth nothing, and here is why.** It carries no confidence of its own: the
UI keys it on `state.rarity`, which is `pairConf` — the confidence of the WHOLE `Process
(x/N)` pair. So `maxTurns` flags exactly when `currentTurn` flags, on the same 26 boards. The
cap is not waiting on corroboration of N. It is waiting on the pair, and the pair is shaky
because **only one of its three votes survived**: of the 26, five have NO vote at all, 20
have exactly one, and one has two votes that agree on N. So the 26 are false alarms on
`maxTurns` and honest doubt on the `currentTurn` they share a confidence with — which is why
they never appear alone.

The witness the round was told to look for does exist. `rerollsShownDenom` is parsed and
`constraintSnap` never reads it; d=1⇒rare(7), d=2⇒epic(9); it is present on 272 boards and
names the TRUE `maxTurns` on **272 of 272**, and it covers 17 of the 26. It was still not
shipped, because the arithmetic kills it: **every one of the 26 boards carries between 2 and
12 further flags** after `maxTurns` and `currentTurn` are cleared (median 7). Directly
measured on the final build — `maxTurns never flags: 147 → 147`, `maxTurns+currentTurn never
flag: 147 → 147`. The user is reviewing all 26 boards either way. Spending the one field
that has never been wrong in sixteen rounds, to remove 2% of the flags from the corpus's
worst captures, is a bad trade. Left unshipped, and reproducible: `_debug.turnEvid`.

**What shipped: the turn-1 invariant** (`ocr/engine.js`, in `constraintSnap`'s confidence
block). A reroll can only be spent by rerolling, and the game offers no reroll until the gem
has been processed once — `advisor-window.js` greys the pill on turn 1 for exactly that
reason and clamps the count up to the allotment. So on turn 1 the number is not a reading:
it is the rarity's allotment, and the pill only displays it. The pixels agree —
`turn1-epic-c9-chaos` renders a GREYED pill still showing the full `2/2`.

This is the round-15 standard with the second family being a rule rather than a read: the
turn comes from the `Process (x/N)` footer — a different region, mask and OCR call than the
pill. Three guards, and the second is what makes it safe:

1. the TURN read must itself be unflagged (≥ 0.8), so a shaky turn cannot license a
   confident reroll count;
2. **the committed value must ALREADY equal the allotment.** The lift never changes a
   number — it only withdraws a needless question. A turn-1 board whose pill says anything
   else contradicts itself and stays flagged;
3. an ambiguous `0/d` read is excluded outright.

Measured: 60 boards whose LABEL says turn 1, and after two pixel-disproved labels were fixed
**all 60 carry exactly the allotment**. The engine reads 46 as turn 1 with a confident turn,
and on all 46 the committed value is already the allotment — **0 values changed, 0 fixes, 0
breaks**. No board has its turn misread as 1 while the turn read is confident.

**Labels fixed (pixel-arbitrated).** `c-mryunsmb-h6d7uj` and `c-mryur6to-n3a5jk`,
`rerollsRemaining` 0 → 1. Both are CJK captures whose reroll control is a GREY 補充 (Charge)
button, and both labels also say `currentTurn: 1` — jointly unreachable, since no reroll can
be spent before the first process. The control board proves grey-on-turn-1 means "not yet
available", not "spent"; the corpus's two other uncommon boards (turns 2 and 3) both label 1.
This lifted `rerollsRemaining` 97.4 → 97.9 in BOTH arms.

**A/B.** Incumbent = a worktree at unmodified HEAD with `samples/` symlinked, re-run against
the fixed labels. The strict board-for-board diff over all 472 boards × every field:
**42 boards differ, and the only difference is `rerollsRemaining`'s confidence.** No value,
no other field's confidence, no headline, no whole-parse, no tile metric moved — which is
also the proof that the two new `_debug` evidence records are inert.

| metric | incumbent (r15, fixed labels) | **round 16** |
|---|---|---|
| **CLEAN boards** | 136/472 (28.8%) | **147/472 (31.1%)** |
| UI flags | 1276 (2.7/shot) | **1234 (2.6/shot)** |
| …outcome tiles / scalars | 322 / 954 | 322 / **912** |
| **SILENT fields / SILENT TILES** | 0 / 0 | **0 / 0** |
| whole-parse | 381/472 (80.7%) | 381/472 (80.7%) |
| headline per-field | 97.7% | 97.7% |
| flag coverage | 165/165 | 165/165 |
| gate 0.97/0.95 + both silent counts | PASS | PASS |

flags/board — incumbent `0:136 · 1:87 · 2:53 · 3:45 · 4:44 · 5:25 · 6:24 · 7:20 · 8+:38`
round 16 &nbsp;&nbsp;`0:147 · 1:87 · 2:48 · 3:43 · 4:41 · 5:26 · 6:23 · 7:20 · 8+:37`

Holdout (96 boards): CLEAN 32 → **33**, flags 257 → **250**, silents 0/0. In-sample (376):
CLEAN 104 → **114**, flags 1019 → **984**. The split is lopsided only because that is where
the one-flag boards fell — nothing here is fitted, so holdout and in-sample are the same
experiment. The flag reduction is proportional: 7 of 42 on a holdout that is 20% of the corpus.

**Cost.** Table lookups in `constraintSnap`; no pixels, no OCR. Whole-corpus wall time
111s → 111s.

**DEPLOY NOTE.** No new data file, so `LAZY_TABS.advisor` in `index.html` needs no new line
(round 15's `"ocr/tile-model.js?v=1"` is already there). Bump `ocr/engine.js?v=54` and
`ocr/structural-engine.js?v=102`.

## The verdict: stop here and go to maintenance

Sixteen rounds took CLEAN from 0.8% to 31.1% and silents from 43 to 0. **The campaign is
done, and the measurement that says so is this one:** after round 16 there is no flagged
population left that is both large and near-perfect.

Flagged SCALARS — for each field, how many of its flags sit on a value that is actually
RIGHT (a false alarm) rather than wrong. 912 flags, 125 wrong, **86.3% right overall**:

| field | flags | wrong | right |
|---|---|---|---|
| **maxTurns** | 26 | **0** | **100.0%** — and worth 0 CLEAN (above) |
| willpowerLevel | 97 | 7 | 92.8% |
| orderLevel | 149 | 11 | 92.6% |
| effect2Level | 118 | 10 | 91.5% |
| effect1Level | 182 | 18 | 90.1% |
| gemType | 27 | 3 | 88.9% |
| currentTurn | 26 | 4 | 84.6% |
| rerollsRemaining | 49 | 10 | 79.6% |
| **effect2** | 109 | **28** | **74.3%** |
| **effect1** | 83 | **22** | **73.5%** |
| **baseCost** | 35 | **11** | **68.6%** |

Flagged TILES: 322, of which **61 are wrong — 81.1% right**, and every wrong tile in the
corpus flags (61 of 61). By committed key: `do_nothing` 26 flags and **22 wrong (15.4%
right)** — when the reader says `do_nothing` and flags it, it is wrong five times in six;
`change:effect2` 23 flags 8 wrong (65.2%); `raise_effect:effect2:1` 65 flags 7 wrong (89.2%).

Read those two tables together and the picture is plain. Excluding `maxTurns`, **every
remaining flagged population runs between 68.6% and 92.8% right** — between one in three and
one in fourteen of those flags is a REAL error. There is nothing left resembling the two
populations this round found (26 of 26, and 42 of 42). A lift needs a witness that separates
right from wrong inside the population; when a quarter of the population is wrong and no
channel separates it, the flag is the correct answer.

The remaining pots, and why each is honest doubt:

| pot | one-flag boards | why it holds |
|---|---|---|
| TILES | 35 | the biggest pot (+43) and round 15's caption floor — no caption, and every other channel is the same colour mask. 81.1% right, `do_nothing` 15.4% |
| the NAMES (`effect1`/`effect2`) | 25 | the biggest SCALAR pot (+28) and the DOUBTIEST population, 73-74% right. Round 14 already fitted a joint model with a calibrated margin and took the safe lifts |
| `effect1Level` | 10 | 90.1% right; SEVEN independent channels into this block have been closed by measurement (rounds 4-10) |
| `rerollsRemaining` | 9 | what is left after this round: 5 grey-Charge at 0.70 (15 boards, 1 wrong — no channel separates it), 2 with no read at all, 2 rescue rungs |

83 whole-parse boards remain one flag from clean: TILE 35 · effect2 13 · effect1 12 ·
effect1Level 10 · rerollsRemaining 9 · effect2Level 2 · orderLevel 1 · willpowerLevel 1.
Ceilings from here: every scalar flag gone → 256, every tile flag gone → 190, both names →
175, absolute (whole-parse) → 381.

**Maintenance from now on:** run `npm run eval-gate` on every corpus expansion and keep both
silent counts at zero. Expansions have broken the invariant on first contact every time —
that is what they are for.

The one lead left, recorded rather than pursued: flagged scalars in the `0.68-0.80` bands are
**265 of 270 right (98.1%)**. That looks liftable and is not — the 5 errors sit inside the
level block, the same block seven channels have already failed against, and a lift with no
separating witness mints 5 silents.

Flagged scalars by confidence band, right/total: `<0.30` 64/113 · `0.30-0.50` 102/131 ·
`0.50-0.60` 296/334 · `0.60-0.68` 60/64 · `0.68-0.75` 150/154 · `0.75-0.80` 115/116.

**The residual TILE flags, by why the solve did not lift them** (322 total, unchanged by
round 16): 257 have no lexical witness (85.6% right), 29 are below `TILE_SURE` (89.7%), 25
are a disagreement the witness refused (and the engine is right on only 5 of those 25), 11
are the overrides themselves. The floor is a caption-legibility floor: on a tile whose
caption OCRs to nothing, every remaining channel is the same family of pixels.

## RULED OUT — do not re-litigate without new evidence

Ruled out in **round 16**:

- **Lifting `maxTurns` on the reroll-denominator witness.** The witness is real —
  `rerollsShownDenom` is parsed and never read, d=1⇒rare and d=2⇒epic, and it names the true
  `maxTurns` on **272 of 272** boards where it exists, covering 17 of the 26 flagged. It buys
  **0 CLEAN**, measured directly on the final build: every one of the 26 boards carries 2 to
  12 further flags (median 7) once `maxTurns` and `currentTurn` are cleared, because
  `maxTurns` shares `pairConf` with `currentTurn` and a bad footer read travels with a bad
  capture. Not worth spending the only field that has never been wrong. `_debug.turnEvid`
  records every vote if this ever needs revisiting.
- **The 26 `maxTurns` flags are not "the votes disagree on N".** Five of the 26 have NO
  surviving vote, 20 have exactly one, one has two that agree. There is no free
  corroboration inside the pair to harvest.
- **Lifting the `0.75` reroll rescue rungs wholesale** (dim-pill rescue, relocation rescue,
  template-vs-OCR disagreement): 20 boards, 0 wrong, ≤4 CLEAN — and DECLINED. The rescue
  rungs as a whole (0.75 plus the `0/d`-ambiguous 0.40 band) are 23 reads with 3 wrong, 87%;
  under that null P(20 of 20 right) = 0.062. Same bar that declined round 13's 27-of-27 and
  round 15's fuzzy word hits. The obvious gate — the pill's denominator agreeing with the
  rarity — is VACUOUS here: all 20 already pass it, so it separates nothing.
- **Lifting the grey-Charge `0.70` rung**: 15 boards, 1 wrong (a "2/2" pill read as a grey
  Charge by the wide dilated word pass). Worth ≤5 CLEAN. No channel separates the one error:
  amber and neutral fractions on the wrong board sit inside the right ones' range, and the
  narrow word read fails on all 15. Picking it out post hoc is a 1-in-15 event, P = 0.067.
- **Forcing the VALUE on turn 1** rather than only the confidence: unmeasurable on this
  corpus (46 of 46 boards already commit the allotment, 0 fixes, 0 breaks), so it was not
  shipped. Related and left alone for the same reason: an ENGLISH turn-1 uncommon board would
  read a grey "Charge" and commit `rerollsRemaining = 0`, which the turn-1 invariant says is
  wrong — but no such board exists in the corpus, so the fix cannot be measured. The two CJK
  boards of that shape fall through to the correct default because `CHARGE_RX` never matches
  補充.

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

