# When to Stop Cutting — NA/EU vs Korea (2026-08-17)

The question this doc answers came from the community: *"After a 14% grid it's better to
go Esther weapon and quit Ark Grid forever — does that match your gold-per-damage math?"*

Short answer: **the 14% rule is a Korean number, and it is roughly right — in Korea.** On
NA/EU the same math says keep cutting to **16–19%**. The regions differ because Korean
players can turn spare gems into gold and we can't. This doc derives both stopping points
exactly, with no simulation.

Everything below uses the live model (the v62 constants in
[how-a-gem-is-graded.md](how-a-gem-is-graded.md)) and the exact Bellman DP from
[how-the-pipeline-tables-are-computed.md](how-the-pipeline-tables-are-computed.md).

---

## 1. The setup

A player has a full grid and an endless supply of uncut epic gems (8-, 9-, and 10-cost).
Each cut costs gold; each result either beats the worst gem in the grid (an upgrade) or
becomes fodder. As the grid improves, upgrades get rarer, so the expected value of a cut
falls. **You stop cutting a cost when that expected value drops below what else the uncut
gem is worth.**

Per-cost baselines follow the willpower rule: an 8-cost can only replace a gem needing
willpower ≥ 3, a 9-cost ≥ 4, a 10-cost ≥ 5. So each cost is judged against its own floor —
the worst *equipped* gem it could legally replace.

The DP gives the cut value exactly: for a given floor grade `B` and gold-per-damage `gpd`,
`W(fresh gem, B, gpd)` is the expected net gold of cutting one more gem with optimal
play (process / reroll / complete / stop at every step). It falls monotonically as `B`
rises, so the stopping floor is a single root-find per cell — no trials needed. Below the
baked pipeline range we read the bake directly; above it we bisect the DP live
(a cut can never beat a floor above that cost's own perfect gem, which caps the search:
96.1 / 99.7 / 102.1 for c8 / c9 / c10).

Grade floors translate to whole-grid damage through the leaderboard corpus: for each
willpower threshold we bin real full-grid characters by their floor gem's grade and read
the mean total dmg% per bin (a perfect 24-gem grid is 18.93%).

---

## 2. NA/EU — no escape hatch, so you cut nearly forever

On NA/EU a gem you don't cut is worth **nothing**. Roster-bound gems can't be sold, and
fusing an epic away yields at most a fodder epic — always worth less than cutting the gem
yourself. So cutting only has to beat **zero**, and it keeps beating zero until your grid
is nearly perfect.

**Stop cutting each cost when your floor (worst legal equipped gem) reaches:**

| gpd | 8-cost | 9-cost | 10-cost |
|---|---|---|---|
| 500k | 88.6 (~14.9%) | 91.0 (~16.1%) | 91.8 (~16.5%) |
| 1M | 90.6 (~16.0%) | 93.5 (~17.5%) | 95.0 (~18.3%) |
| 2.5M | 92.9 (~17.1%) | 96.3 (~18.9%) | 98.2 (~18.9%) |
| 5M | 94.3 (~17.9%) | 97.7 (~18.9%) | 100.0 (~18.9%) |
| 10M | 95.4 (~18.5%) | 98.7 (~18.9%) | 101.0 (~18.9%) |
| 25M | 96.0 (~18.9%) | 99.3 (~18.9%) | 101.7 (~18.9%) |

Read: at 2.5M gold per 1% damage, retire your 8-costs once your worst wp≥3 gem grades
92.9, but keep cutting 10-costs until your worst wp≥5 gem grades 98.2 — which in damage
terms means cutting to a ~19% grid. 8-costs always die first: their perfect gem grades
only 96.1, so they run out of headroom while 9s and 10s still have room above them.

---

## 3. Korea — the 3,900g escape hatch

Korea's twist is not that gems sell — normal gems are just as untradable there. The twist
is **fusion**: three *uncut* gems fuse into one uncut gem of the next rarity
(epic + 2 uncommons → 26% epic / 49% rare; rare + 2 uncommons → 4% epic / 44% rare), and
**half of all fusion output is tradable**. Uncut tradable epics sell for about 10k gold
(8-cost) / 30k gold (9- and 10-cost). Cut gems can never become tradable.

So an uncut epic in hand has a fallback value: fuse it, and with probability 26% you get
an epic out, half of which you can sell. The untradable half is worth the same fallback
again, which makes the value recursive:

