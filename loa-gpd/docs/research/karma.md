# Karma — level-up cost model (Karmic Enlightenment 21 → 30)

Research note for the gold-per-damage chart. Nothing here changes model or app code.

Data source: `tools/.cache/stats.json`, key `karma` (Maxroll's planner feed, the game's own
tables, July 2026 patch). Cross-checked against the official Korean game guide, Maxroll's
written guide, and Korean community datamining.

**Bottom line: the mechanic is fully pinned down. `prob` is the base success rate in 0.01%
units, `care` is the karma energy gained per failure in 0.01% units, the bar fills at 100%,
and the attempt *after* it fills is guaranteed. Expected cost to take Karmic Enlightenment
from 21 to 30 is 758 attempts / 682,171 gold at 900g per attempt.**

---

## 1. How the pity bar works

The stat is called **Karma Energy** (카르마의 기운). The official Ark Passive guide states
the rule in two sentences:

> "레벨 성장 실패 시 일정량의 '카르마의 기운'이 누적됩니다"
> — on a failed level-up, a set amount of Karma Energy accumulates.

> "'카르마의 기운'이 100%가 되면 다음 회차 성장 시도 시 100% 확률로 레벨 성장에 성공합니다"
> — once Karma Energy hits 100%, the **next** attempt succeeds with certainty.

> "'카르마의 기운'이 100%가 되기 이전 레벨 성장 시 기존 누적된 '카르마의 기운'이 초기화 됩니다"
> — if the level-up succeeds before the bar reaches 100%, the accumulated energy resets.

