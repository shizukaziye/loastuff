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
   glance" number. **Currently 25/472 = 5.3%.**
2. **Whole-parse rate** — boards with 0 wrong fields. **Currently 359/472 = 76.1%.**
3. Per-field average (97%) — the metric that HIDES the above. Report it last.

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

## Where things stand (round 14 shipped)

Both arms measured in one session against the same labels, on the same parallel harness:
the incumbent from a worktree at unmodified HEAD with `samples/` symlinked, the candidate
from the working tree. No label changed this round. The serial `npm run eval-gate` agrees
with the parallel harness on every headline number.

| metric | incumbent (r13) | **round 14** |
|---|---|---|
| **CLEAN boards** (0 wrong, 0 flags) | 25/472 (5.3%) | **47/472 (10.0%)** |
| UI flags (12 scalars + up to 4 tiles) | 2032 (4.3/shot) | **1687 (3.6/shot)** |
| …of which outcome tiles | 733 | 733 |
| …of which scalar fields | 1299 | **954** |
| UI flags sitting on CORRECT cells | 1485 | **1163** |
| **SILENT fields** | 0 | **0** |
| **SILENT TILES** (wrong yet ≥0.8) | 0 | **0** |
| whole-parse | 359/472 (76.1%) | **374/472 (79.2%)** |
| headline per-field | 97.3% | **97.6%** |
| outcomes | 96.0% | **96.1%** |
| flag coverage | 100% | 100% |
| gate 0.97/0.95 + zero silents + zero silent TILES | PASS | PASS |

**Holdout, reported separately** (the 96 boards `djb2%5==0`, which no trained artefact has
seen): CLEAN 7 → **12** (7.3% → 12.5%), flags 419 → **342**, whole-parse 70 → **75**
(72.9% → 78.1%), effect1 91.7 → **94.8**, effect2 91.7 → **95.8**, silents 0/0.
In-sample (376): CLEAN 18 → **35**, flags 1613 → **1345**, whole-parse 289 → **299**
(76.9% → 79.5%). Whole-parse gained MORE on the holdout (+5.2pp) than in sample (+2.6pp).

flags/board — incumbent `0:25 · 1:43 · 2:80 · 3:72 · 4:59 · 5:56 · 6:28 · 7:36 · 8+:73`
round 14 &nbsp;&nbsp;`0:47 · 1:91 · 2:77 · 3:61 · 4:43 · 5:41 · 6:29 · 7:30 · 8+:53`

Per-field: maxTurns 100 · processCostMultiplier 99.8 · gemType 99.4 · currentTurn 99.2 ·
willpowerLevel 98.5 · effect2Level 97.9 · orderLevel 97.7 · baseCost 97.6 · rerollsRemaining
97.4 · effect1Level 96.2 · outcomes 96.1 · **effect1 95.3** · **effect2 94.1**. Only the two
names moved (93.0 → 95.3 and 91.7 → 94.1); nothing else the engine reads changed.

Arc: headline 89.9 → 97.6, whole-parse 19.6 → 79.2, silents 43 → 0, silent TILES 4 → 0,
CLEAN 0.8 → 10.0%.

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

Round 10's method, applied to the field it was ruled out for. The names were the last big
pot: 537 of the 1299 scalar flags, and per-field the two worst columns by a wide margin.
Round 10 had rejected *joint framing* for them because only 2 of 72 name misses are a W↔E
swap — a finding about SWAPS, not about trained likelihoods, and the distinction is the
whole round.

**Why the names fit this treatment.** `model/astrogem.js` EFFECT_POOLS gives exactly four
legal names per base cost and the two slots hold different ones, so a board's names are a
**12-way choice under a known constraint**, not open-ended OCR. Every channel can be scored
against every candidate at once.

**What shipped**

