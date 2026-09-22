# Ability stone — 7/7 up to 9/7, for a support

Research note for the gold-per-damage chart. Nothing here changes model or app code.

Data sources: the official Korean game guide and the official probability disclosure page
(both authoritative), Maxroll's written guides and build guides, Maxroll's planner feed
(`tools/.cache/stats.json` and `items.json`, keys `engraving`, `engravingStone`, and the
`abilityStone` block on the stone items), and Korean community maths on Inven.

**Bottom line. The whole ladder from 7/7 to 9/7 is worth exactly one thing to a party:
crossing to a combined faceting level of 5, which grants +1.5% *basic* attack power. That
does reach the party — basic attack power is the quantity the support's ally attack-power
buff is built from — and it is worth about +0.39 damage on the house scale. Nothing else on
the stone touches the party. The two engravings a support cuts (Awakening, Magick Stream,
Expert, Drops of Ether) feed none of the three channels, so every rung below level 5 is worth
zero and 8/7 is worth exactly what 7/7 is worth. The step is also not buyable: a faceted stone
is one-shot, and the official probability table puts a level-5 cut at 0.13793% per stone —
one stone in 725. I recommend charting it as `725 x (all-in cost of one uncut Ancient stone)`
with the stone price as an editable input, and warning the reader that the row is a lottery
ticket, not a purchase.**

---

## 1. What a T4 stone is, and what "7-7" counts

A Tier 4 ability stone is the **Great Stone of Soaring** (Ancient grade, item `9104550`). It
carries **two positive engravings and one negative**, all three assigned at random when the
stone drops. Faceting (세공) at the Ability Stone Cutter lights nodes on the three lines; a
stone has **10 nodes per line** (`abilityStone.maxOrbCount = 10`).

The official guide states the level rule in one line each:

> 증가 효과 각인(전투 각인): 세공 성공 6/7/9/10회마다 세공 레벨 1/2/3/4레벨에 해당하는
> 어빌리티 스톤 효과가 부여됩니다.
> — positive engravings: 6/7/9/10 successes give faceting level 1/2/3/4.

> 감소 효과 각인(페널티 각인): 균열 성공 5/7/10회마다 세공 레벨 1/2/3레벨에 해당하는
> 감소 효과가 부여됩니다.
> — the negative: 5/7/10 cracks give level 1/2/3.

