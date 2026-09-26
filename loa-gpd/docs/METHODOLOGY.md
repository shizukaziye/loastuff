# Lost Ark GPD chart — methodology

What every progression system costs, and what it buys, on one scale: **gold per
1% damage**. Two axes: **support**, where damage is what the support hands the
party, and **DPS**, where it is the character's own (docs/research/dps-axis.md).

## The damage axis

Damage stacks multiplicatively, so scores are logs and add up (the house model,
shared with the accessory and astrogem calculators):

```
D = 100 * ln(multiplier)        ~= percent damage, exactly additive
```

A support does not deal the damage; it hands damage to the party. So a support
step is scored by what it adds to a damage dealer, above a support wearing
nothing — the accessory calculator's model, ported in `model/support.js`:

```
Q = 100 * ln( ap * brand * identity )
```

| Channel | What it is | Reached by |
|---|---|---|
| `ap` | the ally attack-power buff: the support gives away `0.22 * (1 + allyAtkEnh)` of its own base attack power | **honing, karma**, earring weapon power, ring ally-atk lines |
| `brand` | 10% damage scaled by brand power | neck stigma lines, ark grid, karma ranks |
| `identity` | Serenade + Major Chord + T-skill, one shared bracket, diluted by the dealer's own additional damage | ring ally-damage lines, ark grid, spec |

Only `ap` touches the support's own gear. That is the whole reason honing and
karma reach the party at all.

## The gold axis

```
gold per 1% damage = gold / (damage% * partySize)
```

`partySize` defaults to 3 — a support's 1% lands on every dealer in the party.
This matches the astrogem calculator's `SUPPORT_GPD_MULTIPLIER`, so numbers here
and there are on the same scale.

## The support's own stats

Assembled the way bebkok's support buff calculator does it (sheet
`1le-LqVr9l4dXxBDlPaSMNpf6tDVfvfsFE_QRIAmVONE`, tab "Sup buff calc v3.81",
cells DN20..DP29). Flat sources are summed first and the percentage pool
multiplies the lot — a flat weapon-power line is amplified by every weapon-power
percent you own:

```
total WP = (weapon piece + accessory flats + ark grid core + feast + bracelet)
           * (1 + earrings% + karma% + ark grid core%)
total MS = (five armour pieces + accessories + roster + level + food)
           * (1 + skin% + stronghold%)
basic AP = sqrt(total WP * total MS / 6) * (1 + stone% + gem%)
```

| Weapon power | Default |
|---|---|
| accessory Weapon Power+ lines | 2,400 flat |
| ark grid weapon core (Ancient) | 3,900 flat and 2.94% (0.75 + 1.50 + 0.23×3) |
| feast | 2,400 flat |
| earrings, two high lines | 6.00% |
| Karmic Enlightenment | 0.10% per level |

Percentages are **one additive pool**, so each further karma level lands on a
bigger denominator and is worth slightly less: 0.01382% party damage at level
21→22 against 0.01375% at 29→30.

`tools/verify.js` reproduces bebkok's own saved character exactly — total weapon
power 226,085.218, total main stat 687,158.89, basic attack power 184,566 — and
fails loudly if the model drifts.

One divergence from the accessory calculator, taken deliberately: bebkok puts an
attack-power percentage (ability stone 1.5% plus damage gems 13.2%) on the
support's *own* base attack power, which scales the buff it hands out. The
accessory calculator leaves that out. This tool follows bebkok, which raises
every ap-channel step by roughly a tenth.

A second deliberate divergence, ruled on 2026-08-16: the ark grid packer taxes
any core under 17 points at a flat -3% / -6% / -9% of total damage (14-16 /
10-13 / 0-9). The game's real loss, read off bebkok's "Ark Grid Cores" tab and
run through this model's buff math, is smaller and lumpier — about 1.0-1.2%
for the Brave order cores (Serenade-scoped 17-options on Shizu's bard;
Seraphic AP builds run ~1.6-1.8%), 0.5-0.9% for the chaos cores with the
Echoing Brand damage-taken rider priced in. The Buckshot meter core uses
the meter rulings on record — Buckshot is 20% of meter generation and
meter converts to Serenade uptime at half effectiveness, both fixed by
Shizu 2026-08-16 (the factor is the accessory calculator's documented
bar-step approximation) — which puts its 17-option at 0.16 and its
14-option (the 500-meter counter proc) at ~0.3: the one core whose
cliff sits at 14, not 17. Everywhere else it is a cliff at 17,
nearly flat below. Shizu
keeps the harsh flat tax on purpose: 17+ points per core is treated as table
stakes, not a trade the optimizer may sell. The tax lives in the packer's
objective only; reported damage assumes the standard away-team of 17-point
cores it enforces.

