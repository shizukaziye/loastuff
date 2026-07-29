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
   glance" number. **Currently 18/472 = 3.8%.**
2. **Whole-parse rate** — boards with 0 wrong fields. **Currently 355/472 = 75.2%.**
3. Per-field average (96-97%) — the metric that HIDES the above. Report it last.

Prefer a fix that clears a board's last error over one that shaves the average.

## Hard invariant

**Zero silent errors** (a wrong field that does not flag → bad advice reaches the user with
no warning). Machine-enforced: `tools/eval-ocr.js` fails the gate on any silent. Never trade
it for headline points. Every corpus expansion so far has broken it on first contact with
unseen boards — that is what expansions are for.

The gate measures this at FIELD granularity, where `outcomes` collapses to one field at the
MIN of four tiles. The window flags tiles one by one, so a wrong tile that does not flag is
a silent error the gate cannot see. Round 12 started with **four** such tiles and ships with
two; watch `SILENT TILES` as well as the gate line.

## Where things stand (round 12 shipped)

Both arms measured in one session against the same labels: the incumbent from a worktree
at unmodified HEAD with `samples/` symlinked, the candidate from the working tree.

| metric | incumbent (r10) | **round 12** |
|---|---|---|
| **CLEAN boards** (0 wrong, 0 flags) | 4/472 (0.8%) | **18/472 (3.8%)** |
| UI flags (12 scalars + up to 4 tiles) | 2674 (5.7/shot) | **2221 (4.7/shot)** |
| …of which outcome tiles | 1214 | **922** |
| …of which scalar fields | 1460 | **1299** |
| UI flags sitting on CORRECT cells | 2450 | **1995** |
| SILENT TILES (wrong yet ≥0.8) | 4 | **2** |
| whole-parse | 355/472 (75.2%) | 355/472 (75.2%) |
| headline per-field | 97.2% | 97.2% |
| flag coverage | 100% | 100% |
| silent errors (gate) | 0 | **0** |
| gate 0.97/0.95 + zero silents | PASS | PASS |

flags/board — incumbent `0:4 · 1:17 · 2:39 · 3:59 · 4:68 · 5:72 · 6:44 · 7:40 · 8+:129`
round 12 &nbsp;&nbsp;`0:18 · 1:34 · 2:67 · 3:74 · 4:65 · 5:53 · 6:35 · 7:34 · 8+:92`

Per-field: maxTurns 100 · processCostMultiplier 99.8 · gemType 99.4 · currentTurn 99.2 ·
willpowerLevel 98.5 · effect2Level 97.9 · orderLevel 97.7 · baseCost 97.6 · rerollsRemaining
97.4 · effect1Level 96.2 · outcomes 95.8 · effect1 93.0 · effect2 91.7. **No field moved** —
round 12 changed only what the engine claims to be sure about, never what it reads.

Arc: headline 89.9 → 97.2, whole-parse 19.6 → 75.2, silents 43 → 0, CLEAN 0.8 → 3.8%.

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

## What is left

1995 of the 2221 remaining flags sit on correct cells; the absolute ceiling for CLEAN is
the whole-parse rate, 355/472. Whole-parse boards by flag count:

| | 0 | 1 | 2 | 3 | 4 | 5 | 6+ |
|---|---|---|---|---|---|---|---|
| UI flags — r10 | 4 | 16 | 36 | 54 | 65 | 64 | 116 |
| UI flags — **r12** | **18** | 32 | 62 | 71 | 60 | 37 | 75 |
| tile flags — r10 | 8 | 63 | 102 | 124 | 58 | | |
| tile flags — **r12** | **46** | 105 | 120 | 68 | 16 | | |
| scalar flags — r10 | 44 | 104 | 76 | 34 | 40 | 29 | 28 |
| scalar flags — **r12** | **53** | 115 | 79 | 41 | 25 | 22 | 20 |

Thirty-two whole-parse boards are now ONE flag from clean. The blockers, counted on the 53
that already have zero scalar flags: the **synth amount cap** on effect raises (0.78, ~20
tiles there and ~350 corpus-wide), `change_side_option`'s structural rung (81 tiles at 0.62,
89% pure), `do_nothing`'s 0.2 rung (53 tiles, 58% pure). The last two are honestly flagged —
the evidence really is not there, and the same is true of a good share of the 465 name flags
at 92-93% field accuracy. The synth cap is the one real target left, and it needs a fourth
witness; the three found here (caption agreement, lower-is-always-1, level-forced) have
taken every tile they can reach.

Two SILENT TILES survive: `c-mrwao04t-olyi6t#0`, whose error is the TARGET (an amount
witness cannot see it), and `c-mrxczi6z-ara48b#3`, whose caption OCRs as "sranc poveer|(k% 7".

## RULED OUT — do not re-litigate without new evidence

Seven independent channels into the west/east level block, each closed by measurement:

| # | round | channel | why it failed |
|---|---|---|---|
| 1 | 4 | ink geometry as a 1-vs-not verifier | offline 92% catch / 17% misfire; in-engine found a usable digit on only 210 of 545 consults |
| 2 | 5 | "Lv. N" line-width channel | 97.6% precision offline, worth exactly 0 against labels (0 fixes, 2 breaks); 22 of 34 misses have no located line at all |
| 3 | 6 | checksum recovery on the last 40 header-less boards | header is legible on all 40, but a board without a checksum is one whose nodes already refuse — a correct sum turns 1 wrong field into 2 |
| 4 | 7 | pigment separation | the ink is chartreuse over a green face; the gold-text hue band holds 0-25px of 14,400 on 8 of the boards |
| 5 | 8 | reference re-harvesting | +60 sources, measured WORSE than the shipped file on 4 full runs; not shipped |
| 6 | 9 | supervised exemplar selection | goes negative at the engine's real budget; scoring one rung in isolation optimises the wrong thing (its refusals are load-bearing) |
| 7 | 10 | joint framing for the NAMES | only 2 of 72 name misses are a W↔E swap; 31 sit at conf <0.30 with no observation to condition on |

Also ruled out: un-pinning synth nodes when a checksum exists (7 better / 5 worse, flat);
bounds-defying header OCR (orderLevel −1.0); single-predicate cost digit count (371/5/4 vs
369/0/11); caption-name evidence below 0.68 conf (1 silent for 98 FAs); softmax over raw
correlations and unfitted naive-Bayes weights for the joint model.

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