| # | change | effect |
|---|---|---|
| A | `synthNameRescue` split into `synthNameScores` (all six classes, memoized per slot) + the old gates. Identical by construction — a name's score never depended on which others were in the loop | the pixel channel becomes available as evidence, not just as a last-resort rescue |
| B | `tools/build-name-model.js` → `ocr/name-model.js` (6.1 KB): log P(observation \| true name) per slot and channel, smoothed, trained on the 376 non-holdout boards | the reader |
| C | a 12-way joint solve in `structural-engine.js`; overrides commit at 0.66 (flagged, and below the caption verifier's floor) | 24 names fixed, 2 broken |
| D | AGREEMENT lift at `NAME_SURE = 12` when the base cost is confident | 258 flags reclaimed |
| E | the caption verifier's 0.68 floor comes off when the trained reader ran and the cost is confident | 87 more flags |
| F | `tools/eval-ocr.js` gained `--shard=i/N` and `--recjson=` | a 105s parallel A/B, exact against the serial run |

**The channels.** Two of them existed and were only ever consulted after the lexicon had
already failed; one is new.

- `synRaw` / `synGrad` — the patch synthesis' full per-class ranking on the name band and
  on its gradient. Alone, restricted to the true pool, the raw channel is **90.8%** — within
  two points of the whole incumbent reader, and it fails on pixels where the other fails on
  tokens.
- `wh` (new) — WORD HITS. A name is just its own words ("Atk. Power" is what the wheel
  renders, so `attack` carries `atk`); count how many a fuzzy token match finds. This is
  what separates `firand power` — 2 of Brand Power's words, 1 of Attack Power's — from the
  graded lexicon, which scored that read 0.7 for both and had to guess.
- `lines`, `lex`, `read` — the measured line count, the lexicon's own graded evidence, and
  the engine's committed read bucketed by confidence. Including the engine's read is what
  makes the model a refinement of the incumbent rather than a replacement for it.

**Measured, solve in isolation** (894 slots — the 50 on boards whose cost is unknown at
solve time are out of scope and the solve refuses them): model **879 (98.3%)** vs incumbent
857 (95.9%). HOLDOUT **180/184 (97.8%)** vs 173 (94.0%). 5-fold CV *inside the training
split* 695/710 vs 684. The holdout gained more than the training split, as in round 10.

**The lift, and why 12.** A lift is the one thing here that can mint a silent error, so it
carries two conditions and a factor.

1. *The base cost must be confident.* The enumeration cannot reach a name the pool excludes.
   Measured: 20 slots in the corpus have a true name outside the committed pool and **all 20
   sit on boards whose `baseCost` was itself flagged**.
2. *The solve must AGREE with the engine's own read.* Structural in the code — an override
   returns before the lift branch. At the shipped bar this costs nothing: every one of the
   651 slots above it is an agreement.

Margins among the 862 cost-confident slots, right/wrong: `<2` 11/5 · `2-6` 25/5 · `6-8` 39/2
· **`≥8` 775/0**. The worst WRONG name reaches 7.21 (then 6.76, 4.86) and nothing wrong
clears 8. `NAME_SURE` is 12 — **1.66×**, the factor round 12 shipped `JOINT_SURE` at. 651
slots clear it, every one right, and 258 of them were previously flagged (confirmed
end-to-end: scalar flags 1299 → 1041 with this change alone).

**E — the caption floor comes off, for the reason it was there.** Round 9 set the 0.68 floor
because the failure below it was a SLOT SWAP: a caption can witness that a name is on the
board, never which node holds it. The joint reader decides both slots as one hypothesis, so
a swap is now a candidate it scores. `c-ms0uhvso-gj1ae8`, the single silent that set the
floor, is read RIGHT by it — the wheel gives `["Ally Damage Enh.", "Ally Attack Enh."]` and
the solve returns `["Boss Damage", "Ally Damage Enh."]`, the labels. Measured over the flags
the trained reader leaves behind: **87 corroborated, every one right**, 26 on the holdout;
and of the 50 name slots still wrong-and-flagged, **not one** is both cost-confident and
corroborated. The surviving population is 82% right, so P(0 wrong in 87) ≈ 4e-8 under the
null — this is not the 0-of-27 coincidence round 13 declined.

**Honesty checks.** With `ocr/name-model.js` removed, the working tree reproduces the
incumbent **to the board** — 25 CLEAN, 2032 flags (733 tiles, 1299 scalars), 359 whole-parse,
97.3% — so every difference above comes from the trained tables and nothing else. And the
trainer's solver and the engine's `jointNameSolve` disagree on **0 of 894 slots**.

**Labels verified against pixels** (4× crops, `scratchpad/crop-names.js`): `c-mrx9wkcl-k6e9mq`
W really is "Brand Power" and `c-mryhg1e0-cpohfd` E really is "Atk. Power". Both labels are
RIGHT and the model is wrong on both — they are the 7.21/6.76 errors that set the bar. No
label was changed this round.

**Cost.** The synthesis now runs on both name slots on every board instead of only on the
ambiguous ones. Whole-corpus wall time on the parallel harness 106s → 109s (~3%); median
parse 2.17s. `countNameLines` is memoized alongside it (it was recomputing the same mask up
to three times per node).

**DEPLOY NOTE — one line this round did not touch.** `ocr/name-model.js` is a new file. The
background parse worker already loads it (`engineScriptUrls` in `structural-engine.js`), but
the main-thread inline fallback loads its stack from `LAZY_TABS.advisor` in `index.html`,
which needs `"ocr/name-model.js?v=1"` inserted **before** `"ocr/structural-engine.js"` —
along with the usual `?v=` bumps. Without it the fallback path degrades silently to the
round-13 reader (NMODEL null ⇒ the solve refuses and the caption floor stays 0.68), which is
safe but is not the build measured above.

## What is left

**The tiles are the gate again, and decisively.** 1163 of the 1687 remaining flags (69%) sit
on correct cells; the ceiling for CLEAN is the whole-parse rate, 374/472.

| | CLEAN if… |
|---|---|
| every TILE flag went away | 47 → **173** |
| every SCALAR flag went away | 47 → 76 |
| both NAMES never flagged again | 47 → 53 |

**88 whole-parse boards are ONE flag from clean, and 72 of them are a TILE** (it was 21 of
42 before this round). The name pot is spent: perfect names are worth 6 more CLEAN boards.

Scalar flags by field: effect1Level 182 · orderLevel 149 · effect2Level 118 · effect2 109 ·
willpowerLevel 97 · rerollsRemaining 91 · effect1 83 · baseCost 35 · gemType 27 · currentTurn
26 · maxTurns 26 · processCostMultiplier 11.

Flagged scalars by confidence band, right/total: `<0.30` 98/149 · `0.30-0.50` 102/131 ·
`0.50-0.60` 296/334 · `0.60-0.68` 60/64 · `0.68-0.75` 150/154 · `0.75-0.80` 121/122. The two
top bands are 271 flags at 98.6% pure — but they are now levels, not names, and the level
solve already has its own agreement lift at `JOINT_SURE`.

Honest doubt on the tile side, unchanged and still measured: `do_nothing`'s 0.2 rung is
32/54 = 59% pure, `change_side_option` 107/117 = 92%, the sign-cap residue 150/161 = 93%.

**The lead for round 15: the outcome TILES.** Two rounds of tile work (12 and 13) took tile
flags 922 → 733 and stopped; nothing this round touched them. 72 boards are a single tile
flag from clean and zeroing the class is worth +126 CLEAN — four times anything else on the
board. The method that has now worked four rounds running is the same one: find a channel
that fails independently of the incumbent, measure it per cell against the labels BEFORE
touching the engine, and lift only what it corroborates at a factor over the worst wrong
case. Round 14 adds one more move to that repertoire — where a field's vocabulary is closed,
stop writing rules and train the observation tables.

## RULED OUT — do not re-litigate without new evidence

Ruled out in **round 14**, all measured per name slot:

- **The name band's INK EXTENT as a channel** (the widest line's white-text width as a
  fraction of the band, bucketed, trained exactly like the others). It was built to separate
  the pair that sets the safety bar, and it does not: Brand Power's median extent is 0.715
  and Attack Power's is 0.737 — Attack Power is the WIDER of the two. Added to the model it
  LOSES: 5-fold CV inside train 695 vs 699, holdout 178 vs 180, and 4 of its 10 overrides
  break a slot the shipped reader gets right. The measurement is reproducible — `nameMask()`
  still records the extent under `OCR_NAME_EVID=1`.
- **The caption votes as a model channel.** Worth 0 slots (879 of 894 with, 879 without;
  CV 706 vs 705 of 752) and architecturally wrong besides: the strip resolves its own target
  THROUGH the committed names, so consuming its votes would mean deciding the names after
  the tiles that depend on them. They are still used by the round-9 verifier, which runs
  after the strip.
- **`NAME_SURE` below 12.** 8 is where the corpus first shows zero wrong (1.11× the worst
  wrong margin) and 10 is 1.39×. Both were available and both were declined: round 12 set
  the precedent at 1.6× and explicitly refused 1.29×. The 124 slots between 8 and 12 are
  the price of that factor.

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
4. `npm run eval-gate` must PASS (thresholds + zero silents). Full serial run ~10min; a
   ~200s parallel harness and `OCR_CELL_EVID=1` offline scoring live in the scratchpad.
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
