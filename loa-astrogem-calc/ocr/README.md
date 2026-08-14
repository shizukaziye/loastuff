# OCR engines

Two readers live here, with **nothing in common but the folder**. They read
different screens for different tabs.

| reader | screen | tab |
|--------|--------|-----|
| the structural engine (below) | the single-gem **Processing** window | Advisor |
| `gemlist-engine.js` ([its own section](#the-ark-grid-list-reader)) | the **Ark Grid → Astrogem** list of up to 9 gems | Grader, "From screenshot" |

## The Processing-window parser (Advisor)

The Advisor tab can prefill its form from a Lost Ark **Processing** screenshot.
There are **swappable engines** behind one interface, plus a shared repair pass
(`constraintSnap`) that guarantees the Advisor only ever sees a **legal** game state.

| file | what it is |
|------|------------|
| `engine.js` | the common interface + `constraintSnap` + a small engine registry. No backend. |
| `tesseract-engine.js` | the legacy text-parsing LIBRARY (lexicon + parsers); no longer an engine. |
| `layout.js` | the structural parser's pure image-analysis core — environment-agnostic raster functions (browser canvas + Node sharp) shared by the structural engine; calibrated via `tools/dump-structural.js`. |
| `structural-engine.js` | THE parser: reads the screenshot's rigid layout + color coding first (panel/wheel anchors, self-calibrated icon hues from `layout.js`) and uses OCR only where it is strong. |
| `glyphs.js` | GENERATED template atlas (rebuild via `tools/build-glyphs.js`). |

## The interface

An engine is any object exposing:

```js
async parseScreenshot(imageElOrBlob) -> { config, state, outcomes:[4] }
isAvailable() -> boolean        // can it run here/now?
name, label                     // identity for the engine picker
```

Shapes:

```js
config = { baseCost, gemType, willpowerLevel, orderLevel,
           effect1, effect1Level, effect2, effect2Level }
state  = { currentTurn, maxTurns, rerollsRemaining,
           processCost, processCostMultiplier, totalGoldSpent, rosterBound }
outcomes = [o1, o2, o3, o4]     // applyOutcome-shaped (see below)
```

Outcome objects (the shape `model/nested.js#applyOutcome` consumes):

```js
{ type:'raise_effect'|'lower_effect', target:'willpower'|'order'|'effect1'|'effect2', amount:1..4 }
{ type:'change_side_option', target:'effect1'|'effect2' }
{ type:'change_gold_cost', change:+100|-100 }
{ type:'reroll_increase', change:1|2 }
{ type:'do_nothing' }
```

Engines self-register on load. The Advisor lists them via `ocrListEngines()` and
picks one with `ocrGetEngine(name)`; the picker row auto-hides when only one
engine is available (the production state: **structural** is the sole live engine).

## `constraintSnap` — the accuracy lever

`constraintSnap(parsed)` is shared by every engine (on the `BaseEngine` prototype;
in Node via `require("./engine.js").constraintSnap`). It takes a
noisy/partial/impossible parse and returns a fully **legal**
`{ config, state, outcomes:[4] }`:

- **baseCost** snapped to `{8,9,10}` (nearest; defaults to 10).
- **effects** canonicalized (case/space/punct + common OCR misreads) and snapped into
  `EFFECT_POOLS[baseCost]`; `effect1 !== effect2` is forced.
- **levels** clamped to `1..5`.
- **rarity** snapped to `{uncommon,rare,epic}`; `maxTurns`/`maxRerolls` derived from it.
- **currentTurn** clamped to `1..maxTurns` (from `currentTurn` or `turnsRemaining`);
  **turn 1 ⇒ full rerolls**; `rerollsRemaining` clamped to `0..9` — NOT to
  `maxRerolls`, because `reroll_increase` outcomes stack the counter uncapped.
- **processCostMultiplier** clamped to `[-100,100]` and snapped to the steps the game
  actually uses (`-100 / 0 / +100`); **processCost** made consistent with
  `900 × (1 + mult/100)`.
- **outcomes** padded/trimmed to exactly 4 and each repaired (legal type/target,
  amount `1..4`, cost `±100`, reroll `1..2`).

It reads its constants (`EFFECT_POOLS`, `RARITY`, `COSTS`) from `model/astrogem.js`,
so it stays in sync if the model changes. Each engine runs its raw parse through
`this.constraintSnap(...)` before returning, so downstream `window.evaluateActions`
always gets a legal state.

## Engine 1 — structural (the DEFAULT and only live engine)

`structural-engine.js` reads the screen's STRUCTURE and COLOR first and uses OCR
only where it is strong — anchored to the wheel's diamond geometry, normalized to
one canonical scale, template-matching the game's own fixed font, and arbitrated
by game-rule constraints (the points checksum, effect pools, legal state ranges).
It emits a full per-field confidence map; anything below 0.8 pulses "confirm me"
in the Advisor window. The complete strategy, with the measured constants and the
debugging methodology behind them, is documented in
[`../docs/how-the-advisor-works.md`](../docs/how-the-advisor-works.md).

It uses the global `Tesseract` (CDN) for its masked micro-OCR calls, with a
self-healing worker queue: a failed/blocked worker degrades the parse honestly
(every confidence capped at 0.5 + an explicit status message) instead of failing
or silently guessing.

## The legacy Tesseract lexicon (`tesseract-engine.js`)

The original full-frame Tesseract engine — superseded 2026-07-16 and no longer
registered. What remains is its text-parsing LIBRARY: the structural engine
consumes `GEM_NAME_COST` + `normalizeOcrText`, and `tools/eval-ocr.js` still
scores `parseConfig`/`parseCuttingState`/`parseOutcomes` as the legacy baseline
row (~58% — the measured reason it was replaced).

## The Workers-AI tier (removed 2026-07-18; verifier planned)

The original full-parse vision engine (`workersai-engine.js` +
`worker/astrogem-vision.js`) was deleted — it re-read the whole screenshot and
never deployed. Its WS4 replacement is a **flagged-field verifier**: the
structural parser is the reader; the AI is asked ONLY about the specific fields
the parser flagged (a small crop + a closed-vocabulary question), with a hard
daily budget. Design notes: `../docs/how-the-advisor-works.md` §6.

## A/B testing

`tools/eval-ocr.js` scores the engines' per-field accuracy against the real
screenshot + ground-truth pairs in `../samples/` (see `../samples/README.md` for
the samples, the measured per-engine scores, and how to add more).

---

## The Ark Grid list reader

`gemlist-engine.js` + `gemlist-refs.js` read the **list of owned astrogems** on
the middle right of the Ark Grid screen (Astrogem tab) — up to nine at a time.
It backs the Grader's **From screenshot** mode (`gemlist.js`). It shares no code
with the Processing parser above: different screen, different job, one file.

| file | what it is |
|------|------------|
| `gemlist-engine.js` | the whole reader — masks, panel anchor, field cutting, matching. No dependencies, runs in the browser and in Node. |
| `gemlist-refs.js` | GENERATED glyph templates (rebuild via `tools/build-gemlist-refs.js`). |

**Why nine rows are enough to grade.** `model/astrogem.js` scores a gem from its
willpower COST, its order/chaos points and its two effect lines. The base cost
(8/9/10) never enters `gemValue`, and this panel shows everything that does. The
base cost is recovered afterwards from the effect PAIR, purely for the label —
where two pools both fit, the grade is identical either way.

**The anchor.** Everything hangs off the nine gold **(P)** discs: the only place
on the screen where a small bright-gold blob repeats down one column at a fixed
pitch. A sliding window collects gold row-runs and keeps the column whose runs
best fit an arithmetic progression. That yields the icon column x, the row
pitch (i.e. the UI scale) and each row's y **without assuming any resolution** —
every later measurement is a fraction of the pitch.

Three things had to be added before that was trustworthy, each after it actually
went wrong on the corpus:

* **The half-pitch alias.** Loosen the run filter enough for a small capture and
  the hollow willpower icon on line 1 starts qualifying too — every row becomes
  two and the pitch halves. So the sweep runs twice: once with loose absolute
  thresholds to get a ballpark pitch, then again with thresholds derived from
  it, testing both that pitch and twice it. Candidates are checked for
  *uniformity* (a real panel's nine anchors are the same glyph, so their gold
  densities barely differ; the alias alternates and gives itself away).
* **The impostor column.** The game's right-hand icon bar is also evenly spaced
  gold, and a bare periodicity test happily locks onto it. A candidate only
  survives if most of its rows carry **white text** to their right, which a gem
  row does and an icon bar does not.
* **The tinted row.** On an equipped row the background is bright orange and a
  small white digit is mostly antialiased edge, so the global white mask can come
  back empty. There is a local re-threshold inside the digit box for that case.

**Bands.** Patches are size-normalized before matching, but normalizing does not
undo blur: a digit that was 17 px tall at 4K and one that was 11 px tall at
1440p end up the same size with visibly different stroke weight. Templates are
therefore harvested at several capture sizes and kept in **separate bands** keyed
by the pitch they were seen at — the same lesson `tools/build-glyphs.js` learned
as `GLYPH_BANDS`. Pooling them measurably hurt.

**Where it refuses.** Below a row pitch of 62 the reader returns `ok:false` with a
plain message instead of guessing. That number is measured, not chosen: reading
the corpus at shrinking sizes gives 100% of fields at pitch 105, 99.5% at 70,
84% at 58 and 31% at 35, and below ~62 the wrong digits stop being separable
from the right ones by match margin.

**Silent errors are the gate.** A wrong field the reader FLAGGED is fine — the
Grader opens that row in its editor with the doubtful cells outlined. A wrong
field it did not flag is not, because it grades a gem the user is never asked
about. Every threshold here is set from the measured margin distributions of
right-vs-wrong reads, and the cost gets a structural cross-check on top: the
effect pair fixes which base-cost pool the gem is from, and a pool only ever
yields willpower costs `base-5 .. base-1`.

### Working on it

```bash
npm run gemlist-refs            # rebuild ocr/gemlist-refs.js from samples/gemlist
npm run eval-gemlist            # shipped refs vs the labels — must be 100%, 0 silents
npm run eval-gemlist-holdout    # leave-one-screenshot-out — the honest number
node tools/eval-gemlist.js --scales   # 4K down to refusal — 0 silents at every size
```

The corpus is `samples/gemlist/` (gitignored, like the rest of `samples/`):
screenshots plus `labels.json`. **Adding screenshots is the main way to improve
this** — especially captures at a resolution or UI scale not in there yet. Label
them, rebuild the refs, then re-run all three commands.