## Where the game data comes from

`tools/fetch-game-data.py` pulls Maxroll's planner feed
(`assets-ng.maxroll.gg/laplanner`) — the tables their upgrade calculator itself
runs on, tracking the July 2026 patch — and bakes the small derived files under
`data/`. Big downloads are cached under `tools/.cache/` and not committed.

**Cross-check that runs on every fetch:** the `itemLevel` table reproduces
bebkok's Serca gear sheet exactly (chest 57,614 at +0 and 111,477 at +25; weapon
124,793 and 241,367; gloves 86,421 and 167,216). That is the same baseline the
bracelet calculator uses, from an independent source.

## Honing — T4 Upper (1675), normal track

Two rows: **all five armour pieces moving together**, and **the weapon on its
own**. Steps run +11→+12 up to +24→+25.

Rates are 0.01% units. A tap lands at

```
p = base + min(fails * failBonus, failMax) + juice
```

Juice is Lava's Breath (weapon) or Glacier's Breath (armour), `rate` each up to
`juiceMax`. Every failure banks artisan energy; once the success rates already
spent add up to the artisan threshold (215.00%), the next tap is guaranteed.

"Average scenario, optimal" means expected gold under the cheapest constant
breath count, solved per level rather than assumed. It matters: on armour at
+11→+14 and +16→+17 the optimum buys **no** breath, because at 150g the juice
costs more than the taps it saves.

Material prices are editable and each material has an on/off switch, matching
the upgrade calculator — off means the player has it bound and pays nothing.
Defaults:

| Material | Unit | Default |
|---|---|---|
| Destiny Shard Pouch S / M / L | 1,000 / 2,000 / 3,000 shards | 0, off |
| Superior Abidos Fusion Material | each | 125 |
| Destiny Crystallized Destruction Stone | per 100 | 1,800 |
| Destiny Crystallized Guardian Stone | per 100 | 30 |
| Great Destiny Leapstone | each | 25 |
| Lava's Breath | each | 300 |
| Glacier's Breath | each | 150 |

The step's damage is measured against a self-consistent character: the rest of
the gear sits at the step's starting level, and only the track under test moves.

## Karma

Only **Karmic Enlightenment** counts for a support: **Weapon Power %, +0.10 per
level**, 2.10% at level 21 rising to 3.00% at level 30. It feeds the same `ap`
channel as weapon honing, through `wpPct`.

Ranks 1–5 cap at level 21; rank 6 carries 21→30. Evolution's rank bonus also
grants brand power (+1% per rank, 6% at rank 6), which is already inside the
accessory calculator's brand base.

Karmic Evolution (Max HP) and Karmic Leap (Ultimate Awakening Damage) are worth
nothing to a support's party contribution and are not charted.

## Bracelet

The ladder is the bracelet calculator's own: its `braceletScore` grades every
bracelet, its band cuts (F- to S+) are the rungs, and each rung's example is
verified against that scorer at build time (`tools/verify-bracelet-bands.js`).

**What a rung costs is a rolling campaign, not a finished bracelet.** You buy an
UNROLLED bracelet — its two combat traits are visible on the market, its seven
rolls on the three granted slots unused — roll it, and keep the first one the
scorer puts in the band. So a rung is priced as

```
cost(band) = min over the even pair 60/60 … 120/120 of
             (listed(pair) + 20 pheons) / P(a rolled bracelet of that pair reaches the band)
```

with the rolls simulated (1.5M bracelets per pair, lines kept above a lock
threshold and the rest rerolled) and the odds read off the scorer. The rung
takes the cheapest pair; a balanced pair is cheapest for a given stat total, so
the rungs come out even (100/100, 110/110).

**The listing price** is `model/bracelet-price.js`: a log-linear curve in the
two stats (`log price = −3.81 + 0.076·higher + 0.060·lower`), fitted to twenty
of Shizu's August listings, times a market level per pair kind —
`MARKET_SCALE`, support ×2.5 and DPS ×5 as of 2026-09-24 (spec/swift 100/100
≈ 46k, crit/spec and crit/swift ≈ 91k). The August listings were spec/swift;
the DPS pairs never had a corpus of their own, hence the larger correction.

**Pheons are in, and they are most of it**: 20 per bracelet at 2,237g (850
blue crystals per 100 pheons, 25,000g per 95 crystals), 44,737g per attempt
before the listing. The crystal price is a constant, not live.

