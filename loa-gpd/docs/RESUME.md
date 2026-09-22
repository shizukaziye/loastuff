# Resume — where this project stopped, 2026-08-20

The sweeps were stopped cleanly for a three-week break. Nothing is lost:
every finished tier is a shard on disk, and both drivers resume by reading
them. Three repos are clean with nothing unpushed (`loa-gpd`, `loastuff`,
`loa-bracelet-calc` untouched).

## Restart the sweeps

Run from the repo root (`C:\Users\Shizu\loa-gpd`). The `--workers` count is
the only thing to think about: 14 on a free machine, 6 while gaming, 2 if
the game is choppy.

```bash
node tools/dd-sweep.js --axis=dps --workers=14 --push=1 >> tools/.cache/dd-dps/driver.out 2>&1
```

```bash
node tools/dd-sweep.js --workers=6 --outdir=tools/.cache/dd2 --push=1 >> tools/.cache/dd2/driver.out 2>&1
```

Then pin them (Windows inherits affinity to children, so pin the driver
early and re-apply once workers spawn):

```bash
powershell -c "Get-Process node | ForEach-Object { $_.ProcessorAffinity = 0x7FFC; $_.PriorityClass = 'BelowNormal' }"
```

`0x7FFC` = cores 2-14, leaving 0-1 and 15 clear. While gaming use `0xFFF0`
(cores 4-15) at `Idle` — Shizu's standing rule. The sweep also stands down
by itself 06:00-09:00 and 18:00-21:00 New York (tools/quiet-hours.js);
`ARKGRID_NO_QUIET=1` overrides it.

**Two traps that cost time this session.** The bash tool's working directory
drifts between calls, and a relaunch whose `>>` redirect resolves to a
missing directory exits 1 without starting anything — use absolute paths or
`cd` first, then confirm the process actually came up. And a driver holds
its code in memory: edits to `dd-sweep.js` or `arkgrid-account.js` only
take effect for tiers started after a restart.

## State at the stop

| axis | rare | epic | notes |
|---|---|---|---|
| support | **29/29** | 28/29 | complete for everything the 25M slider reaches |
| dps | 17/29 | 14/29 | 27 tiers remain, ~35 h at 14 workers |

Support's last tier (epic 100M) was 61% through a ~28 h run and was
discarded — it only extends coverage past the slider, so nothing on the
site depends on it. The DPS sweep's in-flight tiers are likewise gone;
their cell caches survive in `data/cells/dps-*`, which is the expensive
part, so re-runs are much faster than first runs.

The DPS anchor gate now checks per tier rather than demanding a complete
lattice (the axis has 10 spot anchors, not a full MC run). Five of the ten
overlaps were hand-verified before the stop, all inside the 10% tripwire:
rare 250k, epic 250k, rare 1.09M, epic 1.09M, rare 3.96M.

## Open work

1. ~~Support bracelet ladder is over-graded~~ **DONE 2026-09-16** (e4e1dce).
   All three generators price through `jointScore` and verify each example
   against `braceletScore` at build time.
2. **DPS sweep completion** — resume as above; the site flips each series
   from "coming soon" to live rows on its own as tiers publish.
3. **OAuth redirect URIs are not registered yet.** The character lookup can
   read cached characters but cannot pull fresh ones until Shizu adds these
   on his lostark.bible developer page:
   - `https://shizukaziye.github.io/loa-gpd/` → prod client `22zuv73nnkcgczoxitokvo2q6u`
   - `http://localhost:8734/` → dev client `onwc5iva725mxhak2dxq3ikjti`
4. **CP model has two cheap open measurements** (docs/research/combat-power-model.md):
   one bracelet swapped, and one gem dropped a level, each read off the
   profile screen. They would retire the last assumed weights.

## What shipped in the final stretch

Character lookup ported from the astrogem/bracelet calculators (one box, no
leaderboard) placing a character on every ladder and highlighting the
cheapest next upgrade; the worker learned to parse honing, karma, stone and
bracelet; the CP ladder became one rung per purchase with every increase
documented; the DPS bracelet ladder was re-anchored to the calculator's own
scorer; and the sweep learned to yield the machine during Shizu's hours.

---

