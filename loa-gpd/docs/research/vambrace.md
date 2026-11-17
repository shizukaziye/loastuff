# Vambrace — the seventh piece of gear (October 2026)

Research note for the gold-per-damage chart. The model is `model/vambrace.js`; the table is
`data/vambrace.json`; the checks are in `tools/verify.js`.

Data source: Maxroll's planner feed (`assets-ng.maxroll.gg/laplanner`), the tables their
upgrade calculator runs on, read on 2026-11-17 with the page reading "Up to date with October
2026 patch". Cross-checked against a Korean player's published material totals, loagg's
expected-tap table, both regions' write-ups of the limit breaks, and one character on
lostark.bible.

**Bottom line. The vambrace is one more honed piece, +0 to +25, on the rule the weapon and the
armour follow, with three things of its own: it takes both breaths at once, each level has a
growth cost in shards, and at +10, +15 and +20 a limit break (raid drops, no gold) turns it
Legendary, Relic and Ancient and adds 1% basic attack power each. On the chart's DPS
reference a +25 Ancient is ×1.1734 over wearing none, for about 13.95M gold at the chart's
default prices; the piece itself, free from the raid, is ×1.0145 of that.**

---

## 1. What it is

- A new equipment slot, added with the Shadow Raid Belgardin, the Arbiter of Death (Korea in
  August 2026; NA/EU on 2026-10-21, the "Arbiter of Death" update). Belgardin is 1750 on
  Normal, 1770 on Hard and 1780 on Nightmare.
- The first clear of the second gate gives the character an **Epic** vambrace at +0. It is
  its own piece: it has no item level and counts toward none.
- It hones +0 to +25 on one table. A **limit break** at +10, +15 and +20 swaps the item for the
  next grade's — Legendary, Relic, Ancient — and nothing past the level opens before it.
- Normal drops Spectral Shade; Hard and Nightmare drop Deathly Hand. One Deathly Hand stands
  for two Spectral Shade at +10 and +15; the +20 break takes Deathly Hand only.

| Limit break | to | Spectral Shade | or Deathly Hand |
|---|---|---|---|
| +10 | Legendary | 200 | 100 |
| +15 | Relic | 240 | 120 |
| +20 | Ancient | — | 150 |