Source: [official Lost Ark game guide, Ark Passive page](https://m-lostark.game.onstove.com/GameGuide/Pages/%EC%95%84%ED%81%AC%20%ED%8C%A8%EC%8B%9C%EB%B8%8C)

Three things follow, and all three matter:

1. **The energy gain is a flat, tabulated amount per level. It does not scale with the base
   rate.** This is the key difference from gear honing. Artisan energy is proportional to the
   success rate and fills at a ~215% cumulative threshold; karma energy is just a number
   looked up in a table. A Korean player who pushed Enlightenment to 30 put it plainly:
   "무기처럼 조금씩 쌓이는게 아니고 아예 고정일듯" — unlike weapons, which accumulate
   gradually, this looks completely fixed.
   Source: [Inven, 깨달음의 카르마 30레벨 확률](https://www.inven.co.kr/board/lostark/6271/1123598)
2. **The guaranteed attempt is the one after the bar fills**, not the one that fills it. So the
   worst case is `ceil(1 / energy_per_fail) + 1` attempts, not `ceil(1 / energy_per_fail)`.
3. **Energy resets on success and does not carry between levels.** Each level is an independent
   truncated-geometric draw. No cross-level bookkeeping is needed.

The official guide does not publish the per-failure amount. `stats.json` does — see below.

---

## 2. What `prob` and `care` mean

**Hypothesis (a) is confirmed: `prob` is the base success rate in 0.01% units.**
**Hypothesis (b) is confirmed in its first form: `care` is the karma energy gained per failure,
also in 0.01% units of a 100% bar.** It is not a "careful"/protection mechanic.
Confidence: **high** — three independent confirmations.

### Confirmation 1 — the pity column is exactly `ceil(10000 / care)`

Maxroll's written guide publishes a success-rate/pity table. Every row matches `care`:

| Level | Maxroll success | `prob` | Maxroll pity | `care` | `ceil(10000/care)` |
|---|---|---|---|---|---|
| 21 | 20%   | 2000 | 10    | 1000 | 10 |
| 22 | 15%   | 1500 | 14    | 750  | 14 (13.33 → 14) |
| 23 | 10%   | 1000 | 20    | 500  | 20 |
| 24 | 7%    | 700  | 29    | 350  | 29 (28.57 → 29) |
| 25 | 4%    | 400  | 56    | 180  | 56 (55.56 → 56) |
| 26 | 2%    | 200  | 112   | 90   | 112 (111.1 → 112) |
| 27 | 1%    | 100  | 250   | 40   | 250 |
| 28 | 0.5%  | 50   | 500   | 20   | 500 |
| 29 | 0.2%* | 25   | 1,250 | 8    | 1250 |

Nine for nine, including the three non-integer roundings. Nothing but "energy per failure in
0.01% units" produces that column.
Source: [Maxroll, Karma System Guide](https://maxroll.gg/lost-ark/resources/karma-system-guide)

\* **Maxroll's 0.2% at level 29 is wrong.** `prob` is 25, i.e. 0.25%, and the Inven thread
independently states "29에서30올리는데 0.25퍼 확률" — 0.25% from 29 to 30. Use 0.25%. Every
other Maxroll rate matches `prob/100` exactly, so this is a typo on their side.

### Confirmation 2 — a player quotes the raw energy number

The same Inven thread gives the per-failure gain for level 29 directly:
"기백이 쌓이는건 0.08퍼" — the accumulation is 0.08%. `care` at level 29 is 8. 8/10000 = 0.08%.
Exact match, and it settles the units.

### Confirmation 3 — structural

`care` is not a fixed fraction of `prob` (the ratio runs 0.50, 0.50, 0.50, 0.50, 0.45, 0.45,
0.40, 0.40, 0.32), so it is an independently tuned column, not a derived one. And `prob` is 0
only on a rank's cap level (5, 9, 13, 17, 21 for ranks 1-5; 30 for rank 6), which confirms that
the entry for level L holds the odds for **L → L+1**, and that 0 means "this level is terminal,
rank up instead". Level 30 is the board maximum; it is reached from 29 at 0.25%, not by any
zero-probability roll.

### Also worth recording

- **Gold per attempt is 900, not 1,100.** Maxroll's guide says 1,100; it is stale. The cost was
  cut in a patch, and an Inven datamining post records the change: "1100→900 gold nerf",
  average per rank falling from ~36,000 to ~30,000 gold.
  Source: [Inven, 클뜯 기반 카르마 성장 정보 및 평균 골드](https://www.inven.co.kr/board/lostark/4821/101460).
  Every level entry and every rank entry in `stats.json` reads `money {"2": 900}`. Only the
  board-opening cost is still 1,100. The owner's 900 is right.
- **Materials per attempt: 1 Destiny Stone** (item `66103002`). Free by assumption here.
- **Rank-ups never fail.** 30 Shadow of Karma (item `52324201`) + 900 gold, guaranteed. Opening
  a board costs 20 Shadow of Karma + 1,100 gold and grants rank 1. Five rank-ups per board, so
  170 Shadow of Karma per board and 510 across all three — which is exactly the total the Inven
  post gives, confirming the reading of the rank entries.
- **All three boards share identical `prob` and `care` tables.** Only the stat payout differs.

---

## 3. The cost model

### Formula

For a level with base rate `p = prob/10000` and energy per failure `c = care/10000`:

```
F = ceil(1 / c)                      # failures needed to fill the bar
M = F + 1                            # attempt cap: the one after the bar fills is guaranteed
E[attempts] = sum_{k=0}^{M-1} (1-p)^k
            = (1 - (1-p)^M) / p
E[gold]     = 900 * E[attempts]
E[stones]   = 1 * E[attempts]        # Destiny Stones, treated as free
```

`(1 - (1-p)^M)/p` is the standard truncated-geometric mean: expected attempts equals the sum
over k of the probability that the first k attempts all failed. Levels are independent because
energy resets and does not carry over, so totals are plain sums.

### Karmic Enlightenment, per level

Recommended figures (rule B — guaranteed attempt is `F+1`, per the official wording):

| Step | Success | Energy/fail | F | Cap M | E[attempts] | E[gold] @900 |
|---|---|---|---|---|---|---|
| 21 → 22 | 20.00% | 10.00% | 10   | 11   | 4.571   | 4,113 |
| 22 → 23 | 15.00% | 7.50%  | 14   | 15   | 6.084   | 5,476 |
| 23 → 24 | 10.00% | 5.00%  | 20   | 21   | 8.906   | 8,015 |
| 24 → 25 | 7.00%  | 3.50%  | 29   | 30   | 12.666  | 11,400 |
| 25 → 26 | 4.00%  | 1.80%  | 56   | 57   | 22.560  | 20,304 |
| 26 → 27 | 2.00%  | 0.90%  | 112  | 113  | 44.901  | 40,411 |
| 27 → 28 | 1.00%  | 0.40%  | 250  | 251  | 91.975  | 82,778 |
| 28 → 29 | 0.50%  | 0.20%  | 500  | 501  | 183.767 | 165,390 |
| 29 → 30 | 0.25%  | 0.08%  | 1250 | 1251 | 382.538 | 344,284 |
| **21 → 30 total** | | | | | **757.97** | **682,171** |

### Cumulative, and what it buys

Karmic Enlightenment grants Weapon Power %, +0.10% per level. Level 21 sits at 2.10%.

| Target | Weapon Power % | Gain over lv21 | Cumulative gold |
|---|---|---|---|
| 22 | 2.20% | +0.10% | 4,113 |
| 23 | 2.30% | +0.20% | 9,589 |
| 24 | 2.40% | +0.30% | 17,605 |
| 25 | 2.50% | +0.40% | 29,004 |
| 26 | 2.60% | +0.50% | 49,308 |
| 27 | 2.70% | +0.60% | 89,719 |
| 28 | 2.80% | +0.70% | 172,496 |
| 29 | 2.90% | +0.80% | 337,887 |
| 30 | 3.00% | +0.90% | 682,171 |

Each step buys the same +0.10% Weapon Power. The gold per step roughly doubles from 25 onward,
so the last level costs more than every level from 1 to 29 put together
(344,284 vs 337,887 for 21→29, and 145,021 for 1→21).

### The alternative pity rule, if you want it

Rule A reads Maxroll's "pity" column as the attempt cap itself (`M = F`) instead of `M = F+1`.
I do **not** recommend it — the official Korean wording is explicit that the guaranteed attempt
comes after the bar fills. The gap is negligible anyway:

| Step | E[gold] rule A (M=F) | E[gold] rule B (M=F+1) | Difference |
|---|---|---|---|
| 21 → 22 | 4,017   | 4,113   | +2.4% |
| 25 → 26 | 20,212  | 20,304  | +0.5% |
| 29 → 30 | 344,244 | 344,284 | +0.01% |
| **Total 21 → 30** | **681,391** | **682,171** | **+0.11%** |

A third reference point: ignoring pity entirely (`1/p`) gives 360,000 gold for 29 → 30 against
344,284 with pity. Pity saves about 4.4% on the last level and about 3.4% over 21 → 30. Small,
but it is the difference between a guessed number and a right one, so keep it.

### Sanity check

Applying the same formula to all three boards from level 1 to rank 6 / level 25 gives 522,074
gold at 900g, or 638,091 at the old 1,100g, plus ~19,800 in board and rank costs — about 658k.
The Inven datamining post estimates "roughly 700,000 gold per character" for that same target
pre-nerf. Within ~6% of a rounded community estimate.

---

## 4. Is anything else in the karma table worth charting for a support?

Decoded with the stat enum from `tools.js` (the contiguous run holding
`EVOLUTION_DAM_RATE=45` and `STIGMA_POWER_RATE=46`; note the naive whole-file scan lands on the
wrong run and mis-decodes every id).

| Board | Level payout | Stat id | Per level | At lv30 | Rank payout (per rank, 6 max) |
|---|---|---|---|---|---|
| 10000 Karmic Evolution | `MAX_HP` | 27 | +400 | 12,000 | `EVOLUTION_DAM_RATE` +1% **and** `STIGMA_POWER_RATE` +1% |
| 20000 Karmic Enlightenment | `WEAPON_DAM_X` | 152 | +0.10% | 3.00% | +1 Enlightenment point |
| 30000 Karmic Leap | `ULTIMATE_AWAKENING_DAM_RATE` | 104 | +0.05% | 1.50% | +2 Leap points |

The premise checks out: **Evolution and Leap levels are not worth charting for a support.** Max
HP does nothing for party damage, and Ultimate Awakening Damage does nothing a support cares
about. Evolution's rank bonuses are confirmed at +1% Evolution Damage and +1% Brand Power per
rank, 6% at rank 6, matching Maxroll's guide text.

Two things do deserve a second look, and both are about **ranks**, not levels:

- **`STIGMA_POWER_RATE` is Brand Power.** Stigma is 낙인, Brand. That is a support's own party
  contribution, not personal damage — and Evolution's rank track hands out +6% of it. So the
  Evolution board is not worthless to a support after all; its *levels* are, but its *ranks*
  are not.
- **Enlightenment ranks grant Ark Passive Enlightenment points**, +1 each to 6. Those buy tree
  nodes, which for a support are support nodes.

Neither belongs on a gold-per-damage curve as drawn, because **rank-ups cannot fail**. The
whole cost is a fixed 900 gold plus 30 Shadow of Karma, with the real gate being the level-21
requirement to open rank 6. So the honest framing is a single one-off line item, not a curve:
Evolution levels 1 → 21 cost 161.1 expected attempts / **145,021 gold**, and that is the price
of the +6% Brand Power (plus +6% Evolution Damage, which a support does not care about).

**One caveat on the Enlightenment row itself, worth raising before it goes on the chart.**
Weapon Power % raises the support's *own* weapon power. Support party contribution in Lost Ark
comes from Brand, ally attack-power and ally damage buffs, which are fixed percentages and do
not scale with the support's weapon power. If the chart's currency is party damage contribution,
Karmic Enlightenment's 3% Weapon Power is close to worthless for a support and the Evolution
rank track is the row that matters. If the currency is the character's own damage, the
Enlightenment table above is the right one. Flagging rather than deciding — it changes which
row goes on the chart, not any number in it.

---

## Sources

- [Official Lost Ark game guide — Ark Passive](https://m-lostark.game.onstove.com/GameGuide/Pages/%EC%95%84%ED%81%AC%20%ED%8C%A8%EC%8B%9C%EB%B8%8C) — Karma Energy rules: accumulates on failure, 100% guarantees the next attempt, resets on success.
- [Maxroll — Karma System Guide](https://maxroll.gg/lost-ark/resources/karma-system-guide) — success/pity table, rank bonuses. Stale on gold (1,100) and wrong on the level-29 rate (0.2% vs 0.25%).
- [Inven — 깨달음의 카르마 30레벨 확률](https://www.inven.co.kr/board/lostark/6271/1123598) — 0.25% at 29 → 30, 0.08% energy per failure, and that the gain is fixed rather than honing-style.
- [Inven — 클뜯 기반 카르마 성장 정보 및 평균 골드](https://www.inven.co.kr/board/lostark/4821/101460) — client datamining: the 1,100 → 900 gold nerf, 510 Shadow of Karma total, ~700k gold to rank 6 level 25.
- `C:\Users\Shizu\loa-gpd\tools\.cache\stats.json`, key `karma` — the game's own tables.
- `C:\Users\Shizu\loa-gpd\tools\.cache\items.json` — item `66103002` Destiny Stone, item `52324201` Shadow of Karma.
- `C:\Users\Shizu\loa-gpd\tools\.cache\tools.js` — stat enum. Contains no karma cost calculator; the planner bundle does not compute this.