**Two readings of a step.** The chart's rows are the ladder's steps —
cost(band) − cost(band below) — which is right for a planner starting with
nothing, since the lower band is a waypoint on the way up. The character
lookup prices a worn bracelet's next band **from scratch**: a rolled-out
bracelet cannot be improved in place, so the whole campaign is the price, and
the gain is measured from the bracelet actually worn, on the scorer's own
damage scale.

## Accessories

The accessory calculator prices every configuration of a slot — the two primary
tiers, the flat line (none, or Attack Power+ / Weapon Power+ at low, mid, high)
and the main-stat quintile — by its damage on the reference character:
`data/accessory-scores.json` and `data/accessory-configs.json` for support,
`data/accessory-configs-dps.json` for DPS. The page builds the accessory rungs
from that lattice at load time; nothing accessory-shaped is baked into
`rows.json`.

**The switches above the plan choose the families.** Only pieces whose flat
level and main-stat quintile are ticked can be rungs. The default is **no flat
line, high main stat**, which is what a buyer shopping for line upgrades looks
at. On the DPS axis a flat level covers both Attack Power+ and Weapon Power+;
the chain takes whichever prices better.

**The chain is what a buyer walks.** The base is the growth shop piece
everyone starts with (Shizu, 2026-09-22): the better primary line at high plus
two low flat lines — Attack Power+ and Weapon Attack Power+ — at the bottom
main-stat quintile. That is the accessory calculator's own first baseline
("primary high + 2 low flats" in its design history). On support the Attack
Power+ line is worth nothing, so the piece is a lattice point; on DPS the two
flats' gains over the bare piece are added in log space. The switches do not
move the base: they say what to buy, not what you already wear. From there each
rung is the ticked piece that costs least per 1% *from the rung before it*: the
lower convex hull of (gold, damage). A piece better and cheaper than a rung
would have been chosen ahead of it, so no rung is dominated, and every step
costs more per 1% than the last, which is what "every step under the slider,
taken in order" needs. The old baked rows followed the plain cost frontier —
every configuration nothing cheaper beat — and it kept tiny cheap steps a buyer
never takes, which stalled the ladder until the slider passed them. A ticked
family with nothing better than the shop piece has no rungs.

The calculator nets a piece under the market floor to nothing after the pheon
tax. Such a piece that still beats the shop piece is the chain's first rung,
shown as **pheons only**: it costs the pheons and the listing floor, not a price
the model can name. Under the default switches that is one rung on most slots
(a bare "high/— · no flat · high stat", or a "mid/mid" on the DPS market).

**Sidegrades.** A step that swaps which line is high — mid/high to high/mid —
or changes only the main stat is a sale and a purchase, not an upgrade in
place, and some players will never make one (PrinceOfZamunda, 2026-09-24).
They are allowed by default: sell the old piece, buy the next, the step's gold
is the price difference. The switch above the plan turns them off; then a rung
must raise a primary line and lower none, until both lines are high, where a
better main stat or flat is the only step left. The lookup's next step obeys
the same rule from the piece worn.

A rung's `total` is the piece's market price; its `gold` is the difference from
the rung before it, since you sell one piece and buy the next.

## Character lookup

The lookup places one character on every ladder. Nothing is guessed: a system
the pull cannot read keeps its row in the gear list and says why.

**Two sources, because neither carries a whole character.**

| | astrogem Worker | bracelet Worker |
|---|---|---|
| sign-in | required | none |
| accessory grinding lines | yes | no |
| accessory main stat | no | yes |
| ark grid gems, skill gems | yes | gem levels only |
| bracelet | the trait pair only | the raw payload |
| honing, karma, stone | yes | yes, per piece |

Both are asked at once and the answers merge, the richer field winning.

**The bracelet is scored by the bracelet calculator, not by this page.** The
raw payload is decoded with `Bracelet.decodeBibleBracelet` and scored with
`Subrank.braceletScore` — the same call `tools/build-bracelet-rows-dps.js` used
to cut the ladder, so the letter here and the letter there cannot disagree. The
rung is then the last one whose band the character has reached.

Before 2026-08-26 the bracelet was placed by the SUM OF ITS TWO COMBAT TRAITS
against each rung's `hit.stats`, and that field is the rung's *example*
bracelet, not a threshold. Every DPS rung shows 100/100 or better, so a 115/83
bracelet failed all ten and read "worse than C+" while the calculator had it at
A-. The three effect lines — most of what a bracelet is worth — were never read.

