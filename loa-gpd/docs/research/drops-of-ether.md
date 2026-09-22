# Drops of Ether — what the stone level is actually worth

Research note for the gold-per-damage chart. Nothing here changes model or app code.

Korean name: **구슬동자** (roughly "orb boy"). This is *not* 지원의 에테르, and it is not
에테르 포식자 (Ether Predator, 에테르 포식자, a damage-dealer engraving). Confirmed by matching
engraving id 134 across Lost Ark Codex's `us` and `kr` locales — same id, `Drops of Ether` /
`구슬동자`.

**Bottom line. The owner is right on every point I could check. The ability-stone level of
Drops of Ether buys *ether effectiveness* and nothing else: +12 / 15 / 21 / 24% at 6 / 7 / 9 /
10 successful nodes. Effectiveness multiplies the *magnitude* of the orb's buff. It does not
touch duration (fixed 30s), does not touch the spawn cooldown, and does not touch the drop
rate — so orb uptime is identical at 7 and at 9 nodes, exactly as he said. The stone bonus is
additive with the relic-grade bonus (+4 / 8 / 12 / 16% at relic level 1–4), so a normal
endgame support at relic 4 runs 31% total on a 7-node stone and 37% on a 9-node stone. In
buff terms that is Strength Orb 13.1% -> 13.7% attack power and Flash Orb 19.65% -> 20.55%
crit rate. The step is base x 0.06 either way, so the *difference* survives even if the relic
level is wrong. Two things I could not nail down and you should treat as open: whether the
Strength Orb's attack power lands additively in the dealer's attack-power bucket or as its own
multiplier (this swings its value by a lot), and the owner's 15% / 10% uptime assumptions,
which are judgement, not published numbers.**

---

## 0. Answer to the actual question, up front

| | 7-node stone (level 2) | 9-node stone (level 3) |
|---|---|---|
| Stone ether effectiveness | +15% | +21% |
| Relic-4 engraving effectiveness | +16% | +16% |
| **Total effectiveness** | **+31%** | **+37%** |
| Strength Orb, attack power | 10% x 1.31 = **13.1%** | 10% x 1.37 = **13.7%** |
| Flash Orb, crit rate | 15% x 1.31 = **19.65%** | 15% x 1.37 = **20.55%** |
| Orb duration | 30s | 30s |
| Ether spawn cooldown | 10s | 10s |
| Orbs per proc | 1 self-only + 1 party-only | 1 self-only + 1 party-only |

Deltas: **+0.6pp attack power** on a strength orb, **+0.9pp crit rate** on a flash orb. Those
land on whichever of the three dealers picks the orb up, for its 30 seconds, at whatever
uptime you assume.

The 13.1 / 13.7 and 19.65 / 20.55 figures are not my arithmetic alone — they are the measured
in-game values published on Inven (section 3), and my arithmetic reproduces them to the
decimal. That is the strongest confirmation in this note.

---

## 1. The per-grade / per-level table (question 3)

Maxroll's Engraving System Guide, **last updated 1 September 2025**
(<https://maxroll.gg/lost-ark/resources/engraving-system-guide>), gives Drops of Ether as:

| Grade | Effect |
|---|---|
| Base | 16s cooldown |
| Legendary | cooldown −1.5 / 3 / 4.5 / 6s |
| Relic | ether effectiveness +4 / 8 / 12 / 16% |
| Ability Stone | ether effectiveness +12 / 15 / 21 / 24% |

Namuwiki's 로스트아크/각인 page (read via the `namu.moe` mirror — namu.wiki itself 403s
WebFetch) agrees: legendary tops out at a 16s cooldown, relic brings it to **10s** and adds
ether effectiveness up to **+16%**, and the ability stone adds **"추가로 12.00% / 15.00% /
21.00% / 24.00%"** at **6 / 7 / 9 / 10** successful nodes.

The four ability-stone numbers are keyed to node counts 6 / 7 / 9 / 10, which the official
Korean game guide (already quoted in `docs/research/ability-stone.md`) defines as faceting
**levels 1 / 2 / 3 / 4**. So:

- 7 nodes = stone engraving **level 2** = **+15%** effectiveness
- 9 nodes = stone engraving **level 3** = **+21%** effectiveness

**This is exactly what the owner said, and the "stale" +12 / 15 / 21 / 24 table he found is
the current one.** The companion table +4 / 8 / 12 / 16 is *not* an alternative version of the
same thing — it is the *relic book* progression, a separate additive source. Anyone reading
the Fandom page sees the two tables printed side by side with no labels and reasonably
concludes one of them must be wrong. Both are right; they add.

