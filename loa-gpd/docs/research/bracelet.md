# Bracelet row — the support ladder

Research for the gold-per-damage chart, 2026-08-13. Numbers only; no model or app
code was touched.

The row the owner asked for:

| rung | what he wrote |
|---|---|
| baseline | 80/80 with one blue s-tier line |
| 2 | 90/90 with two blue s-tier lines |
| 3 | 100/100 with two epic s-tier lines |
| 4 | 110/110 with two legendary s-tier lines |

Short version: the stat numbers in those names are worth almost nothing to the
party — **0.049 points of damage per rung, every rung** — and the lines are worth
thirteen to twenty-six times that. The ladder is a line ladder wearing a stat
ladder's name.

---

## 1. What "80/80" is

The bracelet carries three kinds of line (Stove disclosure page, transcribed in
`loa-bracelet-calc/docs/research/official-probabilities.md`):

| category | draw weight | cap on one bracelet |
|---|---|---|
| basic — Str/Dex/Int or Vitality | 35% | 2 |
| combat trait — Crit, Spec, Domination, Swiftness, Endurance, Expertise | 35% | 2 |
| special effect — 33 families x 3 tiers | 30% | 5 |

"80/80" is the pair of **combat trait** lines. Nothing else on the bracelet rolls
in that range:

| grade | combat trait range |
|---|---|
| Relic | 41–100 |
| Ancient | 61–120 |

Confirmed three ways: the Stove table; Maxroll's bracelet guide ("Relic Bracelets
can roll up to 100... Ancient Bracelets can roll up to 120"); and Maxroll's own
planner feed cached at `tools/.cache/stats.json`, where the T4 bracelet tables
`itemRandom["213300023#5"]` (Relic) and `["213400023#6"]` (Ancient) read

```
Combat Stats  ratio 35  count 2   six options, stat ids 15-20
   relic   value 100, deviation 59   ->  41-100
   ancient value 120, deviation 59   ->  61-120
```

Stat ids decode through the enum in `tools.js`: 15 CRITICALHIT, 16 SPECIALTY
(Specialization), 17 OPPRESSION (Domination), 18 RAPIDITY (Swiftness), 19
ENDURANCE, 20 MASTERY (Expertise). The same feed reproduces the whole Stove
special table — every value and every listed probability — so the two sources
agree exactly. Details in section 6.

**Which two a support wants.** Maxroll's Tier 4 Bard guide: "the primary goal is
obtaining Swiftness and Specialization as main stats." So 80/80 means
**Spec 80 / Swiftness 80**. A bracelet never rolls the same trait family twice,
so Spec cannot appear on both lines.

**What each is worth to the party.**

*Specialization* — yes, it pays. It enters `support.js` only through
`specEff = spec * classCoeff`, which multiplies the Serenade and Major Chord
terms inside the identity bracket:

```
seren = 0.15 * (1 + allyDmg) * (1 + specEff)
chord = 0.02 * (1 + allyDmg) * (1 + specEff)
```

With the accessory calculator's Bard coefficient (0.0005005722461 per point) and
its spec 1100 default:

```
+10 spec  ->  +0.0494 points of damage
1 point   ->  +0.00494
```

Near enough linear over 1020–1140, so the whole 80 -> 110 climb is worth
**0.148 points**.

*Swiftness* — **zero**. It touches none of `ap`, `brand` or `identity`, so on
this axis it hands the party nothing. Say so plainly in the chart. The honest
caveat: in the real game Swiftness shortens the support's buff cycle, which would
raise the uptime numbers the model takes as fixed inputs (`upAp` 95, `upSeren`
70, `upChord` 70, `upTskill` 40). The model cannot see that, so Swiftness is
under-priced here rather than genuinely worthless.

*Crit, Domination, Endurance, Expertise* — zero for a support, no caveat.

---

## 2. Blue / epic / legendary, and which lines are s-tier

Every special effect rolls at one of three tiers. The Stove page calls them
low / mid / high (하급 / 중급 / 상급); Maxroll calls them "Heroic, Epic and
Legendary"; the in-game tooltip colours them, which is where "blue" comes from.
The same three things:

| owner's word | Stove | Maxroll | draw weight within a family |
|---|---|---|---|
| blue | low (하급) | Heroic | 6 |
| epic | mid (중급) | Epic | 3 |
| legendary | high (상급) | Legendary | 1 |