**Accessories are placed through the ladder's own damage table.** A piece is
read as a configuration — the two primary tiers, the flat roll (`atk-` and
`wpn-` kept apart on the DPS axis), and the main-stat quintile — and looked up
in `data/accessory-scores.json` (support) or `data/accessory-configs-dps.json`
(DPS). Each rung's `to` label is read back into the same configuration and
looked up the same way, so the two are on one scale. Rings and earrings are
placed on the WEAKER of the pair, because that is the piece the next step buys.
A main stat the pull did not carry is taken as the middle quintile and the row
says so.

**The gear list's accessory rungs are the chart's own chain** — the families
the switches tick, built as described under Accessories — so the letter on the
card and the step in the list cannot disagree.

Your own piece is a rung on that ladder. Both prices are measured against the
piece actually worn — flat line and main stat included, whether or not its
family is ticked — so a good piece is neither charged twice nor credited to a
rung nobody bought. The next step is the ticked rung above that costs least per
1% from your piece: on the chain that is the rung straight above; off it (a dear
flat roll the switches exclude, say) it can be a rung further up.

**The ability stone comes from the astrogem pull, never from node counts alone.**
The bracelet Worker sends `stoneNodes`: every engraving's node count, the malus
included, sorted high to low. The top two are therefore not reliably the two
combat engravings — a 9/6 stone whose malus sits at 7 reads `[9,7,6]`. That
array is used only when nothing else carries the stone, and the row says it is
a guess.

**Freshness is a reading like any other, and it is shown.** Both workers cache,
independently, and neither auto-refetches a stale record — that is the bracelet
worker's own written policy, because background churn is the upstream load these
tools promised not to generate. So the lookup does two things instead. The older
record never overwrites the newer one: honing, karma and the stone are read from
whichever pull is fresher, and a field the astrogem pull read exactly is only
displaced by a strictly newer bracelet pull. And the gear list says how old the
reading is — on the row, and once at the top with a re-pull link.

This was not academic. White's bracelet-worker record was 15 days old and had the
character at +20 weapon and +19 armour; a re-pull returned +22 and +21. The stale
record was also winning over a fresher astrogem pull, so the page had no way back
to the truth. A re-pull cannot beat lostark.bible's own snapshot either, so when
THAT date is old the header says so and stops promising a fix.

The support bracelet rungs used to run about one band hot, because the
ladder's own damage came from this repo's simplified support model rather than
from `jointScore`. Fixed 2026-09-16: all three bracelet generators price
through `jointScore` on the right profile and read their anchors off
`braceletScore`, so the character's letter and the rung it lands on are now
measured the same way. Every rung's example is exact-verified at build time
and `tools/verify-bracelet-bands.js` re-checks both axes.

## Loseii Score

One number for how hard a character hits, on the in-game Combat Power scale.
The chart's plan card shows it for the build under the slider; the profile pages
show it for a looked-up character, with its parts. It replaced the chart's
Combat Power estimate on 2026-09-25, and is labelled **beta** while the check
against lopec below stays open.

### What it is

```
Loseii Score = K × exp( Σ_s D_s / 100 )
D_s = L_s(character) − L_s(reference)
```

`L_s` is where the character stands on system `s`, in the house log-damage
units (`D = 100·ln(multiplier)`), measured on this chart's own ladders — the
same per-step damage the rows carry, so the chart, the lookup and the score
cannot disagree. The sum is the character's damage multiplier against the
chart's reference character (ilvl 1785: weapon +25, gloves +23, the rest +21;
level-9 gems; high/high accessories at max main stat with no flat line; 9-7
stone; karma 21; a full ark passive; a 60/60/60 ark grid with every core at 20
points). **DPS: the character's own damage, no support buffs, with a fixed dummy
attack buff on the attack-power term. Support: the buffs measured on a fixed
reference dealer.** (One fixed partner, below.)

