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

## Where things stand (round 13 shipped)

Both arms measured in one session against the same labels, on the same parallel harness:
the incumbent from a worktree at unmodified HEAD with `samples/` symlinked, the candidate
from the working tree. No label changed this round. The serial `npm run eval-gate` agrees
with the parallel harness on every headline number.

| metric | incumbent (r12) | **round 13** |
|---|---|---|
| **CLEAN boards** (0 wrong, 0 flags) | 18/472 (3.8%) | **25/472 (5.3%)** |
| UI flags (12 scalars + up to 4 tiles) | 2221 (4.7/shot) | **2032 (4.3/shot)** |
| …of which outcome tiles | 922 | **733** |
| …of which scalar fields | 1299 | 1299 |
| UI flags sitting on CORRECT cells | 1995 | **1809** |
| **SILENT TILES** (wrong yet ≥0.8) | 2 | **0** |
| wrong tiles (of 1880) | 79 | **74** |
| whole-parse | 355/472 (75.2%) | **359/472 (76.1%)** |
| headline per-field | 97.2% | **97.3%** |
| outcomes | 95.8% | **96.0%** |
| flag coverage | 100% | 100% |
| silent errors (gate) | 0 | 0 |
| gate 0.97/0.95 + zero silents + zero silent TILES | PASS | PASS |

flags/board — incumbent `0:18 · 1:34 · 2:67 · 3:74 · 4:65 · 5:53 · 6:35 · 7:34 · 8+:92`
round 13 &nbsp;&nbsp;`0:25 · 1:43 · 2:80 · 3:72 · 4:59 · 5:56 · 6:28 · 7:36 · 8+:73`

Per-field: maxTurns 100 · processCostMultiplier 99.8 · gemType 99.4 · currentTurn 99.2 ·
willpowerLevel 98.5 · effect2Level 97.9 · orderLevel 97.7 · baseCost 97.6 · rerollsRemaining
97.4 · effect1Level 96.2 · outcomes 96.0 · effect1 93.0 · effect2 91.7. Only `outcomes`
moved: round 13 fixed 5 tiles and changed nothing else the engine reads.

Arc: headline 89.9 → 97.3, whole-parse 19.6 → 76.1, silents 43 → 0, silent TILES 4 → 0,
CLEAN 0.8 → 5.3%.

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

## What is left

1809 of the 2032 remaining flags (89%) sit on correct cells; the absolute ceiling for CLEAN
is the whole-parse rate, 359/472. Whole-parse boards by flag count:

| | 0 | 1 | 2 | 3 | 4 | 5 | 6+ |
|---|---|---|---|---|---|---|---|
| UI flags — r12 | 18 | 32 | 62 | 71 | 60 | 37 | 75 |
| UI flags — **r13** | **25** | 42 | 75 | 69 | 49 | 42 | 57 |
| tile flags — r12 | 46 | 105 | 120 | 68 | 16 | | |
| tile flags — **r13** | **74** | 135 | 112 | 31 | 7 | | |
| scalar flags — r12 | 53 | 115 | 79 | 41 | 25 | 22 | 20 |
| scalar flags — **r13** | **54** | 116 | 79 | 42 | 25 | 22 | 21 |

**Tiles are no longer the gate.** Round 12's asymmetry has closed: zeroing every tile flag
now takes CLEAN 25 → 54, zeroing every scalar flag takes it 25 → 74. The scalar side is
where the next round's headroom is, and 537 of its 1299 flags are the two effect NAMES.

Forty-two whole-parse boards are ONE flag from clean: 21 of them a scalar (12 effect1,
6 effect2, 2 rerollsRemaining, 1 orderLevel) and 21 a tile (5 sign cap, 8 synth amount cap,
3 do_nothing, 2 change_side_option, 3 ladder).

**Where the flag floor actually is.** Flagged cells by confidence band, right/total:

| band | <0.2 | 0.2-0.4 | 0.4-0.5 | 0.5-0.6 | 0.6-0.68 | 0.68-0.75 | 0.75-0.8 |
|---|---|---|---|---|---|---|---|
| scalars | 54/105 | 103/121 | 42/56 | 400/445 | 73/88 | 324/328 | 154/156 |
| tiles | 35/58 | 7/15 | 2/3 | 123/135 | 77/89 | 246/261 | 169/172 |

917 flags sit at 0.68-0.80 and 893 of them are right (97.4%) — that is the reachable pot.
1115 sit below 0.68 and 838 are right (75%) — that is doubt the engine is entitled to.
But **221 of the 484 reachable scalar flags are effect names the strip caption does NOT
corroborate**, and round 9 measured exactly that population: 221 uncorroborated with 1
wrong. The corroborated 156 are already lifted at 0.68-0.80; lifting the rest mints a
silent field error and fails the gate. So the name pot is closed until a new channel
appears — and it is the single biggest one (waiving both names would take CLEAN 25 → 52).

Honest doubt, with numbers: `do_nothing`'s 0.2 rung is 32/54 = 59% pure, `change_side_option`
107/117 = 92%, the sign-cap residue 150/161 = 93% (of its 11 wrong, 6 have no amount source
at all). All three are flagged for a real reason. Realistic remaining headroom: roughly
150-250 flags and +10-15 CLEAN, and only with genuinely new channels.

**The one lead worth a round.** A THIRD reader of the effect names — not the wheel diamond
and not the outcome caption, both of which are already spent. Anything that could speak for
the 221 uncorroborated 0.68-0.80 names would be worth more CLEAN than everything round 13
shipped. The pattern that has worked three rounds running is the one to repeat: find a
channel that fails independently, measure it against the labels per cell BEFORE touching
the engine, and lift only what it corroborates.

## RULED OUT — do not re-litigate without new evidence

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