The 6 / 3 / 1 split holds for every one of the 33 families, in both grades.

**Ancient is one tier better at the same name.** Ancient low equals Relic mid,
Ancient mid equals Relic high, and Ancient high is a new step above anything a
Relic can roll. So "legendary" on an Ancient bracelet beats "legendary" on a
Relic.


> **CORRECTION (2026-08-14).** The per-line table below was derived by hand and is
> wrong for families 17 and 19 at the low and mid tiers. At 90% crit / 280% crit
> damage the ally crit factor is 2.620, so a point of crit rate is worth 0.68702%
> and a point of crit damage exactly half that, 0.34351%. Family 19's roll is
> exactly twice family 17's at low (3.6 against 1.8) and mid (4.2 against 2.1),
> so the two lines are **identical** at those tiers, not 4.5% apart. They diverge
> only at high, where 4.8 against 2.5 is 1.92x rather than 2x, leaving 19 at
> 0.9993 of 17. The shipped model in `model/bracelet.js` is correct — it was
> regenerated from the bracelet calculator's own `allyCritFactor` by
> `tools/regen-support-lines.js`. Read the numbers from there, not from here.
>
> Worth knowing why the hand derivation missed it: the accessory calculator's
> crit factor carries a x1.12 term (`cr*cd*1.12 + (1-cr)`) while the bracelet
> calculator's does not (`(1-cr) + cr*cd`). Under the accessory form the ratio is
> 2.119 rather than 2.000 and the two families would differ by 5.6%. Bracelet
> lines are scored with the bracelet calculator's model, so 2.000 is the one that
> applies here — but the two house tools genuinely disagree about the crit factor.

### The support's s-tier pool

Scored on `Q = 100*ln(ap * brand * identity)` at the reference character in
section 3. Points of damage, per line, above no line at all:

| # | line | relic low / mid / high | ancient low / mid / high | channel |
|---|---|---|---|---|
| 17 | enemy Crit Resist −A% (1/party); ally AP buff +B% | **1.364 / 1.671 / 1.978** | **1.600 / 1.896 / 2.260** | party crit + `ap` |
| 19 | enemy Crit DMG Resist −A% (1/party); ally AP buff +B% | 1.303 / 1.598 / 1.893 | **1.600 / 1.896 / 2.192** | party crit dmg + `ap` |
| 16 | enemy Defense −A% (1/party); ally AP buff +B% | 1.026 / 1.268 / 1.511 | **1.275 / 1.520 / 1.814** | party def shred + `ap` |
| 18 | shielded-target damage +A% (1/party); ally AP buff +B% | 0.692 / 0.903 / 1.113 | **0.910 / 1.122 / 1.334** | party damage + `ap` |
| 30 | Ally Damage buff effect +X% | 0.609 / 0.811 / 1.013 | **0.809 / 1.010 / 1.211** | `identity` |
| 29 | Ally Attack Power buff effect +X% | 0.546 / 0.727 / 0.908 | **0.741 / 0.926 / 1.110** | `ap` |
| 33 | Weapon Power +X | 0.346 / 0.395 / 0.444 | **0.448 / 0.504 / 0.559** | `ap` |
| — | basic line, Str/Dex/Int (min / mid / max roll) | 0.117 / 0.176 / 0.234 | 0.176 / 0.234 / 0.292 | `ap` |

The bottom two rows feed `Gear` (`braceletWpFlat` and the main-stat pool), not
`Support.lines`. They are real party damage, just small — a legendary Ancient
weapon-power line is worth less than half a blue ally-damage line.

Raw line values, for checking (Relic low/mid/high; Ancient adds one step):

- 17: Crit Resist −1.5/1.8/2.1%, AP buff +1.5/2.0/2.5% (Ancient −1.8/2.1/2.5, +2/2.5/3)
- 19: Crit DMG Resist −3.0/3.6/4.2%, AP buff +1.5/2.0/2.5% (Ancient −3.6/4.2/4.8, +2/2.5/3)
- 16: Defense −1.5/1.8/2.1%, AP buff +1.5/2.0/2.5% (Ancient −1.8/2.1/2.5, +2/2.5/3)
- 18: shielded damage +0.7/0.9/1.1%, AP buff +1.5/2.0/2.5% (Ancient +0.9/1.1/1.3, +2/2.5/3)
- 30: +4.5/6.0/7.5% (Ancient 6.0/7.5/9.0)
- 29: +3.0/4.0/5.0% (Ancient 4.0/5.0/6.0)
- 33: +6,300/7,200/8,100 (Ancient 7,200/8,100/9,000)