`K` puts that multiplier on the CP scale: the weighted median, over a
calibration panel of real NA characters, of `CP / multiplier`, so the median NA
character scores its own in-game CP. It is one constant per axis; nothing
depends on item level. The panel (`data/loseii-panel.json`, source records in
`tools/fixtures/loseii-panel.json`) is 118 DPS and 39 supports from the
bracelet and astrogem boards' caches, pulled 2026-09-25, spread across the
bands 1700–1720, 1720–1750, 1750–1780 and 1780+ and weighted so each band
counts as its share of the NA bracelet board. Each member's CP is the one its
own pull carried (lostark.bible's `estimatedMaxCombatPower`). K is 6,452 on
DPS and 5,893 on support, which is also what the reference character scores.
Displayed as a whole number, like CP.

### The systems, and where each reading comes from

| System | Reading | How it is priced |
|---|---|---|
| Honing, armour | every piece's +N, advanced honing and gear set | the pieces' real main stat on the honing ladder (below) |
| Honing, weapon | the weapon's +N, advanced honing and gear set | its real weapon power on the weapon ladder |
| Karma | Enlightenment level | the karma rows; below 21 the 21→22 step is extended per level (the same +0.1% weapon power a level) |
| Skill gems | every gem's level (`gemLevels`, eleven of them, so a set of six 10s and five 8s is priced gem by gem) | each gem an eleventh of the set's step — skill damage, cooldown and basic attack power (Skill gems, below); below level 7 the 7→8 step is extended per level |
| Ability stone | the two engravings' nodes | 7-7 → 9-7 (the game's own rule: combined level 5) |
| Bracelet | the bracelet calculator's own score total (`Subrank.braceletScore`) | the scale the bracelet rungs' `totalDamage` is on |
| Accessories | each of the five pieces as a lattice point (primaries, flat line, main-stat quintile) | the accessory lattice's damage |
| Ark grid | `Astrogem.gridDamage` of the valid gems | the scale the ark grid rows are priced on |
| Ark passive, evolution tier 1 | the evolution tree's points | the first 40 points buy the tier-1 stat nodes, 50 of a combat stat a level (`stats.json` `arkPassives` 1010100–1010600); a level is priced by the bracelet model's `traitDamage` for 50 specialization: 1.2123 on DPS, 0.2454 on support |
| Master (DPS) | the ark passive node, from the bracelet pull | +7% additional damage on the bracelet model's pool (4.93) |
| Fixed partner | nothing: the same for everyone | DPS: a fixed dummy support buff ×1.4341 on attack power; support: the chart's reference character as the dealer (One fixed partner, below) |

**Honing is priced from stats, not from +N.** T4 gear comes in two sets. The
lower one (1590, "Destined Hellfire") has item level 1590 + 5 × honing +
advanced honing, and its stats follow item level; the upper one (1675,
"Destined Tremor") has item level 1675 + 5 × honing. The pull gives each
piece's +N and advanced honing but not its set, so the set is the split of the
six pieces that reproduces the character's item level (the two readings of a
piece sit 40+ levels apart, so it is never close; on the panel every 1700–1720
character is on the lower set and every 1750+ one on the upper, and 1720–1750
holds both — 30 upper, 4 lower, and one character part-way across). A piece's main
stat or weapon power then comes from the game's own table —
`data/honing-t4upper.json` for the upper set, `data/honing-t4lower.json` (baked
by `tools/fetch-game-data.py` from the same Maxroll feed, keyed by item level
1590–1755) for the lower — and the sum is placed on the honing ladder in log
space. The chart's honing rows are the knots: the five pieces at +11…+25 plus
the axis's other main stat (DPS: the bracelet model's reference raw main stat
less the reference armour, 73,991; support: `gear.js`'s flats, 85,991), and the
ladder's damage there. Between knots the ladder's own damage per unit of log
stat applies, and beyond the ends the first (last) step's. So a piece is never
clamped to the ladder's floor: an upper piece at a knot scores exactly the
ladder, and a lower-set piece or one under +11 scores what it carries.