Source: [official game guide, 각인](https://m-lostark.game.onstove.com/GameGuide/Pages/%EA%B0%81%EC%9D%B8)
(last edited 2026-06-24). Maxroll's
[Ability Stone System Guide](https://maxroll.gg/lost-ark/resources/ability-stone-system-guide)
(2026-02-02) gives the same 6/7/9/10 and 5/7/10.

So **"9/7" is node counts, not levels**: 9 successes on one positive line, 7 on the other,
which is level 3 + level 2 = **combined level 5**. That mapping decides the whole ladder:

| Cut | Levels | Combined | New for the party? |
|---|---|---|---|
| 6/6 | 1 + 1 | 2 | — |
| 7/6 | 2 + 1 | 3 | — |
| **7/7** | 2 + 2 | **4** | — |
| **8/7** | 2 + 2 | **4** | **nothing. 8 nodes is still level 2** |
| 8/8 | 2 + 2 | 4 | nothing |
| 9/6 | 3 + 1 | 4 | nothing |
| **9/7** | 3 + 2 | **5** | **+1.5% basic attack power** |
| 10/6 | 4 + 1 | 5 | same as 9/7 |
| 9/8, 9/9, 10/7 and up | | 5–8 | same as 9/7 — the bonus does not grow |

Two things follow, and both matter for the chart.

1. **8/7 and 8/8 are not rungs.** They are 7/7 with wasted nodes. Only 6, 7, 9 and 10 do
   anything, so the real ladder is 7/7 → 9/7 with nothing in between.
2. **There is no rung above 9/7 either.** The rule is "5 or higher"; 9/9 and 10/10 pay the
   same +1.5%. Above level 5 the only gain is the engraving effects themselves, which for a
   support are worth nothing (§3).

**Negatives still exist in T4.** The planner's stone tables list four of them
(`engravingStone` key `4010` → ids 1800–1803): Atk. Power Reduction, Defense Reduction,
Atk. Speed Reduction, Move Speed Reduction, at −2/−4/−6%, −5/−10/−15%, −2/−4/−6% and
−2/−4/−6% for levels 1/2/3. **None of them cost a support any party damage.** The attack-power
malus is 공격력, not 기본 공격력, so it does not shrink the ally buff; defence is free;
attack and move speed are quality of life. A support can take any malus without paying for it
on this chart. (The negative only applies at all if the same engraving is one of the five you
have selected — official guide, same page.)

There is also a **step bonus** unrelated to engravings: the stone's own Vitality grows with
the total nodes lit on the two positive lines. `items.json` gives the Great Stone of Soaring
23,481 CON base and a `carve` block of 1,175 / 2,350 / 3,525 at **14 / 15 / 16 total nodes**
(+5% / +10% / +15%). That is the 7/7 → 8/7 → 9/7 ladder in disguise, and it is the reason
those three cuts get talked about as separate things. It is Max HP. **Zero damage.**
(Maxroll's own tooltip code maps the three thresholds to the three values in reverse — more
nodes, less HP — which is plainly a bug on their side; the ascending reading is the one to
trust.)

---

## 2. The +1.5%, and whether it reaches a support

The bracelet calculator's `baseline-derivation.md` records the rule as "+1.5% attack power
once the two engraving levels total five or more (9/7, 10/6, 9/9 and up; 9/6, 8/7 and 7/7 pay
nothing)". **That is right, and the thresholds are right.** But the English wording hides the
detail that decides the whole question, and the Korean does not:

> 아울러 어빌리티 스톤에 부여된 2개의 증가 효과 각인(전투 각인)의 세공 레벨 합이 5 이상이라면
> **기본 공격력 1.5% 증가** 효과가 적용됩니다.

Source: [official game guide, 각인](https://m-lostark.game.onstove.com/GameGuide/Pages/%EA%B0%81%EC%9D%B8).

It is **basic attack power** (기본 공격력), not attack power (공격력). That distinction is the
whole support question, because the ally attack-power buff is built from basic attack power
and ignores everything layered on top of it:

> 무공과 지능으로 오른 '기본공격력'은 적용되지만, 거기서 뻥튀기시켜주는 공증요소는 적용되지
> 않습니다 … 저주받은 인형이나 아드레날린, 에테르 포식자와 같이 공격력 증가 각인이 버프에
> 적용되지 않습니다.
> — basic attack power from weapon power and main stat counts; the multipliers stacked on it
> do not. Cursed Doll, Adrenaline and Ether Predator do not feed the buff.

Source: [Inven, 서포터 아군 공격력 강화/피해량 강화 효율](https://www.inven.co.kr/board/lostark/4821/100314).
An English write-up of the same mechanic says it from the other side, and names the stone:
"basic attack power is determined by the supporter's weapon attack, strength/dexterity/
intelligence, **gems, and ability stone**" —
[Vortex Gaming, Support Buffs Analysis](https://vortexgaming.io/en/postdetail/502641).

So: **the +1.5% applies to supports, and it is the only part of the stone that does.** In the
house model it multiplies `supAtk` — the `baseAtk(wp, ms)` term in
`model/support.js` — before the 0.22 share is taken. `support.js` has no such term today; the
model would need one to chart this row (see §6).

### What it is worth

Running `contribution()` with `supAtk` scaled by 1.015 and everything else at
`Support.DEFAULTS`:

| Support gear | supAtk | D of +1.5% basic atk |
|---|---|---|
| accessory-calculator baseline (WP 250,000 / MS 750,000) | 176,777 | **0.386** |
| `Gear.stats` at armour +11 / weapon +11 | 134,101 | 0.312 |
| `Gear.stats` at armour +15 / weapon +15 | 149,089 | 0.339 |
| `Gear.stats` at armour +21 / weapon +25 (the bracelet-calc baseline, ilvl 1785) | 180,818 | **0.392** |
| `Gear.stats` at armour +25 / weapon +25 | 189,023 | 0.405 |

It grows with the support's own gear, because the buff is a fixed share of a bigger number.
**Use 0.39 for the chart's default character**, and note the row moves with the honing row.

On the gold axis the party multiplier applies as usual, so the step is worth
`0.39 x 3 = 1.18` party damage.

---

## 3. What a support actually cuts, and why none of it is damage

Class engravings do not live on stones any more. The planner's T4 stone pool
(`engravingStone` key `4000`) is **43 generic combat engravings** and nothing else. I read
the stone row (`spec[0]`) off every one of them. Maxroll's Bard and Paladin support guides
both give the identical core four, and the fifth slot is a flex pick:

> "Awakening, Magick Stream, Expert, Drops of Ether", fifth slot from Max MP Increase /
> Vital Point Hit / Explosive Expert / Heavy Armor.

Sources: [Support Bard](https://maxroll.gg/lost-ark/build-guides/support-bard-raid-guide),
[Support Paladin](https://maxroll.gg/lost-ark/build-guides/support-paladin-raid-guide).
A Korean write-up of T4 stones recommends the same short list for supports — 각성 (Awakening)
first, then 구슬동자 (Drops of Ether) and the mana engravings:
[Inven, 티어4 어빌리티 스톤은 어떻게?](https://www.inven.co.kr/webzine/news/?news=297378&site=lostark).

Here is what each level of the stone bonus buys, and what it feeds:

| Engraving | Stone bonus at level 1 / 2 / 3 / 4 | ap | brand | identity |
|---|---|---|---|---|
| Awakening | Awakening cooldown −6 / −7.5 / −10.5 / −12% | — | — | — |
| Magick Stream | MP recovery +0.6 / 0.75 / 1.05 / 1.2% per stack | — | — | — |
| Expert | shield and heal effectiveness +4 / 5 / 7 / 8% below 50% HP | — | — | — |
| Drops of Ether | Ether effectiveness +12 / 15 / 21 / 24% | — | — | — |
| Max MP Increase | Max MP +4 / 5 / 7 / 8% | — | — | — |
| Vital Point Hit | stagger +4 / 5 / 7 / 8% | — | — | — |
| Heavy Armor | all defence +12 / 15 / 21 / 24% | — | — | — |
| Explosive Expert | bomb and grenade damage +40 / 50 / 70 / 80% | — | — | — |

**Every cell is empty. None of these engravings raises the support's basic attack power, ally
attack-power enhancement, brand power, or ally damage.** So a stone engraving going from level
2 to level 3 is worth **exactly zero** party damage. That holds for Bard, Paladin, Artist and
Valkyrie alike — not because their lists happen to match, but because no engraving in the
43-strong pool feeds those three channels for the wearer.

Two honest footnotes on that claim:

- **Crushing Fist** is the one engraving in the pool that touches party damage at all:
  "Countered target takes +3 / 3.75 / 5.25 / 6% Damage from all party members" on top of an 8%
  base. It is a fourth channel the house model does not have, it needs a landed counter, and
  no support build runs it. Ignore it, but know it exists.
- **Drops of Ether** hands one Ether to the party. Ethers give the picker a random 30-second
  buff and one of the possible orbs is +10% attack power
  ([Fandom, Drops of Ether](https://lostark.fandom.com/wiki/Drops_of_Ether)). If "Ether
  effectiveness" scales the buff's size, then level 2 → level 3 (+15% → +21%) moves a dealer's
  strength orb from +11.5% to +12.1% attack power while it is up. Multiply by the chance the
  orb is a strength orb and by how much of the fight a dealer is holding one, and a generous
  reading lands near +0.1 damage — a quarter of the whole 9/7 step. A stingy reading lands
  near zero. This sits in the dealer's own attack-power bucket, not in any of the three
  channels, and the house model has no place to put it. **Recommendation: leave it at zero and
  say so in the chart's footnote**, because the inputs are guesses and the effect is a random
  pickup, not a buff the support controls.

---

## 4. What it costs: the faceting maths

### The mechanic

Every attempt lights or fails one node on the line you pick, and the stone is finished when
all thirty nodes are spent. The rate is shared across the three lines:

> "Your initial attempt always has a 75% chance to succeed." … "Unlocking a point reduces the
> success rate of your next attempt by 10%, while raising it by 10% after failed attempts" …
> "This success rate can never go below 25% or exceed 75%."

Source: [Maxroll, Ability Stone System Guide](https://maxroll.gg/lost-ark/resources/ability-stone-system-guide).

That chain sits at a mean success rate of exactly 50%, so a whole stone lights about fifteen
of its thirty nodes. Wanting sixteen of them on two lines is why 9/7 is hard. All the skill
in faceting is choosing which line eats a roll — you dump the low-rate rolls into the negative
line, where a failure is a good outcome and also pushes the rate back up.

### The official numbers

The game publishes the full outcome distribution for **auto-faceting**, which by its own
description plays this optimally for a combined level of 5:

> 특정 각인을 우선시하지 않고, 각인 합산 Lv.5 이상이 나오도록 성공 확률을 극대화한 방식이
> 적용됩니다.
> — it does not favour either engraving; it maximises the chance of coming out at combined
> Lv.5 or higher.

Source: [official probability disclosure, 어빌리티 스톤 자동 세공](https://m-lostark.game.onstove.com/Probability/%EC%96%B4%EB%B9%8C%EB%A6%AC%ED%8B%B0%20%EC%8A%A4%ED%86%A4%20%EC%9E%90%EB%8F%99%20%EC%84%B8%EA%B3%B5)
(last edited 2025-12-10). The page carries four tables, one per 세공 기회 (nodes per line):
10, 9, 8, 6 — which is exactly the `maxOrbCount` ladder in the item data for Relic/Ancient,
Legendary, Epic and Rare. T4 Ancient stones are always the 10 table.

Summing that table's 1,331 rows (it sums to 99.999%, the rounding the page warns about):

| Combined level | P(exactly) | P(at least) | Stones to first reach it | Extra stones over the rung below |
|---|---|---|---|---|
| 0 | 6.0664% | 99.999% | 1.00 | — |
| 1 | 20.7847% | 93.933% | 1.06 | 0.06 |
| 2 | 49.6437% | 73.148% | 1.37 | 0.30 |
| 3 | 18.8161% | 23.504% | 4.25 | 2.89 |
| **4 (7/7, 8/7, 9/6)** | 4.5501% | **4.68808%** | **21.33** | 17.08 |
| **5 (9/7, 10/6)** | 0.1341% | **0.13793%** | **725.00** | **703.67** |
| 6 (9/9, 10/7) | 0.003812% | 0.0038251% | 26,143 | 25,418 |
| 7 (10/9) | 0.0000132% | 0.0000134% | 7.49 million | — |
| 8 (10/10) | 0.00000015% | 0.00000015% | 667 million | — |

Among the level-5-and-up cuts, 76.2% are 9/7 and 13.9% are 10/6; 98.3% of them come out with
no malus at all.

**Independent checks, both clean.**

- I rebuilt the mechanic from scratch as a dynamic program — state `(nodes used and lit on
  each of the three lines, current rate)`, 30 steps, choose the line that maximises the chance
  of the goal — and it returns **0.0013793** for combined level ≥ 5 and **0.00003825** for
  ≥ 6. The official page says 0.13793% and 0.003825%. Four significant figures on both. The
  75% / ±10 / [25,75] rule is therefore still the live rule in T4, and auto-faceting really is
  optimal for the level-5 goal.
- A Korean player ran the same table and reports "97돌 확률: 약 0.1379%", about 735 stones, and
  0.003825% for 10/7 and 9/9:
  [Inven, 오피셜) 어빌리티 스톤 자동 세공 기대값을 알아보자](https://www.inven.co.kr/board/lostark/6271/3055441).

One more number worth having, because it is the step bonus from §1 rather than the engraving
levels: **total** positive nodes of 14 / 15 / 16 come out at 8.598% / 1.732% / 0.204%. Note
that 16 total nodes is *not* the same event as combined level 5 — 8/8 is sixteen nodes and
only level 4.

### Cost per stone

- **Faceting itself costs silver, not gold.** Maxroll lists 150 / 165 / 210 / 260 silver per
  attempt for Rare / Epic / Legendary / Relic; it does not give the Ancient figure. Thirty
  attempts is a few thousand silver either way. **Treat as free on a gold chart.**
- **There is no re-facet.** The stone is one-shot: "세공을 완료해야만 장착할 수 있으며" and a
  finished stone stays finished. Failed stones get broken down into 거룩한 초월의 가루 (Sacred
  Powder of Mystery), which is also the material for upgrading a T3 stone to T4 — official
  guide, same page. So every attempt at level 5 costs a whole stone.
- **Where stones come from.** The Great Stone of Soaring drops from T4 Guardian Raids, North
  Kurzan field bosses, Behemoth, and the Kazeros raids (Overture, Act 1, Act 2). Unidentified
  ones are also sold by the Ability Stone Cutter, by the Solo Mode growth boost, and at the
  Clear Medal exchange (`items.json`, item `9100562`). Most of a player's supply is dropped,
  not bought.
- **The auction house sells ability stones** — "경매장에서는 장비, 어빌리티 스톤, 장신구,
  보석의 거래가 가능합니다" —
  [official guide, 거래소](https://m-lostark.game.onstove.com/GameGuide/Pages/%EA%B1%B0%EB%9E%98%EC%86%8C) —
  with a trade-limit level of 1640 on the T4 stone. Buying costs gold plus Pheons.

### The one thing I could not pin down: can you buy a finished 9/7?

Evidence both ways, and it changes the chart's shape, so do not let me settle it for you.

- **Against.** Faceting is one-shot and failed stones are fed to the grinder for powder. If a
  7/7 could be sold, nobody would grind one. A recurring Korean question thread is about
  ability stones that are "거래불가 파괴불가 분해불가" — untradeable, indestructible,
  undisassemblable — which reads like a cut stone. And an English guide states it flatly:
  "Once they are Faceted, they are equippable but untradable"
  ([PCGamesN](https://www.pcgamesn.com/lost-ark/ability-stone-facet)), though that page is old.
- **For.** Maxroll says "Consider selling those you can't benefit from on the Auction House,
  as other players can!", which could equally mean uncut stones carrying a desirable engraving
  pair. LOAWA keeps a population page of stone 활성도 by class and server
  ([loawa.com/stat/ability-stones](https://loawa.com/stat/ability-stones)), which tells you how
  rare good stones are but not whether they change hands.

**Recommended chart basis: expected cost of cutting your own.** It is the basis the mechanic
forces, it needs one editable input, and it does not depend on a market I cannot price:

```
gold for the 7/7 -> 9/7 step = 703.67 x C        (C = all-in cost of one uncut Ancient stone,
                                                     gold plus Pheons, silver ignored)
gold per 1% party damage     = 703.67 x C / (0.392 x 3)  =  598 x C
```

Using the full 725 stones instead of the 703.67 marginal — that is, "from nothing to a 9/7"
rather than "from the 7/7 you already have" — gives `616 x C`. The two differ by 3%; pick the
marginal one to match how the other rows are built.

| C (gold per uncut stone) | Gold for the step | Gold per 1% damage |
|---|---|---|
| 50 | 35,200 | 29,900 |
| 100 | 70,400 | 59,800 |
| 200 | 140,700 | 119,700 |
| 500 | 351,800 | 299,200 |
| 1,000 | 703,700 | 598,400 |

**I could not get a live price for C.** Ability stones sit on the auction house, not the
market, so the loa-buddy feed the other tools use returns nothing for them (I checked — empty
result for every stone slug). Pricing this row needs an auction-house source: the official
Open API's auction endpoints, or a scrape of a Korean price site. Until then, ship the row
with C as an input and a sensible default.

---

## 5. What the chart owner should know

1. **The row is one cliff, not a ladder.** 7/7, 8/7, 8/8, 9/6 are all worth the same nothing.
   Only 9/7 pays, and 9/9 and 10/10 pay no more than 9/7 does. If the chart wants a ladder,
   the honest one is `combined level 4 → combined level 5`, one row.
2. **The step is a lottery, not a purchase.** 704 expected stones, and the median player never
   gets there — 4.7% of stones reach level 4 and 0.14% reach level 5. Anyone reading a
   gold-per-damage number here should understand it is an expectation over hundreds of drops,
   with a fat left tail. Worth a note on the row.
3. **Supports can ignore the malus, and that is unusual.** All four negatives are free to a
   support's party contribution. Do not let the chart imply a cost there.
4. **The same finding widens beyond stones.** If basic attack power feeds the ally buff and the
   stone's +1.5% counts, then **damage gems count too** — the same Vortex line names "gems, and
   ability stone" together, and the bracelet calculator already groups them as `baseApPct`.
   `model/support.js` currently gives the support no attack-power percentage at all, so it is
   understating both. That is a separate row and a separate model change, but it comes from
   this research and should not get lost.
5. **The model change this row needs is small.** `contribution()` takes `supAtk =
   baseAtk(gear.wp, gear.ms)`; it needs `* (1 + baseApPct)`, with the stone contributing 0.015
   once combined level ≥ 5. Everything else in the model is untouched. Flagging only — I have
   not changed any code.
6. **Uncertainty, ranked.** The level thresholds, the +1.5% and its "basic" wording, and the
   0.13793% are all from the official site and are solid. The 0.39 damage figure inherits every
   assumption in the house support model (the 0.22 share, the uptimes, the dealer baseline) —
   it is as good as the accessory calculator and no better. The Ancient silver-per-attempt
   figure and the price of an uncut stone are unknown. Whether a finished stone can be bought
   is genuinely unresolved; if it turns out it can, the chart should use the market price
   directly and this whole cost model becomes a ceiling rather than the answer.

---

## Sources

- [Official game guide — 각인 (engravings and ability stones)](https://m-lostark.game.onstove.com/GameGuide/Pages/%EA%B0%81%EC%9D%B8)
- [Official probability disclosure — 어빌리티 스톤 자동 세공](https://m-lostark.game.onstove.com/Probability/%EC%96%B4%EB%B9%8C%EB%A6%AC%ED%8B%B0%20%EC%8A%A4%ED%86%A4%20%EC%9E%90%EB%8F%99%20%EC%84%B8%EA%B3%B5)
- [Official game guide — 거래소 / 경매장](https://m-lostark.game.onstove.com/GameGuide/Pages/%EA%B1%B0%EB%9E%98%EC%86%8C)
- [Maxroll — Ability Stone System Guide](https://maxroll.gg/lost-ark/resources/ability-stone-system-guide)
- [Maxroll — Engraving System Guide](https://maxroll.gg/lost-ark/resources/engraving-system-guide)
- [Maxroll — Support Bard Raid Guide](https://maxroll.gg/lost-ark/build-guides/support-bard-raid-guide)
- [Maxroll — Support Paladin Raid Guide](https://maxroll.gg/lost-ark/build-guides/support-paladin-raid-guide)
- [Inven — 오피셜) 어빌리티 스톤 자동 세공 기대값을 알아보자](https://www.inven.co.kr/board/lostark/6271/3055441)
- [Inven — 서포터 아군 공격력 강화/피해량 강화 효율](https://www.inven.co.kr/board/lostark/4821/100314)
- [Inven — 티어4 어빌리티 스톤은 어떻게?](https://www.inven.co.kr/webzine/news/?news=297378&site=lostark)
- [Vortex Gaming — Lost Ark Support Buffs Analysis](https://vortexgaming.io/en/postdetail/502641)
- [Fandom — Drops of Ether](https://lostark.fandom.com/wiki/Drops_of_Ether)
- [LOAWA — 어빌리티 스톤 통계](https://loawa.com/stat/ability-stones)
- [PCGamesN — Lost Ark ability stones guide](https://www.pcgamesn.com/lost-ark/ability-stone-facet) (old; cited only for the tradability claim)
- Local planner feed: `tools/.cache/stats.json` (`engraving`, `engravingStone`), `tools/.cache/items.json` (`abilityStone` on items 9104550 and 9100562), `tools/.cache/tools.js` (stat enum, engraving tooltip renderer `desc[points - 1 + 20 * stone]`, step-bonus code)