Everything else on the bracelet — Vitality, defence, Max HP, crit rate, crit
damage, back attack, outgoing damage, additional damage, party shield and heal —
is **worth nothing to the party from a support**. Crit and additional-damage
lines raise the support's own damage, which nobody counts. Party shield and heal
keeps people alive but is not on this axis. Say that plainly in the chart: a
support bracelet with three fat DPS lines is a blank bracelet.

### Two things to settle before the chart ships

The four combo families (16–19) beat the two clean buff lines (29, 30), because
each carries a party-wide debuff **and** an ally attack-power rider. That rider
does nothing on a damage dealer — only a support's buff scales with it — so those
lines belong on the support and are strictly better there.

But `support.js` has no channel for enemy shred, so the debuff half of families
16, 17 and 19 is scored **outside** it, with the bracelet calculator's own DPS
rules (`damage-model-spec.md`, "Party debuff lines scored for DPS"):

```
crit resist  -A%  -> dealer crit rate +A pp
crit dmg res -A%  -> dealer crit damage +A pp
   crit factor = cr*cd*1.12 + (1 - cr),  cr 90%, cd 280%
defence      -A%  -> gain = (D + K) / (D(1 - A) + K), enemy damage reduction 50%
family 18         -> party-wide +A% at 60% shield uptime
```

Each lands on every dealer, exactly like `ap`, `brand` and `identity`, so folding
it into the same product keeps the `partySize = 3` gold axis honest:

```
Q = 100 * ln( ap * brand * identity * shred )
```

So: **which pair does "two s-tier lines" mean?** Section 3 gives three readings.
My recommendation is the shred pair (17 + 19) as the headline, because that is
what supports actually run, with the clean pair (30 + 29) shown as a floor.

---

## 3. What each rung is worth

**Reference character.** `Support.DEFAULTS` unchanged,
`Gear.stats(data, {}, 25, 25)` — armour and weapon +25, main stat **836,401**,
weapon power **277,674**, `apPct` 0.147, so support base attack **225,664**
against the dealer's 176,777. Bracelet basic (main-stat) lines held fixed across
all four rungs, so they cancel. (Recomputed 2026-08-13 against the current
`gear.js`, which now carries accessory and ark-grid weapon-power flats, feast,
food and the stone/gem attack-power percentage. Every number below moves if that
file moves again.)

**Zero point.** A support with no bracelet at all: Spec 1020, no lines. That puts
rung 1 on the model's own spec 1100 default, so the ladder sits on the accessory
calculator's baseline rather than beside it.

**Grades.** The rung names force this, and it matters:

| rung | Relic possible? | Ancient possible? |
|---|---|---|
| 80/80 | yes, 17.0% per line | yes, 55.3% |
| 90/90 | yes, 7.3% per line | yes, 33.7% |
| 100/100 | only just — 0.667% per line, i.e. exactly 100 | yes, 17.0% |
| 110/110 | **no** — Relic caps at 100 | yes, 7.3% |

So 110/110 is an Ancient bracelet by definition, and 100/100 is one in practice:
on a Relic it needs both trait lines to land on the single top value, one chance
in 22,500 before you ask anything of the lines. The ladder below therefore reads
**Relic for 80/80 and 90/90, Ancient for 100/100 and 110/110**, with two
single-grade controls underneath.

### Headline — shred pair, families 17 + 19

| rung | Q (points of damage) | step |
|---|---|---|
| 80/80 Relic, one blue (17 low) | **1.759** | — |
| 90/90 Relic, two blue (17 + 19 low) | **3.111** | +1.351 |
| 100/100 Ancient, two epic | **4.364** | +1.253 |
| 110/110 Ancient, two legendary | **5.085** | +0.721 |

### Floor — clean buff pair, families 30 + 29

| rung | Q | step |
|---|---|---|
| 80/80 Relic, one blue (30 low) | 1.005 | — |
| 90/90 Relic, two blue | 1.601 | +0.597 |
| 100/100 Ancient, two epic | 2.420 | +0.818 |
| 110/110 Ancient, two legendary | 2.854 | +0.435 |

### Mixed — 17 crit-resist + 30 ally-damage

