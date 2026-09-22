# Combat power — how lostark.bible breaks it down, and the chart's estimator

Sources: lostark.bible character route (SvelteKit `__data.json`, session-authed
via Shizu's own OAuth grant — rosters scope, own characters only), the site's
route module `17.D03QyhWy.js` (parts → category percentages), and six roster
characters' payloads pulled 2026-08-17.

## The data shape

Every ark-passive loadout carries:

- `combatPower: { id, score }` — the game's own score. id 1 = DPS score,
  id 2 = support score. This is DATA (the armory reports it), not computed
  by the site.
- `battlePoint: { isSupport, parts: [...] }` — the breakdown. Each part is a
  basis-point multiplier: the site's own category math is
  `product *= 1 + value/10000` over the parts in a category
  (route module, function `g`).

Two same-character loadouts (raid vs chaos) share gear parts but differ ~57%
in score: the score also carries the skill/tripod/rune setup, which the parts
do NOT cover. Any estimator from gear settings therefore anchors on a real
character's raid score and swaps gear multipliers, holding the skill block
constant.

## Part types seen (numeric -> meaning, with observed curves)

| type | meaning | curve notes (from the six-character fit set) |
|---|---|---|
| 1 | base attack point | absolute, carries mainStat / weaponPower / attackPowerMultiplier / baseAttackPower; Limerent 235,904 = 1.2400 x baseAttackPower |
| 2 | base health point | absolute; support loadouts only carry it meaningfully |
| 3 | level | 476bp at level 70 |
| 4 | weapon quality | 0bp at q91 support; 3000bp on DPS chars (q100?) |
| 5/6/7 | ark passive evo/enl/leap | 16000/7200/1400bp at 100/100/70 points (support); 7500/7000/1400 on DPS |
| 8/9 | karma evolution rank / leap level | 360bp = rank 6 (60/rank); leap 58bp sample |
| 10 | engraving (x5, stone-merged) | per-engraving bp by grade+stone points, grade05 rows 1700-3525 |
| 15/17 | accessory grinding lines / addon | per-line bp (neck stigma high = 480, etc.) |
| 16 | bracelet lines | per-line bp; 245 sample, many 0 rows |
| 19/20 | (unknown) / card set | card set 300-906. WARNING: this whole taxonomy is the SITE'S — it still carries categories for systems the game removed (transcendence and elixirs left last year), so type-name guesses here are unreliable |
| 22 | skill gem (x11) | per-gem bp: 704 (DPS lv10), 750 (support sample) |
| 26 | battlestat (crit+spec+swift) | 3.0 bp/point DPS, 4.0 bp/point support (exact across 5 chars) |
| 29 | arkgrid core (x6) | per-core bp: f(core grade, points): 300-400 (stars), 600-800, up to 918@18 ancient; NOT points-linear |
| 31 | arkgrid gem effects (x3) | per effect id: support id 2011 exactly 5.0 bp/level; DPS ids vary (3.3-8.3/level) |
| 33/34 | trinity/paradise orb | 130-264bp |

## The site's category grouping (function g in the route module)

- Ark Passive + Karma: types 5,6,7,8,9
- Engravings: 10 (attack/defense variants)
- Accessories: 15 + 17 (attack/defense)
- Bracelet: 16 (+addon variants)
- Gems: 22
- **Ark grid: 29 + 31** (attack; defense variants exist)
- Battle stats: 26; cards: 20; base attack/health/level/quality: 1,2,3,4

## The chart's estimator (final law, 2026-08-20)

Fit to LIVE in-game profile readings, not to the bible's breakdown — the
bible's parts are that site's own reconstruction (good relative weights, not
the game's internals). Measured on Limerent's raid loadout: **3,781.18 with
6s** and **6,354.88 with 10s**; the crawled 3,205.08 was a weaker skill
preset (gem presets ride skill presets), whose PARTS remain valid because
the skill block is not a part.

  CP(settings) = anchor.raidScore x baseAttackRatio x gemFactor(level)
                 x (1 + (S0 + dSmall)/1e4) / (1 + S0/1e4)

- **The profile header is the loadout score, raw, for every class.** The old
  x1.9964 "support convention" compared two different skill presets. Dead.
- **Gems compound per part.** The set swap moves the score x1.68066 =
  x1.04833 per gem; no sum produces that. This pins the level-10 support gem
  at 1,269.6 bp against 750 at level 6 — the naive "125 bp/level" linearity
  was the error, not the compounding. Levels 7-9 ride the line between the
  two measured points (129.9 bp/level). DPS: 704 bp at 10 (crawled rows),
  70.4 bp/level below until a second point is measured.
- **Small systems stay additive** over the anchor's non-gem sum S0 (support
  52,892 bp; DPS 48,517 bp). Battle stats, cores, grid gems and karma all
  move < 300 bp, where sum-vs-product is a wash.
- **Everything the chart does not price rides the anchor** (engravings, ark
  passive, cards, skill block). No invented development constants:
  the earlier devFrac died with the law fix — the floor now lands ~3,370
  support / ~4,930 DPS naturally, below Limerent's own 3,781 as it must be.
- DPS grid feed until the dd-dps sweep publishes: data/cp-grid-dps.json from
  the spot anchors (tools/build-cp-grid-dps.js); the page prefers real rows.

Reproduced measurements: estimate({}) = 3,781.18 exact; estimate({gemLevel:
10}) = 6,355 vs 6,354.88 live; estimateDps({}) = 7,895.29 exact.

Superseded readings, kept for the record: 6,398.63 (bible header, raid+10s
at crawl time) and 6,365.26 (first live 10s reading, wrong loadout state).

## Confirmed by cross-loadout pulls (2026-08-20)

Five-character public pull (Limerent, Paroxysmal, Buffgirlthighs, Doranis,
Mommyelly) plus two live glances closed every open question:

- **Profile = the ACTIVE loadout's score.** Paroxysmal reads 7,895 in game
  while the bible shows raid 7,895.29 and chaos 4,943.86 side by side. The
  rival theory (profile sums both loadouts — which fit Limerent's readings
  exactly as well, and would have made the old 1.9964 "convention" her twin
  chaos loadout at 6,311.62/3,205.08) predicted ~12.8k. Dead.
- **The skill build alone is x1.60.** Paroxysmal's chaos loadout carries
  IDENTICAL gear, gems and stats — only the skill block differs: 4,943.86
  vs 7,895.29. This is why anchors must come from the raid state, and why
  Limerent's Aug-17 crawl (3,205.08 in a weak skill state) misled three
  fits in a row. Her 750-bp rows WERE 6s (gem item 65041061 carries
  level-6 values, +28%/16%) — settled once the population pull showed
  1,250-bp rows on the supports Shizu quoted as wearing 10s.
- **The site's gem bp table is affine, not proportional.** DPS damage gems
  across the pulls: 448/512/576/640/704 for levels 6-10 (64 bp/level);
  support gems 750 at level 10 per the site. Site bp is that site's model —
  the game's own set ratio (x1.68066, measured) is what the estimator uses,
  so the mislabel never touched the shipped numbers.

## The skill curve — fitted to the leaderboard population (2026-08-20)

Shizu's astrogem leaderboard (19,198 cached characters) supplied a stratified
26-character NA sample (docs/research/cp-fit-population.json; 22 more pulls
lost to bible 429s, retryable). Predicting each raid loadout from the anchors
with its OWN parts, honing and gems leaves a residual that climbs cleanly
with progression: 0.23 at ilvl 1567, ~0.60 at 1710, ~0.75 at 1720s, ~0.82 at
1750s, ~0.88 at 1770s, 0.95 at 1773 full-10s, 1.07-1.09 for the 1790-1800
whales. That residual is the skill block — tripods, runes, skill levels —
which no part swap can see. Supports run ~0.88 where same-ilvl DPS run
~0.80, consistent with each axis anchoring at 1.0 on its own character.
(One corrupt row excluded: a support score id on a DPS build.)

The estimator multiplies by a piecewise-linear skill curve in the budget
notch — support [[0, .885], [47, 1], [100, 1.0923]], DPS [[0, .835],
[87, 1], [100, 1.03]] — plus a whale parts ramp (+7,500 bp of late account
systems, Zanilia-grade at cap) above the support anchor. Those +7,500 bp sit
in part types 27 and 11, which I first labeled transcendence and elixirs —
WRONG: both systems left the game last year (Shizu). Whatever the site means
by those types, the measured gap stands and is folded into prog(v).

## Our own formula (2026-08-20, Shizu's directive)

The shipped estimator no longer leans on the site's part taxonomy at all:

  CP(gear, v) = base.score x hone x gemFactor(level) x small(gear) x prog(v)

with base = Limerent's live raid reading (3,781.18, 6s), hone = sqrt(WP x MS)
ratio, gemFactor = the measured per-gem product curve, small = battle stats /
grid / karma nudges (assumption-weighted, sub-2%), and prog(v) = the fitted
progression multiplier (skill depth + late account systems; support
[[0,.885],[47,1],[100,1.2213]], DPS [[0,.835],[87,1],[100,1.03]]). The bible
supplies calibration READINGS only (scores, gear, gem levels). Reproduces:
Limerent 3,781.18 / 6,355; Paroxysmal 7,895.29; Zanilia 8,334 vs 8,342.85
measured; floors 2,983 support / 4,117 DPS.
Every constant traces to a pull: the model reproduces Limerent 3,781.18 /
6,355, Paroxysmal 7,895.29, and Zanilia 8,343 vs 8,342.85 measured. Site
gem bp tables confirmed across the population: support 125xL (750..1250
all five levels seen in the wild), DPS 64x(L+1) (448..704, 512@7 seen).
Chart ranges: support 2,900-8,500, DPS 4,100-8,500.

## Law post-mortem — three wrong fits before the right one

1. **Additive-sum over all parts** matched a cross-character constant
   (score / (base x (1+sum/1e4)) agreed to 0.4% between Limerent and
   Paroxysmal) but predicted the gem swap at x1.077 vs x1.68 measured. The
   cross-character match validated the bible's sum as a RELATIVE index, not
   the game's law — and it never mattered, because each axis anchors on its
   own character.
2. **Per-part product over all parts** matched the gem swap to 2% but blew
   the cross-character constant by x1.56 and produced the "11,500 is not
   real" support cap.
3. **Stale-header/x2-profile theories** died when the live readings showed
   the profile is just the score.

The discriminating experiment was a same-loadout gem-set swap read off the
profile screen — ten seconds in game, worth more than every fit above.

## Open items

- Validate against other bible loadouts (re-crawl Limerent's 10s state;
  characters wearing 7s/8s/9s pin the gem curve's mid-levels; a genuinely
  fresh character benchmarks the ~3,370 floor claim).
- Type-29 core table (grade x points), accessory line bp table, type-1
  1.24 dressing decomposition remain unmapped (small).