### The 60s / 30s / 10s cooldown story is dead

Maxroll's planner feed (and Lost Ark Codex, which shares the same legacy client dump) still
shows three levels with 60 / 30 / 10s cooldowns. That is the **season 1** engraving, before
the relic-engraving rework. The current engraving has a **16s base cooldown reduced to 10s by
legendary level 4**, and from relic grade onward the level buys effectiveness, not cooldown.
Details in section 6.

Two consequences that matter to the tool:

1. **Cooldown is a function of grade, not of the stone.** Any endgame support is at relic, so
   the spawn cooldown is pinned at 10s and identical at 7 and 9 nodes. This is the mechanical
   reason the owner's "uptime does not change" claim holds. It is not an approximation.
2. The +12/15/21/24 and 60/30/10 tables do not disagree with each other. They describe
   different systems a rework apart.

---

## 2. What "ether effectiveness" multiplies (question 2)

**It multiplies the buff magnitude. Only the magnitude.**

The Inven write-up 「변경된 구슬동자 각인 효과 정리」, **14 July 2024**
(<https://www.inven.co.kr/board/lostark/4821/99529>) states it directly:

> 유물 단계 구슬동자의 에테르 효과 강화는 **지속시간은 30초로 동일하며 기존 구슬 효과의
> 수치 증가**입니다.
> — for relic-grade Drops of Ether, the ether enhancement keeps the duration the same at 30
> seconds; it is an increase to the numeric value of the existing orb effect.

Not the duration. Not the drop rate. Not the cooldown. Each of those is governed elsewhere
(duration is a flat 30s, cooldown by grade, drop rate is an unpublished proc chance on hit).

The same post states the stacking rule:

> 어빌리티 스톤에 의해 증가하는 수치는 **합연산** 됩니다.
> — the amount added by the ability stone is **additive**.

Additive with the relic-grade bonus, that is. So:

```
effectiveness E = relic_bonus + stone_bonus          # e.g. 0.16 + 0.21 = 0.37
orb_value       = base_value * (1 + E)               # e.g. 0.15 * 1.37 = 0.2055
```

### The proof that this is the right formula

The 2024 Inven post publishes measured in-game values. Divide each by the base and the
effectiveness falls straight out:

| Orb | Base | Relic 4 only | 6 nodes | 7 nodes | 9 nodes | 10 nodes |
|---|---|---|---|---|---|---|
| 힘의 구슬 Strength, Atk. Power | 10% | 11.6% | 12.8% | 13.1% | 13.7% | 14% |
| 섬광 구슬 Flash, Crit Rate | 15% | 17.4% | 19.2% | 19.65% | 20.55% | 21% |
| 바람 구슬 Wind, Move Speed | 10% | 11.6% | 12.8% | 13.1% | 13.7% | 14% |
| 방어 구슬 Defense, All Defense | 10% | 11.6% | 12.8% | 13.1% | 13.7% | 14% |

Implied total effectiveness: 11.6/10 = 1.16, 12.8/10 = 1.28, 13.1/10 = 1.31, 13.7/10 = 1.37,
14/10 = 1.40. The crit column reproduces the same multipliers off a base of 15 to the second
decimal (17.4, 19.2, 19.65, 20.55, 21.0). And 16 + 12 = 28, 16 + 15 = 31, 16 + 21 = 37,
16 + 24 = 40.

Every number in the published table is `base x (1 + 0.16 + stone)`. The model is confirmed on
four orbs and five stone states simultaneously. I would call this settled.

**One coincidence to be careful of:** the Flash Orb at a 10-node stone is 21% crit rate, and
the *effectiveness* at a 9-node stone is also 21%. Two unrelated 21s. Do not let them cross in
the code.

### Warning about the absolute level

If the tool computes the orb as `base x 1.15` vs `base x 1.21` (stone bonus only, no relic
term), the **difference** it reports is still correct — `base x 0.06` either way — but both
absolute magnitudes are understated by 16% of base. That matters wherever the response is not
linear: crit rate approaching the 100% cap, or an attack-power bucket where the marginal value
of a point depends on how full the bucket already is. Use 31% and 37%, not 15% and 21%.

This assumes the support is at **relic level 4** on the engraving. If the tool wants to be
strict, the relic level should be an input; at relic 3 the totals become 27% and 33%.

---

## 3. What each ether actually does, on the current patch (question 1)

The Fandom / Fextralife numbers you have (Strength Orb +10% attack power for 30s, Flash Orb
+15% crit rate for 30s) are **not wrong — they are the base values before ether effectiveness
is applied.** They are stale only in that they omit the effectiveness scaling that every real
support has. That is a much smaller problem than it looked.

Current tooltip, from Namuwiki's engraving page:

> 적을 타격 시 일정 확률로 자신의 8m 이내에 **자신만 획득 가능한 에테르 1개**와 **파티원만
> 획득 가능한 에테르 1개**를 생성한다.
> — on hitting an enemy, has a chance to create, within 8m of yourself, **one ether only you
> can pick up** and **one ether only party members can pick up**.

### Party pool — the one your three dealers compete for

| Ether | Effect (base) | Duration |
|---|---|---|
| 힘의 구슬 Strength Orb | Atk. Power +10% | 30s |
| 섬광 구슬 Flash Orb | Crit Rate +15% | 30s |
| 바람 구슬 Wind Orb | Move Speed +10% | 30s |
| 방어 구슬 Defense Orb | All Defense +10% | 30s |
| 마나 구슬 Mana Orb | restores mana | instant |

Five types. The proc picks **one** at random, so a given party orb is a Strength Orb roughly
1 time in 5 and a Flash Orb roughly 1 time in 5 — assuming a uniform roll, which no source
states and I could not verify.

Mana Orb magnitude is inconsistent across sources: ~300–600 mana in a 2021 Inven post
(<https://www.inven.co.kr/board/lostark/4821/80624>, 3 August 2021), "10–20% restoration" on
Namuwiki. It does not enter the damage arithmetic, so I did not chase it.

### Self pool — what the support gets, and why it does not matter here

For a support, the two offensive ethers are swapped out of the self pool: 힘의 구슬 and
섬광 구슬 are replaced by **생명 에테르** (life, restores HP) and **무력 에테르** (stagger
+15%). A July 2025 Inven post 「구슬동자 에테르 효과 정리」
(<https://www.inven.co.kr/board/lostark/4821/106825>, 17 July 2025) tests the self ethers and
lists exactly five: 무력, 바람, 방어, 마나, 생명.

That post also gives the naming convention the Korean sources use, which is worth knowing when
reading them: **에테르** = the self-only pickup, **구슬** = the party-only pickup. English
sources call both "orbs" and the distinction vanishes.

**Open item:** that same post records the self ethers at a **10s** duration, against 30s for
the party orbs. I could not confirm whether that is a real asymmetry, a legendary-grade
artefact (the author says he tested at legendary), or a transcription slip. It does not touch
the dealer-side arithmetic, so I left it.

---

## 4. Self vs party (question 4)

**Both. Every proc creates two ethers: one the caster alone can take, one only party members
can take.** The support cannot eat the party orb and the dealers cannot eat the support's
ether. Confirmed by the current Namuwiki tooltip quoted above, and by the Fandom summary
("one for yourself and the other one for party members"), which agree.

Namuwiki dates the dual-ether behaviour to a 2025 update. Before that the engraving created a
single ether. I have not found the specific patch note; if the model ever needs to handle a
pre-2025 state it should be looked up, but for a current-patch tool it is moot.

Practical consequence for the tool: **one party orb per proc, contested by three dealers.**
Not one per dealer. Whatever uptime you assume has to be an uptime *per dealer* out of a
single shared supply, and the three dealers' orb uptimes are not independent — they are
partitions of the same stream.

---

## 5. What else moves the damage arithmetic (question 5)

### 5a. UNVERIFIED — where the Strength Orb's attack power lands

I could not find an authoritative current statement on whether "Atk. Power +13.7%" from an
ether orb is **additive inside the dealer's attack-power bucket** (alongside the support's
ally attack-power buff, Adrenaline, Cursed Doll and friends) or **its own multiplier**.

This is the single largest open question in this note, and it is worth more than the 0.6pp
itself:

- As **its own multiplier**, 13.1% -> 13.7% is a clean `1.137 / 1.131 = +0.53%` damage.
- As **additive into a bucket already sitting at, say, +120%**, the same 0.6pp is
  `2.206 / 2.200 = +0.27%` — roughly half.

A factor of two on the headline number. The Fandom Damage page appears to place support attack
power in an additive bucket and shows an `Orb` term inside it, but the page is behind a 402 to
WebFetch and I would not trust the transcription that reached me through search-result summary
alone. Maxroll's Party Synergies page (last updated 3 April 2026) does not cover engraving
orbs at all.

**Recommendation: model it as additive into the attack-power bucket** — that is where every
other percentage attack-power source in the game sits, and it is the conservative choice — but
flag it in the tool and get it confirmed before publishing a number.

### 5b. The Flash Orb is probably the bigger half

+0.9pp of crit rate versus +0.6pp of attack power, and crit rate converts through crit damage,
so on a typical dealer the flash orb step is likely the larger contributor even at the lower
uptime the owner assumes. It also has the cleaner mechanical story: crit rate is flat
additive, no bucket ambiguity. Whatever you do about 5a, the flash-orb half of the calculation
is safe.

Watch the crit cap: a dealer already near 100% effective crit gets nothing from the extra
0.9pp. At 20.55% from a single orb this is not a hypothetical for a well-buffed dealer in a
crit window.

### 5c. UNVERIFIED — the 15% / 10% uptime assumptions

The owner's 15% strength-orb and 10% flash-orb uptime per dealer are his own judgement. No
source publishes orb uptime, and it cannot be derived — it depends on the proc chance (never
disclosed), on how diligently dealers walk over orbs, and on the three-way contention noted in
section 4. I flag it as an input, not a finding.

Sanity check only: a 10s cooldown and a 30s duration means a fresh party orb can exist roughly
every 10s and lives 30s, so orbs are plentiful; the binding constraint is pickup discipline
and the 1-in-5 type roll. 10–15% per dealer per type is not obviously wrong. That is as far as
I can honestly take it.

### 5d. Nothing in 2026 has touched it

I checked Maxroll's KR balance patch coverage through **22 July 2026** (the most recent, at
<https://maxroll.gg/lost-ark/news/kr-balance-patch-july-2026>) — no combat engraving changes,
nothing on ether orbs, nothing on support attack-power or crit-rate buffs. That patch is
explicitly "mostly numerical adjustments" to skills, Ark Passives and Ark Grid. Maxroll's
2025–2026 news index carries eleven KR balance patch articles and none has an engraving
heading in its title.

The 2024 Inven values therefore still stand. This is the weakest link in the chain — the
measured orb table is two years old — but the mechanism (base x (1 + effectiveness)) is
confirmed by a source as recent as the Namuwiki engraving page, and the effectiveness table
itself by Maxroll's September 2025 guide.

---

## 6. The local cache: stale, and how stale

`tools/.cache/stats.json`, table `engraving`, key `"134"`:

```json
{
  "name": "Drops of Ether",
  "desc": [
    "Attacks have a chance to create an Ether within 8 meters. (Cooldown: 60s)",
    "Attacks have a chance to create an Ether within 8 meters. (Cooldown: 30s)",
    "Attacks have a chance to create an Ether within 8 meters. (Cooldown: 10s)"
  ],
  "season": 1,
  "levels": { "5": 1, "10": 2, "15": 3 },
  "stats": [ { "type": 28, "stat": 0, "index": 134, "value": {"1": 1, "2": 2, "3": 3} } ]
}
```

**This entry is stale.** It is flagged `"season": 1` in the feed's own schema. It describes:

- three levels, not four;
- book thresholds of 5 / 10 / 15, the pre-rework engraving-book system;
- a single ether per proc, not the current self + party pair;
- cooldowns 60 / 30 / 10s, which belong to the season-1 engraving;
- **no ether effectiveness at all** — the whole quantity this note is about is absent.

Lost Ark Codex's `us` and `kr` pages for engraving 134 show byte-identical text, so both are
serving the same legacy client dump. Codex's site header reads version 3.21.3.1 dated
08 November 2026, i.e. the *site* is maintained but this *record* has not been refreshed since
the rework. Maxroll's own written guide (section 1) contradicts Maxroll's own planner feed.
Trust the guide.

**So: do not read Drops of Ether's numbers out of `stats.json`.** Hardcode from section 0 /
section 1 and cite this note.

Two related cache observations:

- `combatEffectDesc` (315 entries) contains **nothing** on ether orbs. I grepped it for
  `Ether|에테르|Orb`; the single hit is an unrelated Witcher-collab buff. Orb effect strings
  are not in the feed at all, at any freshness.
- `engravingStone` key `1000` (the full pool of engravings a stone can roll) does contain
  `134`, and key `1001` — a shorter list, presumably a support-relevant subset — contains
  `134` as well. That part of the feed is consistent with a support cutting Drops of Ether.
  It carries no numbers, so nothing to be stale about.

---

## 7. Sources, with dates

Ordered by how much weight I put on them.

| Source | Date | What it gave |
|---|---|---|
| [Maxroll — Engraving System Guide](https://maxroll.gg/lost-ark/resources/engraving-system-guide) | updated 1 Sep 2025 | The per-grade table: Base 16s, Legendary −1.5/3/4.5/6s, Relic +4/8/12/16%, Ability Stone +12/15/21/24%. The load-bearing source. |
| [Inven — 변경된 구슬동자 각인 효과 정리](https://www.inven.co.kr/board/lostark/4821/99529) | 14 Jul 2024 | Measured orb values at every stone tier; the 30s-duration and 합연산 (additive) statements. The load-bearing source for section 2. |
| [Namuwiki — 로스트아크/각인](https://namu.wiki/w/로스트아크/각인) (fetched via mirror <https://namu.moe/w/로스트아크/각인>) | live wiki, dual-ether change attributed to a 2025 update | Current tooltip text; self-only + party-only ether confirmation; 6/7/9/10 node keying; 10s relic cooldown. namu.wiki returns 403 to WebFetch — the mirror served the content. |
| [Maxroll — KR Balance Patch July 2026](https://maxroll.gg/lost-ark/news/kr-balance-patch-july-2026) | 22 Jul 2026 | Negative check: no engraving or ether changes. |
| [Maxroll — Support Paladin Build Guide](https://maxroll.gg/lost-ark/build-guides/support-paladin-raid-guide) | updated 12 Jun 2026, changelog cites the 17 Jan 2026 balance patch | Confirms Drops of Ether is current mandatory support kit (4th engraving, after Awakening / Magick Stream / Expert). No mechanics. |
| [Inven — 구슬동자 에테르 효과 정리](https://www.inven.co.kr/board/lostark/4821/106825) | 17 Jul 2025 | Self-ether pool (무력/바람/방어/마나/생명); the 에테르 = self vs 구슬 = party naming convention; the unresolved 10s self-ether duration. |
| [Inven — 딜러들이 알아두면 좋은 구슬동자](https://www.inven.co.kr/board/lostark/4821/80624) | 3 Aug 2021 | Historical: 8m spawn radius, cooldown 20s -> 10s, base orb list. Old, used only for corroborating the base values. |
| [Inven — 구슬동자와 에테르강화로 하는 서포팅](https://www.inven.co.kr/board/lostark/4821/72993) | 7 Jan 2021 | Historical base values (10% AP / 15% crit / 30s). Confirms the Fandom numbers are the un-scaled base, not an error. |
| [Maxroll — Party Synergies](https://maxroll.gg/lost-ark/resources/party-synergies) | updated 3 Apr 2026 | Negative check: engraving orbs are not treated as party synergies and the page says nothing about buff buckets. |
| [Lost Ark Codex — engraving 134, `us`](https://lostarkcodex.com/us/engraving/134/) and [`kr`](https://lostarkcodex.com/kr/engraving/134/) | site v3.21.3.1 dated 8 Nov 2026; **record itself is pre-rework** | Confirmed the Korean name 구슬동자 = id 134 = Drops of Ether. Its tooltip is stale and matches our cache byte for byte. |
| [Fandom — Drops of Ether](https://lostark.fandom.com/wiki/Drops_of_Ether) / [Fextralife](https://lostark.wiki.fextralife.com/Drops+of+Ether) | undated, clearly old | The two unlabelled effectiveness tables that started the confusion. Numbers are right; the presentation is not. |

### English vs Korean

No contradiction to report, which was not the outcome I expected. Maxroll's English engraving
guide and the Korean sources give the identical +12/15/21/24 table, the identical node
breakpoints, and consistent orb values. The only English source that misleads is the Fandom /
Fextralife pair, and it misleads by omission (unlabelled tables, no effectiveness scaling
applied) rather than by being wrong.

The one place I did prefer Korean: the *mechanism* — that effectiveness scales magnitude and
not duration or drop rate — is stated plainly only in Korean, on Inven. No English source I
found says what effectiveness multiplies.

### What I could not confirm

1. **Whether the Strength Orb's attack power is additive in the dealer's attack-power bucket
   or its own multiplier.** Worth up to a factor of two on that half of the calculation. See
   5a. Highest-value follow-up.
2. **The 15% / 10% uptime figures.** Unpublished and, I think, unpublishable. Owner's
   judgement. See 5c.
3. **Whether the party orb type roll is uniform across the five types.** Assumed 1-in-5;
   no source states it.
4. **Whether the measured orb values from July 2024 have drifted.** No patch note says they
   have and no 2025–2026 balance patch touches engravings, but the measurement itself is two
   years old.
5. **The self-ether duration**, 10s vs 30s. Irrelevant to the dealer-side maths. See section 3.
6. **The exact patch that introduced the dual self/party ether.** Namuwiki says 2025; I did not
   find the note.
