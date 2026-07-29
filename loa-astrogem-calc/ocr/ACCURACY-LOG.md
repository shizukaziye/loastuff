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
   glance" number. **Currently 4/472 = 0.8%.**
2. **Whole-parse rate** — boards with 0 wrong fields. **Currently 355/472 = 75.2%.**
3. Per-field average (96-97%) — the metric that HIDES the above. Report it last.

Prefer a fix that clears a board's last error over one that shaves the average.

## Hard invariant

**Zero silent errors** (a wrong field that does not flag → bad advice reaches the user with
no warning). Machine-enforced: `tools/eval-ocr.js` fails the gate on any silent. Never trade
it for headline points. Every corpus expansion so far has broken it on first contact with
unseen boards — that is what expansions are for.

## Where things stand (round 10 shipped, live in production)

| metric | value |
|---|---|
| clean-board (0 wrong, 0 flags) | **4/472 (0.8%)** |
| whole-parse | 355/472 (75.2%) |
| headline per-field | 97.2% |
| flag coverage | 100% |
| silent errors | **0** |
| false alarms | 1715 (3.6/shot) |
| gate | 0.97 / 0.95 + zero silents — PASSING |

Per-field: maxTurns 100 · processCostMultiplier 99.8 · gemType 99.4 · currentTurn 99.2 ·
willpowerLevel 98.5 · effect2Level 97.9 · orderLevel 97.7 · baseCost 97.6 · rerollsRemaining
97.4 · effect1Level 96.2 · outcomes 95.8 · effect1 93.0 · effect2 91.7.

Arc: headline 89.9 → 97.2, whole-parse 19.6 → 75.2, silents 43 → 0.

## The next lever, with its cross-tab

Clean-board is 0.8% against a 75.2% whole-parse rate. Of the **356 boards that parse
perfectly**, `outcomes` flags **347 (97%)** — solely because outcomes confidence is a single
MIN over four tiles. **40 boards are flagged by nothing else.** Then names: effect2 flags
192, effect1 180. Levels: 133/102/86/82.

Projection if nothing else flagged: levels-only 5 · **+outcomes → 74 (15.7%)** ·
**+names → 294 (62.3%)**.

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
369/0/11); caption-name evidence below 0.68 conf (1 silent for 98 FAs); the located line as
an outcome direction witness (35 FAs for 1 silent — `outcomes` MIN means per-tile caps are
incidental cover); softmax over raw correlations and unfitted naive-Bayes weights for the
joint model.

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