# Since the break — 2026-08-26

The character lookup was wrong about bracelets and about accessories, and it now
has a gear list that shows its own working. See docs/METHODOLOGY.md, "Character
lookup", for the method; what changed here:

- **The bracelet is scored by the bracelet calculator's own scorer**, loaded at
  lookup time from `shizukaziye.github.io/loa-bracelet-calc`. It used to be
  placed by the sum of its two combat traits against each rung's example stat
  pair, which is not a threshold — a 115/83 Ancient with three good lines failed
  every DPS rung and read "worse than C+" against the calculator's A-.
- **The raw bracelet now comes from the bracelet Worker** (`/character`), which
  has no sign-in wall and sends the bible's own stat array, so the trait
  identities and the line families survive. The astrogem Worker only ever sent
  the trait pair as two numbers. That worker also fills per-piece honing, karma,
  the stone and the per-slot main stat.
- **Accessories are placed through the ladder's own damage table** rather than
  by counting primary tiers out of the rung's name. The flat roll and the
  main-stat quintile count now, which they did not before.
- **The axis follows the character.** A support class with a support-dominant
  gem set opens on the support tab, everything else on DPS, and the gear list
  says so when the tab and the character disagree.
- **The fresher pull wins, and staleness is on screen.** Two workers cache
  separately and neither auto-refetches — that is deliberate upstream policy. So
  honing, karma and the stone come from whichever record is newer, each row
  carries the age of the pull it was read from, and a stale character gets one
  line at the top with a re-pull link. Found the hard way: a 15-day-old bracelet
  record had White at +20 weapon / +19 armour and was overwriting a fresher
  astrogem pull; the re-pull returns +22 / +21.
- **The gear list** is the second view in the lookup panel: one row per system —
  what the pull read, where that puts you, then TWO priced steps: the rung you
  already stand on and the one to buy, each with its own gold per 1% under a
  header that names which is which. Sorted by the NEXT step's price, so the top
  row is the buy; every unread system keeps its row and says why.
- **Guardian (blue) stones default to 300 a hundred**, not 30 (Shizu,
  2026-08-26). Every honing rung reprices off it, so the honing gold per 1%
  rises by roughly a fifth at the defaults.

## The 2026-08-27 review pass

Fable 5 reviewed the lookup and found ten defects; all are fixed. The ones worth
remembering because they are easy to reintroduce:

- **A lookup now takes a ticket** (`lkSeq`). Clearing the poll timers does not
  cancel a fetch already in flight, and the queued path long-polls by design, so
  an answer for the character you just stopped looking at would land on top of
  the one on screen — gear list, axis tab and all.
- **A stamp is laid only where a value came back.** Stamping a null locked the
  other pull out of a field it actually had, and a re-pull that could not read
  karma or the stone dropped values already on screen.
- **`gems: []` was the "is this a record?" sentinel**, so a character with no ark
  grid had their whole record thrown away. It is now a real shape test.
- **Only percentage accessory lines arrive x100.** A flat roll is its own number;
  dividing it rendered "Weapon Attack Power+ 480" as "4.80".
- **A failed cross-origin script or data load is no longer cached for the
  session** — one github.io hiccup used to disable the bracelet scorer until a
  page reload, with a Re-pull button that looked like the remedy and was not.
- **`lkGrid` must not cache a null**: astrogem.js is deferred and cross-origin,
  and a grade taken before it lands would pin "did not parse" for good.
- The ability-stone `stoneNodes` trap is in METHODOLOGY.md; the fix that would
  retire it belongs in the bracelet Worker, which should send the `{a,b,malus}`
  split the astrogem Worker already does.

## Two things a future session should know

1. **The accessory rows in `rows.json` / `rows-dps.json` have no builder in the
   repo** — only the bracelet series does (`tools/build-bracelet-rows.js`). They
   DO reproduce from the lattice, though: `accessory-scores.json` (support D) or
   `accessory-configs-dps.json` (DPS D and gold) with `accessory-configs.json`
   for support gold, differenced along the chain, matches 245 of 262 rows on
   damage and 255 of 262 on gold exactly. So rebuilding that ladder — on the
   high main stat / no flat family, to match the gear list — is a small job, not
   a reverse-engineering one. It would make accessories roughly 10x dearer per
   1% because the ladder would stop cherry-picking cheap flat and stat combos.