| rung | Q | step |
|---|---|---|
| 80/80 Relic, one blue (17 low) | 1.759 | — |
| 90/90 Relic, two blue | 2.419 | +0.660 |
| 100/100 Ancient, two epic | 3.490 | +1.071 |
| 110/110 Ancient, two legendary | 4.122 | +0.632 |

### Single-grade controls (shred pair), to show what the grade change costs

| rung | all Relic | all Ancient |
|---|---|---|
| 80/80, one blue | 1.759 | 2.067 |
| 90/90, two blue | 3.111 | 3.713 |
| 100/100, two epic | 3.763 | 4.364 |
| top rung, two legendary | 4.364 (100/100 Relic) | 5.085 |

### Where each step comes from

The headline ladder, split into the stat half and the line half:

| step | total | from +10 Spec | from the lines |
|---|---|---|---|
| 80/80 -> 90/90 | +1.351 | +0.049 | +1.302 |
| 90/90 -> 100/100 | +1.253 | +0.049 | +1.204 |
| 100/100 -> 110/110 | +0.721 | +0.049 | +0.672 |

The stat numbers carry **4 to 7% of the step**. Worth saying out loud on the
chart: people shop for bracelets by the trait number and pay for the wrong thing.

### Working, one rung end to end

110/110 Ancient with two legendary lines, families 17 and 19:

```
line 17 high (Ancient):  crit resist -2.5%,     ally AP buff +3.0%
line 19 high (Ancient):  crit dmg resist -4.8%, ally AP buff +3.0%
traits: Spec 110 (Swiftness 110 scores 0)

spec        = 1020 + 110 = 1130      specEff = 1130 * 0.0005005722461 = 0.56565
allyAtkEnh  = 0.6825 + 0.030 + 0.030 = 0.7425
supAtk      = sqrt(277674 * 836401 / 6) * 1.147 = 196,743 * 1.147 = 225,664
dpsAtk      = sqrt(250000 * 750000 / 6) = 176,777

apMult = ((176777 + 225664*0.22*1.7425)*1.1333 + 2700)
       / ( 176777*1.1333 + 2700)
ap     = 1 + 0.95 * (apMult - 1)
brand  = 1 + 1.00 * 0.10 * (1 + 0.4313)          (no bracelet line feeds brand)
seren  = 0.15 * (1 + 0.3713) * (1 + 0.56565)
chord  = 0.02 * (1 + 0.3713) * (1 + 0.56565)
tsk    = 0.10 * (1 + 0.0713)
identity = 1 + (0.70*seren + 0.70*chord + 0.40*tsk) / 1.3585

critFactor = 0.9 * 2.8 * 1.12 + 0.1 = 2.9224
shred      = (0.925*2.8*1.12 + 0.075) / 2.9224     crit resist -2.5 pp
           * (0.9*2.848*1.12 + 0.1)  / 2.9224      crit dmg resist -4.8 pp

Q = 100*ln(ap * brand * identity * shred) - Q(no bracelet) = 5.085
```

The scripts that produced every table above sit in the session scratchpad
(`all.js`, `prob2.py`, `slotp.py`); they require `model/support.js` and
`model/gear.js` straight from this repo and hardcode nothing.

**Gear sensitivity.** The top rung reads 5.018 at +21 gear, 5.051 at +23 and
5.085 at +25 — about 1% across the whole honing range, because the ally
attack-power rider is the only part that cares. Any reference level will do.

---

## 4. Gold

**Recommended basis: the market price of a finished bracelet, snapshotted per
rung.** Not the cost of rolling. Here is why.

Rolling costs almost nothing per attempt — silver, plus up to three extra
attempts from Bracelet Effect Reconversion Tickets, which drop from Kazeros Raid:
Brelshaza. The bracelet calculator already made that call: rerolls are
essentially free, and the cost is the bracelet itself. What is expensive is the
number of bracelets you burn.

