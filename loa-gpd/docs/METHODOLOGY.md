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