2. ~~The astrogem bible Worker's source is not in any repo.~~ **It is** — in
   `loastuff`, at `loa-astrogem-calc/worker/astrogem-bible.js`, commit
   `b219aac` ("Worker: parse honing, karma, stone and bracelet for the GPD
   lookup"). The separate `astrogem-calculator` checkout is a different,
   older copy; do not edit that one.
3. ~~The support bracelet rungs run about a band hot~~ — fixed, and the
   warning has been taken off the gear list's bracelet row.


---

# 2026-09-16 — back from the break

The DPS sweep is running again (14 workers, cells warm from August, tiers
landing in about an hour each instead of five). The bracelet work above is
closed. What is left:

0. **THE ARK GRID PIPELINE IS DONE (2026-09-17).** DPS finished 29/29 on
   both rarities, zero quarantined, zero failed. All ten anchor overlaps
   were hand-checked afterwards: damage — the hard gate — is within 4.2%
   everywhere. Gold and gems swing up to ~36% at 12M and 40M, which is the
   knife-edge bimodality Shizu ruled on in August ("believe the dd") and
   exactly why the gate is damage-hard and gold is log-only. Support is
   29/29 rare and 29/29 epic. Both tabs show live rungs with no "filling
   in" note anywhere.

1. **The accessory ladder has no builder** and cherry-picks cheap flat and
   stat combos, which makes accessories look roughly 10x cheaper per 1% than
   the gear list's own family. The note above says it reproduces from the
   lattice — a build job, not a reverse-engineering one. This is the biggest
   remaining correctness item and it will move the chart's recommendations,
   so it wants Shizu's call before it ships.
2. **OAuth redirect URIs** still need registering on the lostark.bible
   developer page (see open work #3 above).
3. **Two cheap CP measurements** remain (open work #4 above).

## 2026-09-22 — the DPS anchors are stale too

The axis fix (56c09d9) made the dd side right and left the MC anchors wrong:
they were run in August under the same support-damage bug, so they sit about
10x low. The gate did its job and quarantined 8 tiers on damage gaps of
900-1300% — with the ANCHOR as the wrong party each time.

`tools/.cache/anchors-dps` is therefore retired to
`anchors-dps-STALE-buggy-damage`. With no anchors present the gate reports
"none, no gate" and tiers merge on their own.

TWO THINGS THIS LEAVES:

1. **Hand-merge at the end.** The running driver keeps its quarantine list in
   memory, so those 8 tiers stay excluded for this run even though their
   shards are on disk and valid. After the sweep finishes, run the merge and
   the row builder by hand so every shard lands:

   ```bash
   node tools/arkgrid-merge.js --axis=dps && node tools/build-arkgrid-account-rows.js --axis=dps
   ```

2. **The DPS axis has no validation until the anchors are rebuilt.** They are
   MC spot runs at 250k / 1.09M / 3.96M / 11.97M / 40M per rarity. Worth
   redoing on idle machine time now that the simulator is correct — without
   them nothing independently checks the dd numbers.

## 2026-09-22, later — the resweep is done and merged

The DPS resweep finished 58/58 shards. The driver's own publish excluded the
ten tiers it had quarantined against the stale anchors, so the hand-merge above
was run and every shard is in: 29/29 rare (C+ through S-) and 29/29 epic (B
through S), `arkgrid-progress-dps.json` says 0 quarantined, and no card on the
site says "coming soon".

The accessory ladder item is closed too: the chart builds the accessory chains
live from the lattice for the flat-line / main-stat families the switches above
the plan tick (default no flat, high stat), starting from the growth shop piece
(one high primary, two low flats, min main stat — Shizu's call; the flat tier
is `ACC_SHOP_FLAT` in index.html if the shop's piece turns out to roll higher).
The baked accessory rows are gone from `rows.json` / `rows-dps.json`, and
`tools/accessory-ladder.js` with its output is deleted. Method in
METHODOLOGY.md, "Accessories".

Still open: the DPS anchors (item 2 above), the OAuth redirect URIs, and the two
CP measurements.