```
T = 0.26 × (0.5 × 30,000 + 0.5 × T) − 500      (500g fusion fee)
⇒ T ≈ 3,908 gold
```

Two things follow. First, **steer fusion output to 9/10-cost**: the same equation aimed
at 8-cost output (10k sale) gives only ~920g — steering is worth ~3,000g per gem. Second,
**never fuse an epic you could sell** — but since you can't sell a normal epic, the real
rule is simpler: 3,900g is the bar a cut must clear, for every cost (the input's own cost
doesn't matter, because the output cost is steerable).

Two earlier wrong turns, recorded so they stay dead: pricing the bar at the raw market
price (10k/30k) is wrong — you can't sell a gem you own, only fusion output — and that
error also fabricated a "Korea retires 10-costs first" inversion that disappears under
the correct uniform bar.

**Korea — stop cutting each cost when your floor reaches (bar = 3,908g):**

| gpd | 8-cost | 9-cost | 10-cost |
|---|---|---|---|
| 500k | 80.5 (~11.6%) | 81.7 (~11.9%) | 81.2 (~11.4%) |
| 1M | 84.6 (~13.2%) | 86.1 (~13.6%) | 86.1 (~13.4%) |
| 2.5M | 88.5 (~14.9%) | 90.6 (~15.9%) | 91.3 (~16.2%) |
| 5M | 90.8 (~16.1%) | 93.1 (~17.3%) | 94.2 (~17.9%) |
| 10M | 92.6 (~17.0%) | 95.4 (~18.5%) | 96.5 (~18.9%) |
| 25M | 93.9 (~17.7%) | 97.2 (~18.9%) | 99.1 (~18.9%) |

The retirement order matches NA (8-costs first), but every floor sits **7–8 grade points
lower** — about 3 points of grid damage at mid budgets, narrowing to ~1 at whale budgets
where the gem's damage value dwarfs the 3,900g bar.

---

## 4. The verdict on the 14% rule

- **In Korea**, "stop around 14%" matches this table at roughly **1–2M gpd** — a sane
  rule of thumb for a typical high-end Korean player.
- **On NA/EU**, the equivalent stopping point is **~16–18%** (and ~19% for 10-costs at
  2.5M+ gpd). Importing the Korean rule forfeits 2–4 points of grid damage.
- The one-line reason: **a Korean uncut gem always has a ~3,900g escape hatch (fuse →
  50% tradable → sell); an NA gem has none. Cutting must beat the escape hatch, so
  Koreans stop earlier.**

At the extreme low end: for cutting to die at a 14% grid on NA/EU, gold would have to be
worth so much that 1% of damage trades under ~200–280k gold — Esther-weapon territory,
not normal play.

---

## 5. Sidebar: what a top gem costs to produce

From the baked pipeline (expected spend ÷ P(cut ≥ target), 2-damage pairs, 2.5M anchor):

| target grade | c8 | c9 | c10 |
|---|---|---|---|
| 83.3 (A) | 130k | 132k | 152k |
| 86.7 (A+) | 236k | 214k | 233k |
| 90 (S−) | 471k | 334k | 384k |
| 93.3 (S) | — | 626k | 576k |

Production cost roughly doubles per band, and an 8-cost cannot reach S at all. In a
tradable market these numbers are the supply-side floor under top-gem prices.

---

## 6. Assumptions and limits

- **Gold EV only** (`nrb` mode), stop at net EV ≤ 0 against the stated bar; epic cuts,
  best 2-damage effect pair. Worse pairs stop earlier; the tables are the last-to-die
  case per cost.
- **KR prices are a snapshot** (uncut epics ~10k / 30k, rares ≈ 0, provided 2026-08-17).
  The bar scales linearly with the 9/10-cost price; the tables move only modestly for
  moderate price moves because the EV curve is steep near its tail.
- **Cut gems are kept, not sold** — true in both regions (only uncut fusion output can be
  tradable in KR).
- Damage mappings come from NA/EU leaderboard characters; grid mechanics are identical
  across regions, but the KR cost mix may differ slightly.

*Reproduction: the stopping floors come from the baked `data/pipeline.json` cells
(threshold crossing per cost/gpd) plus direct DP bisection above the baked range
(`model/dp.js` Solver, floor cap = each cost's perfect grade). 2026-08-17.*