**Advanced honing** needs no table of its own. On the lower set it raises item
level one for one and the stats follow (the page's weapon power total
reproduces exactly from the item-level table, to the point, for every
lower-set character checked); on the upper set it adds nothing the page's stat
totals show (Paroxysmal's weapon power reproduces exactly without it), and
every upper-set character on the panel is at advanced 40 anyway.

**The ark passive.** Every panel character from 1705 up has all three trees
full (140 / 101 / 70 points), so the tier-1 evolution part only moves the few
who do not. Which tier 2–5 nodes the points bought is not in the pull (the
bracelet worker keeps only Master), so those nodes, and the enlightenment and
leap trees, are not scored.

The bracelet has no reading in the reference spec, so the reference bracelet is
the panel's median bracelet.

### One fixed partner

Shizu, 2026-09-26: **a dealer is scored on its own damage, with no support
buffs**, and **a support on its buffs measured on one fixed dealer**. (A
matched partner — the median support or dealer of the character's item-level
band — was tried first; it was dropped for this.)

**DPS.** The DPS ladders come from the bracelet model, which carries no brand,
ally damage, ally attack or uptime term, so a dealer's score is its own
damage. The one exception is the attack-power term. A support's attack buff is
a flat add scaled off the support's own attack, and removing it entirely would
leave weapon power and main stat carrying all of a raid dealer's attack, so a
dealer's attack power carries a **fixed dummy support buff**: the reference
support's attack buff on the reference dealer, as a multiple of that dealer's
own attack power, from the support model (`support.js`'s ap channel):

| | |
|---|---|
| support's base attack | 228,511 (`gear.js` at +21 armour, +25 weapon; 20.3% attack power) |
| handed over | × 0.22 × (1 + 68.55% ally attack enhancement) = 84,733 base attack; × 1.2948, the dealer's attack-power pool = 109,714 |
| dealer's own attack power | 182,651 base × 1.2948 + 3,600 flat = 240,097 |
| while the buff is up | (240,097 + 109,714) / 240,097 = ×1.4570 |
| at its 95% uptime | 1 + 0.95 × 0.4570 = **×1.4341** |

It is frozen as `DUMMY_SUPPORT_AP` in `model/loseii-score.js`, and
`tools/verify-loseii-score.js` recomputes it from the two models and fails if
they drift. A constant multiplier cancels in every ratio, so it moves no score
and K absorbs it; it is there, and named in the breakdown ("attack power incl.
a fixed dummy support buff ×1.43"), so the attack-power level the model stands
on is a raid's.

**Support.** A support's buffs are measured on one fixed dealer, the chart's
reference character — `support.js` DEFAULTS' dealer (dpsWP 260,918, dpsMS
767,170) is exactly that character — the way lopec measures every support on its
standard dealer. The breakdown names it.

Neither axis reads a partner's item level, so neither score depends on any
band: the verify checks that a dealer's score does not move when every support
field in `support.js` is changed, and that a support's does not move when every
dealer's item level is.

### Skill gems

The pull reads each gem's level through its basic attack power side effect
({type:2, id:150}: 0.60 / 0.80 / 1.00 / 1.20% a gem at level 7..10, and the
page's own attack-power total agrees on 103 of 117 corpus loadouts). The DPS
gem ladder already priced the two bigger halves (commit 11b0fca, Shizu's model
on bebkok's gem table): skill damage 32 / 36 / 40 / 44% on all of a dealer's
damage, and cooldown 18 / 20 / 22 / 24% with casts going as 1 / (1 − cooldown)
and 70% of damage on cooldown — 4.83 / 4.79 / 4.75% a set level. It left out
the third: the basic attack power, which on the bracelet model's reference is
another 2.00 / 1.96 / 1.92%. The rows now carry all three, 6.93 / 6.84 / 6.77%
a set level, built by `tools/gem-rows-dps.js` (which `--check` reproduces). The
share of damage the skill-damage half lands on is one class-neutral number, all
of it; lopec uses each class's measured share (딜지분), which this site does not
have. The support gem rows (`model/gems.js`) carry the attack-power half at 1.2
points a level for the set; the pages say 2.2 (eleven gems at 0.2% a level), so
that row is short by about a point of attack power a level — flagged, not yet
re-baked.

### What is not scored, and why

A system the pull does not carry is not invented. It drops out of the sum (the
character is taken at the reference's level there) and is named under the
breakdown. Per character that is usually the accessories and the ark grid,
which only the astrogem pull carries (sign-in walled), and Master and the ark
passive points, which only the bracelet pull carries. Never scored: engravings
(books and relic engravings — only the stone's 9-7 step is scored), runes,
tripods and skill levels, the ark passive past tier-1 evolution and Master,
card sets and weapon quality — none is in the pull. Elixir and transcendence
are not on the list because both left the game in 2025
(`docs/research/combat-power-model.md`); the bracelet worker's page probe still
looks for them and no record carries them. A support's care and utility
(lopec's ~7% and ~1%) are not scored either: the support axis is the buff alone.

### Why not Combat Power

The game's Combat Power weights each system by its own table, and that table
is not damage: the chart's estimate of it (`combat-power.js`, now retired) had
to fit a "progression" fudge to a leaderboard sample to follow real characters
at all, and it was widest of the mark on supports. The Loseii Score keeps CP's
scale, so nobody learns a new number, but takes its order and its gaps from
damage. Where your score and your CP disagree, the game's weighting and real
damage disagree — or an unscored system is doing the work.

### How lopec informed it

[lopec.kr](https://lopec.kr)'s 환산 점수 is the Korean community's standard
for "real" power: base attack power multiplied through every damage system
with class-neutral weights, and a support scored by buff power (~92%), care
(~7%) and utility (~1%), scaled to sit on the dealer scale
([support method](https://cool-kiss-ec2.notion.site/1eb758f0e8da8065aa70d07656ea2bca)).
Its numbers land near in-game CP on purpose. The Loseii Score takes the same
two ideas — multiply the systems, read on the CP scale — onto this site's
damage model and its ladders.

### Checked against lopec (2026-09-25/26)

**lopec's own population** ([lopec.kr/stats](https://lopec.kr/stats),
snapshot 2026-09-26; ilvl 1700+, best-score profile; 932,709 dealers and
166,704 supports). The page publishes the spread of lopec scores and of
in-game CP in 100-point buckets from 3,000, not medians per item-level band.
Matching the two spreads quantile by quantile (the buckets' own totals; the
bucket arrays in the page sum to about half the stated counts):

| quantile | dealers: lopec / CP | ratio | supports: lopec / CP | ratio |
|---|---|---|---|---|
| p10 | 3,204 / 3,204 | 1.000 | 3,180 / 3,179 | 1.000 |
| p25 | 3,529 / 3,548 | 0.995 | 3,495 / 3,545 | 0.986 |
| p50 | 4,284 / 4,346 | 0.986 | 4,219 / 4,266 | 0.989 |
| p75 | 5,294 / 5,427 | 0.975 | 5,368 / 5,350 | 1.003 |
| p90 | 6,714 / 6,889 | 0.975 | 7,056 / 7,037 | 1.003 |
| p95 | 7,665 / 8,001 | 0.958 | 8,168 / 7,948 | 1.028 |

**lopec, middling KR dealers** (character pages `lopec.kr/character/specPoint/<name>`,
2026-09-26; the page shows the lopec score, the in-game CP and the median lopec
score at that item level):

| name | class | ilvl | lopec | in-game CP | lopec / CP | lopec median at that ilvl | gems | grid atk/add/boss |
|---|---|---|---|---|---|---|---|---|
| 구름 | Aeromancer | 1737.5 | 3,369.89 | 3,635.47 | 0.927 | 3,486.20 | seven 7s, four 6s | 54/30/— |
| 로로 | Wildsoul | 1762.5 | 6,483.40 | 6,858.69 | 0.945 | 4,736.37 | eleven 10s | 46/33/17 |
| 호랑이 | Sharpshooter | 1770.0 | 4,819.49 | 5,026.94 | 0.959 | 5,432.04 | one 10, ten 7s | 27/38/1 |
| 치즈 | Wildsoul | 1784.2 | 6,963.76 | 7,128.21 | 0.977 | 6,897.37 | one 9, ten 8s | 59/49/11 |
| 조사 | Gunslinger | 1800.0 | 9,203.34 | 9,710.10 | 0.948 | 8,906.46 | eleven 10s | 50/62/78 |

lopec sits 2–7% under CP on these five and 0–4% under across its population's
quantiles, with no trend across item level.

**Ours, the NA calibration panel**, median Loseii Score ÷ in-game CP per band,
K refitted on the panel each time:

| band | n | median CP | first model | gear sets | matched partner | **now** (no support buffs) | median Loseii now |
|---|---|---|---|---|---|---|---|
| DPS 1700–1720 | 24 | 2,313 | 1.98 | 1.43 | 1.35 | **1.41** | 3,220 |
| DPS 1720–1750 | 25 | 3,671 | 1.10 | 1.10 | 1.05 | **1.07** | 4,007 |
| DPS 1750–1780 | 33 | 4,945 | 1.02 | 1.02 | 1.02 | **1.02** | 5,123 |
| DPS 1780+ | 36 | 7,543 | 0.90 | 0.90 | 0.94 | **0.92** | 6,792 |
| Support 1700–1720 | 3 | 2,642 | 2.03 | 1.85 | 1.17 | **1.85** | 4,884 |
| Support 1720–1750 | 10 | 3,677 | 1.52 | 1.52 | 1.21 | **1.52** | 5,258 |
| Support 1750–1780 | 14 | 5,153 | 1.14 | 1.14 | 1.05 | **1.14** | 5,570 |
| Support 1780+ | 12 | 7,659 | 0.78 | 0.78 | 0.91 | **0.78** | 5,900 |

"First model" priced honing on the upper ladder whatever the set; "gear sets"
priced each piece on its own set; "matched partner" added the gems'
attack-power half and paired each character with the median partner of its
item-level band; "now" keeps the gems and drops the pairing for one fixed
partner. (The very first design anchored on one whale — Paroxysmal scoring
exactly his CP — and put the middle band 22% over CP; the panel fit replaced
it.)

The gear-set fix is the whole change at 1700–1720 between the first two
columns: those characters are on the lower set and were being priced as if
their +18 were an upper-set +18 (ilvl 1765). The gems' attack-power half moves
the DPS bands by one to three points (1.43 / 1.10 / 1.02 / 0.90 to 1.41 / 1.07 /
1.02 / 0.92). The matched partner had narrowed the
support curve most, because it scored each support with a dealer of its own
tier; with one fixed dealer a support's score is its buffs alone, and a
support's gear moves the party's damage far less than a dealer's gear moves
its own, so the support curve is flat again.

**What is left.** Against lopec's ~0.95 the DPS bands run +13% (1720–1750),
+8% (1750–1780) and −3% (1780+), with 1700–1720 at 1.41; the supports sit
between 1.85 and 0.78. That is a tilt, and it is not a system we could still
read: advanced honing is 40 on every upper-set character and the ark passive
trees are full from 1705 up. The cleanest test is two KR dealers lopec shows in
full, with the same relic books (44404 and 44444) and a full ark passive on
both — 구름 (1737.5) and 치즈 (1784.2) — placed by hand on our ladders from
their lopec pages (`tools/.cache` script; bracelet, karma and stone taken
equal):

| system (치즈 minus 구름) | D |
|---|---|
| armour honing (+11 → +21) | 10.5 |
| weapon honing (+16 → an 1800 weapon) | 10.9 |
| skill gems | 10.1 |
| accessories (neck, earrings, rings) | 7.8 |
| ark grid | 4.4 |
| Master | 4.9 |
| fixed partner | 0 |
| **our multiplier** | **48.6 D, ×1.63** (45.6 D, ×1.58 before the gems' attack-power half) |
| lopec | 72.6 D, ×2.07 |
| in-game CP | 67.3 D, ×1.96 |

lopec, like CP, moves about 1.5 times as far as our damage model across the
same systems. Our model prices honing through attack power ∝ √(main stat ×
weapon power), the game's own formula, so a +10 step on every armour piece is
about +10.5% damage, where lopec and CP credit more. On the NA panel the same
factor shows band to band: from 1720–1750 to 1780+ our median multiplier rises
×1.70 (53 D) where CP rises ×2.05 (72 D). The residual at 1700–1720 is the same
effect over a longer span, plus the skill block (tripod and skill levels,
runes) that lostark.bible's CP breakdown shows climbing from ~0.60 of the
whales' at 1710 to ~0.75 at 1720 (`docs/research/combat-power-model.md`) and
that no pull carries.

So a score that stays pure damage times one constant cannot track CP's shape
the way lopec does: either it is damage, and tilts against CP, or it follows
CP, and stops being damage. Until that is decided the number stays beta.

### Checking it

`node tools/verify-loseii-score.js` re-derives every panel member's readings
from its stored records through `lookup.js`, checks the captured constants
(reference, Master, the stat beside the gear, tier-1 evolution), the scale,
the fixed dummy support buff (recomputed from the two models), the cases (the
reference, a weak build, a whale, a mid support, and
real pulls: Paroxysmal, Torchidesu on the lower set, Shizukaziye's bracelet pull
alone), the invariants (every upgrade raises the score; a lower-set piece
scores under the upper piece at a higher item level; no clamp at the ladder
floors; a dealer's score is independent of every support field and of its item
level; a support's is independent of every dealer's item level; the reference
scores exactly K), and runs
the Python twin (`model/loseii_score.py verify`), which re-derives the DPS
tables from `rows-dps.json` and both honing tables itself. `node tools/gem-rows-dps.js --check` keeps the gem rows equal
to their three parts. After an intended
model or table change, `--capture` re-derives the panel and the REFS.

## Open questions

1. **The quality block.** Maxroll carries a second per-honing-level stat block
   beside the honing recipe, and their item tooltip adds it to the ilvl base. On
   that basis a +25 chest reads 142,267 main stat rather than 111,477 and every
   gain rises about 67%. Default is off (`useQualityBlock: false`), matching
   bebkok and the bracelet calculator. Waiting on a reading from a real +25
   piece.
2. **Karma level costs.** The data lists 1 Destiny Stone + 900 gold per attempt
   with a `prob` falling from 20% at level 21 to 0.25% at 29 and **0** at 30,
   plus a `care` field at about half of `prob`. A 0% success at the last level
   cannot be a plain roll, so `care` is presumably the pity path. Unresolved.