**Per granted slot, per roll**, from the official granted table (special category
30%, listed percentage over the page's 100.00016 sum):

| family | blue | epic | legendary |
|---|---|---|---|
| 16, 17, 18, 19 (each) | 0.150% — 1 in 667 | 0.075% — 1 in 1,333 | 0.025% — **1 in 4,000** |
| 29, 30 (each) | 0.327% — 1 in 306 | 0.164% — 1 in 611 | 0.055% — 1 in 1,834 |

Two granted slots, seven attempts, locking what you like: about 14 slot draws.
Chance a single fresh bracelet ends with two s-tier lines at the named tier:

| target | wide pool (16/17/18/19/29/30) | narrow pool (17 + 19) |
|---|---|---|
| two blue | 1.30% — 1 in 77 | 0.080% — 1 in 1,251 |
| two epic | 0.341% — 1 in 294 | 0.020% — 1 in 4,943 |
| two legendary | 0.039% — **1 in 2,556** | 0.0023% — **1 in 44,136** |

And that ignores the traits. Rolling a whole rung out of one fresh bracelet,
traits and lines together, with no locking:

| rung | chance per fresh bracelet |
|---|---|
| 80/80 Relic, one blue s-tier | 1 in 146,000 (wide pool) |
| 90/90 Relic, two blue | 1 in 308 million |
| 100/100 Relic, two epic | 1 in 233 billion |
| 110/110 Ancient, two legendary | 1 in 2.4 billion |

Those are joint, unlocked, single-roll numbers — a floor, not the real figure.
Locking and seven attempts lift them, and the exact number is a job for the
bracelet calculator's own DP, which already handles lock masks and
keep-or-replace. But the order of magnitude settles the question: **nobody rolls
into rung 3 or rung 4. They buy them.**

So price each rung as the market price of the bracelet, and put the rolling
number beside it as a ceiling:

```
ceiling(rung)   = price of a blank bracelet of that grade / P(rung | 7 attempts, optimal play)
gold per damage = gold / (Q * partySize)        partySize = 3
```

I could not find published gold prices for these. Bracelets carry random options,
so they trade on the auction house, not the commodity market — the loa-buddy
market feed the other tools use does not carry them. Two ways to get real
numbers:

1. **In-game snapshot.** Search the auction house per rung and record the
   cheapest listing. Slowest, most honest.
2. **Official Open API**, `POST /auctions/items` on
   developer-lostark.game.onstove.com. It filters by category and by item
   options, which is what a per-rung query needs. I did not confirm the bracelet
   CategoryCode or the exact option-filter shape, so check both before wiring it
   up. The chart already carries an OAuth app from the astrogem work.

One warning for the market basis: at rungs 3 and 4 the supply is a handful of
items per server. A "price" there is one listing, not a market, and gold per
damage computed from it will swing hard week to week. Consider marking those two
rungs on the chart as estimates.

---

## 5. What else the owner should know

**Families 16, 17, 18 and 19 are one per party.** The tooltip is explicit: "This
effect is limited to a single application per party." If a damage dealer in the
group already runs the same family, the support's copy contributes only its ally
attack-power rider, and the headline ladder collapses to roughly a third of its
value. The bracelet calculator already has the switch (`supportHasEffects`); the
chart needs the same one, or at least a footnote. They are different families, so
one support can carry two of them (17 and 19) without clashing with itself.

**The rider is support-only.** "Ally Atk. Power Enhancement +B%" scales the buff
a support hands out and does nothing on a damage dealer. That is the argument for
the support being the party's carrier of these lines, and it is worth a sentence
on the chart.

**Rung 4 needs four specific lines on one bracelet.** Two traits plus two
specials, and the special lines can only arrive in granted slots — the fixed pool
is families 1–10 only. On a Relic that forces two fixed lines (35%) that both
happen to be traits, plus two granted slots (25%) that are both s-tier. Ancient's
three-granted-slot roll (25%) opens a second route. Either way it is a four-line
bracelet, and the ideal is what the community calls "2 combat stats + 3 hidden
options".

**The grade change is doing work the rung name hides.** Going 100/100 -> 110/110
means Relic -> Ancient anyway, and Ancient carries 18 Leap Points against Relic's
9, plus one free tier step on every special line. To price the *stat* ladder,
hold the grade fixed and use the all-Relic or all-Ancient control table in
section 3. I have not priced Leap Points on this axis; for a support they feed
the Leap tree, whose payoff (Ultimate Awakening damage) the methodology already
scores at zero, so the gap is probably small — but it is unchecked.

**Maxroll's Bard bracelet list is stale.** The Tier 4 Bard guide names "Cheers,
Dagger, Expose Weakness, Enlightenment, MP Recovery" — those are Tier 3 bracelet
effect names. Cross-referencing Maxroll's own data feed: Dagger is the enemy
Defense line (T4 family 16), Open Weakness is the enemy Crit Resistance line
(family 17), Cheers is the shielded-target damage line (family 18), and
Enlightenment is a Specialty Meter gain effect with no T4 equivalent in that
list. Cite the effects in the chart, not the guide's names.

**The support side of the bracelet calculator is still a stub**, and its
placeholders are well off. `allyApBuffDamagePerPct: 0.45` and
`allyDamageBuffDamagePerPct: 0.30` give a legendary Relic family-30 line
7.5 x 0.30 = 2.25 points; this model gives 1.013. `traitWeights.spec = 0.025` per
point gives a Spec 110 line 2.75 points; this model gives 0.543 above no bracelet
at all. If that calculator's support mode ever ships, the per-line table in
section 2 is the replacement.

**Open question I could not close.** The gold cost of a reroll, and whether a
bracelet binds once rolled. Maxroll says rolling costs silver; the official
Frosty Fate notes describe keep-or-replace and the three ticket rerolls but give
no cost and say nothing about binding. If bracelets bind on the first roll, the
market basis above only ever prices unrolled bracelets plus whatever the seller
already rolled, which changes how rungs 3 and 4 should be quoted.

---

## 6. Cross-check: Maxroll's feed against the Stove page

Worth recording, because it makes the probability table independent of a single
source. `tools/.cache/stats.json`, key `itemRandom`:

- `213300023#5` is the T4 **Relic** bracelet, `213400023#6` the T4 **Ancient**.
  (`213300013#5` and `213400013#6` are the T3 pair — same trait ranges, different
  special values. Do not mix them up.)
- Three groups, `ratio` 35 / 35 / 30 and `count` 2 / 2 / 5 — the category weights
  and the caps, exactly as the Stove page states them.
- Basic effects: Relic main stat value 12800 deviation 6400 -> 6,400–12,800;
  Vitality 5000 +/- 2000 -> 3,000–5,000. Matches.
- Combat stats: Relic 100 +/- 59 -> 41–100, Ancient 120 +/- 59 -> 61–120. Matches.
- Specials: 99 options = 33 families x 3 tiers. The `ratio` field takes exactly
  three values by family block — 2772/1386/462 for ten families, 720/360/120 for
  eleven, 330/165/55 for twelve. Normalised over the 66,000 total those are
  4.2/2.1/0.7, 1.0909/0.5455/0.1818 and 0.5/0.25/0.08333 — the Stove **granted**
  percentages to the digit, summing to 100.000. The feed does not carry the
  separate fixed-line pool (6/3/1 over families 1–10); the Stove page is the only
  source for that.
- Spot-checked descriptions from `combatEffectDesc`, all matching: "On hit,
  target's Crit Resistance -2.5% for 8s. This effect is limited to a single
  application per party. Ally Atk. Power Enhancement +3%." (family 17, Ancient
  high), and families 29 and 30 stored as raw stats 300/400/500 and 450/600/750
  tenths of a percent.