Sources: [Inven Global, the Shadow Raid update](https://www.invenglobal.com/articles/24462/defeat-belgardine-and-claim-the-vambrace-shadow-raid-update),
[Inven Global, the growth timeline](https://www.invenglobal.com/articles/24471/what-is-the-growth-timeline-for-the-vambrace-reach-ancient-grade-by-week-7-with-extra-rewards)
(the Korean names read "Remnant of the Dead" and "Hand of Death" there),
[theclick.gg on the two materials](https://www.theclick.gg/?p=98021). The feed agrees on
every count (`enhanceCommon[…].limitBreak`: `itemAmount` 200 / 240 / 150, `replaceRatio` 2).

## 2. What it carries

Two blocks, added. Neither is on the `itemLevel` curve the other gear reads.

**The grade's static block** (`itemStatic`, keyed `<static0>#<grade>`): 10,500 main stat,
3,500 weapon power, 900 vitality, 450 defense and 450 resistance — the same on all four
grades. The only thing a grade changes is `BASE_DAMAGE_RATE`: 0, 100, 200, 300 (0.01% units),
so **each limit break is +1% basic attack power**.

**The honing level's block** (`itemQuality`, cumulative from +1). A five-level cycle: weapon
power, main stat (with defense and resistance), weapon power, main stat, then flat basic
attack power (`BASE_DAMAGE_ADDEND`) on the level that ends in 5 or 0.

| Level | Main stat | Weapon power | Flat basic attack power |
|---|---|---|---|
| +5 | 12,030 | 3,710 | 850 |
| +10 | 24,246 | 7,469 | 2,030 |
| +15 | 36,768 | 11,317 | 3,690 |
| +20 | 49,716 | 15,294 | 5,980 |
| +25 | 63,210 | 19,440 | 9,050 |

So a +25 Ancient carries 73,710 main stat, 22,940 weapon power, 9,050 flat basic attack power
and 3% basic attack power. For scale: the five armour pieces at +21 carry about 630,000 main
stat and a +25 weapon 241,367 weapon power.

## 3. What a level costs

The honing rule in `model/honing.js`, unchanged: a tap lands at
`base + min(fails × failBonus, failMax) + breath`, and once the rates already spent reach
215% the next one is certain. The fail bonus is a tenth of base a failure, up to base again.

| Levels | Base rate | A breath adds | Most of each | Taps, no breath | Taps, full breath |
|---|---|---|---|---|---|
| +1 to +5 | 15% | 0.375% | 20 | 4.85 | 2.98 |
| +6 to +10 | 10% | 0.20% | 25 | 6.64 | 4.17 |
| +11 to +15 | 5% | 0.10% | 25 | 11.44 | 7.52 |
| +16 to +20 | 3% | 0.05% | 30 | 17.47 | 11.59 |
| +21 to +25 | 1.5% | 0.025% | 30 | 32.36 | 21.57 |

Three differences from the weapon and the armour.

1. **Both breaths at once.** A tap takes Lava's Breath and Glacier's Breath, each with its own
   count (`additive` has two entries), and the cap is on their sum (`additiveMax`): a full
   load of both exactly doubles the base rate. The model fills a count from the cheaper
   breath first and solves for the cheapest constant count, as it does everywhere.
2. **A growth cost.** `exp` is the piece's gear XP, cumulative, fed in shards one for one. A
   level costs the difference once, before its first tap: 145,000 shards at +1 rising to
   607,000 at +25, 7,504,000 in all. Baked as `growShards`; the taps' own shards are `shards`.
3. **Materials of both kinds.** Destruction stones and guardian stones together, with
   leapstones, fusion material, gold and silver.

**The unit changed under us.** Until mid 2026 the feed quoted a breath's rate in the success
rate's 0.01% units (weapon +12: 25 a breath, cap 500). It now quotes 0.001% (250, cap 5000)
and Maxroll's optimizer divides by ten. `tools/fetch-game-data.py` reads the unit off a row
whose answer is known (weapon +12, where a full breath doubles the 5% base) and bakes 0.01%
either way; it stops, writing nothing, if that row fits neither.

**Checked against two outside sources** (`tools/verify.js`):

- loagg's table of expected taps with no breath: 4.9, 6.6, 11.4, 17.5, 32.4. Ours, to a
  decimal, are the same.
- A Korean player's worked totals for +0 to +10 with no breath, read 2026-11-17: 122,232
  guardian stones, 40,319 destruction stones, 2,106 leapstones, 1,546 fusion material,
  362,990 gold, 4,812,480 silver, and 2,596,650 shards of which 1,578,000 is growth. Ours
  are 122,123 / 40,283 / 2,104 / 1,545 / 362,668 / 4,808,007 / 2,595,751 with the same
  1,578,000 — every one about 0.09% under, which is one rounding rule in the artisan sum and
  not a different table. (The link was not kept. The Inven tips-board post
  [노숨) 완갑 10강, 15강, 25강 소모 재화 기댓값 정리](https://www.inven.co.kr/board/lostark/4821/110556)
  is a table of exactly this, with its figures in an image; check against it before
  leaning on these.)

## 4. How it enters damage

| Stat | Where it goes | Why |
|---|---|---|
| main stat | raw, into the flat sum, so it takes the main-stat percentages | lostark.bible's Legendarymember read with the vambrace at +14/+15 and at +20 differs by 14,114 main stat. The table's step is 12,948, and 12,948 × 1.09 = 14,113 — that character's 9% pool |
| weapon power | raw, into the flat sum, so it takes the weapon-power percentages | by the same rule; not separately confirmed (open question 1) |
| limit break, 1% each | the basic attack power % pool the damage gems and the ability stone are in | it is the same stat (`BASE_DAMAGE_RATE`, id 150); lostark.bible's own attack power multiplier for Legendarymember reads 15.7% and 16.7% across one limit break |
| flat basic attack power | added to the square root, inside that percentage | it is the addend of the same stat family (`BASE_DAMAGE_ADDEND`, id 114): a rate multiplies its base and the base's addends. **An assumption** — see open question 2 |

```
basic AP = (sqrt(total WP × total MS / 6) + vambrace flat) × (1 + AP% + limit breaks)
```

**The limit break sits on the step that reaches it.** +9 → +10 carries the Legendary break's
1%, +14 → +15 the Relic one's, +19 → +20 the Ancient one's: that step's gold is what unlocks
the break, and nothing else can. The break's own cost is raid drops, shown on the row and
priced at no gold.

**Nobody stops at +9.** With the break on it, +9 → +10 buys three times what +8 → +9 does for
about the same gold. Rows on a ladder are bought in order, so a stretch whose later steps are
cheaper per 1% than its earlier ones is priced as one (`poolLadder` in `lookup.js`, the rule
the ark grid rows already follow). At default prices the stretches are +0–2, +2–5, +5–10,
+10–15, +15–20 and +20–25, and gold per 1% never falls along the ladder.

**The piece itself is no row.** The Epic +0 costs no gold. A character who has it deals 1.44
more on the DPS axis (0.43 a dealer on support), which the Loseii Score counts and the chart
does not sell.

On the DPS reference (attack power 240,097 with none):

| | D (house scale) | multiplier |
|---|---|---|
| the Epic +0 piece | 1.44 | ×1.0145 |
| to +10, Legendary | 6.36 | ×1.0657 |
| to +15, Relic | 9.50 | ×1.0997 |
| to +20, Ancient | 12.94 | ×1.1382 |
| to +25 | 15.99 | ×1.1734 |

Korean community estimates read the same day: 6.2–6.4% at +10 and about 19% at +25, against
6.57% and 17.34% here. They are not on this reference character, and a character with less
gear than a 1785 gets more out of the same piece.

## 5. Reading it off a character

lostark.bible lists the vambrace in the `"bracer"` equipment slot, with its `honing` and its
item `id`: `{id:134501406,slot:"bracer",data:{type:"equipment",stats:[],honing:20,…}}` on
Legendarymember. The id's first four digits name the grade whatever the class — 1343 Epic,
1344 Legendary, 1345 Relic, 1346 Ancient — which is how a +20 with its limit break still to
do (that one: Relic at +20) is told from one with it done. Both Workers send `+N` and the id;
`lookup.js` (`vambraceOf`) turns them into `{ level, grade }`, `null` for none worn, and
leaves the field undefined on a pull from before the Workers looked.

A character at a cap with the break still to do is the common case in the first weeks: the
gold to reach +10 can be spent on day one, and the 200 Spectral Shade take weeks of clears.
For that character the lookup offers nothing on this ladder (no gold buys the next step),
keeps the vambrace out of the next-buy pick, prices the step that reached the cap without
the break's 1%, and the Loseii Score counts the level without the break.

## 6. Open questions

1. **Weapon power on a real character.** Legendarymember's weapon power differs by 654 from
   what the table plus that character's visible percentages give. The main stat reproduces
   to within a point, so the table's main stat is right; the 654 is either a weapon-power
   source the page does not itemise or something in how the piece's weapon power joins the
   pool. Not resolved.
2. **The flat basic attack power.** Taken as inside the percentage. If the game adds it after
   every percentage instead (the way an ark grid attack core's flat attack power is taken
   here), a +25 is ×1.1612 rather than ×1.1734 on the DPS reference — 1% less, all of it on
   the five levels that carry the flat. A character sheet read before and after a +5 would
   settle it.
3. **One attack-power pool.** The house models put gems, the stone, Adrenaline, accessory
   lines and the ark grid node in one additive percentage (`baseApPct`, 0.2948 on the DPS
   reference), and a limit break's 1% joins it. If basic attack power % (gems, stone,
   vambrace) multiplies attack power % instead of adding to it, each break is worth about
   0.89% rather than 0.76%, and a +25 is ×1.1774. That is a question about the house model,
   older than the vambrace.
4. **Shards.** `growShards` and the taps' shards are baked and unpriced: the chart takes
   shards as bound, and its shard price box feeds a price nothing reads (`prices.shard` is
   never set). If shards are ever priced, the vambrace's growth is the largest shard cost on
   the chart.
5. **Special honing.** The feed carries a second route per level (`special`,
   `specialAmount` 50 to 70 of "Special Honing: Transferred Leapstone", id 66103105). Not
   modelled here, nor on the weapon and armour rows.
6. **The first real fetch.** The build machine could not reach the feed, so the table was
   read out of the calculator page's own loaded data in a browser, rebuilt in the feed's
   shape, and baked with `bake_vambrace` itself. Deleting `tools/.cache/` and running
   `python tools/fetch-game-data.py` should rewrite `data/vambrace.json` byte for byte. The
   same run re-bakes the honing tables from the October feed, which nothing here has
   compared with the July bake beyond the breath unit.