---

## Sources

- Stove official probability page, T4 bracelet (revised 2025-12-30), transcribed
  in `loa-bracelet-calc/docs/research/official-probabilities.md`:
  https://m-lostark.game.onstove.com/Probability/%ED%8C%94%EC%B0%8C%20T4
- Maxroll, Bracelet System Guide: https://maxroll.gg/lost-ark/resources/bracelet-system-guide
- Maxroll, Tier 4 Bard Build Guide: https://maxroll.gg/lost-ark/build-guides/tier-4-bard-build-guide
- Lost Ark official release notes, Frosty Fate (Relic from Normal, Ancient from
  Hard; keep-or-replace; three ticket rerolls from Brelshaza):
  https://www.playlostark.com/en-us/game/releases/frosty-fate
- Vortex Gaming, T4 bracelet discussion ("2 combat stats + 3 hidden options";
  Ancient 120 / Relic 100): https://vortexgaming.io/en/postdetail/407433
- Lost Ark Codex, Bracelet Bonus Rework Ticket: https://lostarkcodex.com/us/item/52324202/
- Lostark Open API developer portal: https://developer-lostark.game.onstove.com/
- Local: `loa-gpd/model/support.js`, `loa-gpd/model/gear.js`,
  `loa-gpd/docs/METHODOLOGY.md`, `loastuff/lost-ark-accessories/METHODOLOGY.md`
  section 3, `loa-bracelet-calc/docs/research/damage-model-spec.md`,
  `loa-bracelet-calc/data/bracelet-data.js`, `loa-gpd/tools/.cache/stats.json`.
