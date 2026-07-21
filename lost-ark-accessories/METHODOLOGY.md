# Lost Ark Accessory Value Model — Methodology & Reference

Full reference for the calculator (`index.html`, mirrored by `accessory_value.py`).
It prices cut accessories for **DPS** and **Support** markets, recommends what
to cut, and plans purchases against a budget. Everything is closed-form and
recomputes in-browser from editable inputs.

Data sources: the official Korean drop-rate page (cut probabilities) and
community testing / Maxroll for line damage values; we anchor pricing to
hand-picked market prices.

---

## 1. Cutting mechanics

- You drop a naked accessory with a random main stat, then pay **1,200g per cut**
  to unlock a line, up to **3 cuts** (max 3,600g/attempt).
- Each cut independently rolls **one of 10 effects** for that accessory type, at
  one of three tiers: **rare (low) 6.3% / epic (mid) 3.0% / legendary (high) 0.7%**
  per effect (10% per effect, 100% over the 10). After a line locks, that effect
  is removed and the remaining nine renormalize.
- Main-stat ranges (per accessory): Necklace **15,178–17,857**, Earring
  **11,806–13,889**, Ring **10,962–12,897**.

### Effect pools (primary = bold)
- **Necklace**: **Outgoing Damage %**, **Additional Damage %**, Gauge Gain %,
  Stigma %, Max HP+, Attack Power+, Weapon Attack Power+, Max MP+, Debuff
  Duration %, HP Recovery+
- **Earring**: **Attack Power %**, **Weapon Attack Power %**, Healing %, Shield %,
  Max HP+, Attack Power+, Weapon Attack Power+, Max MP+, Debuff Duration %, HP Recovery+
- **Ring**: **Crit Damage %**, **Crit Rate %**, Ally Atk Buff %, Ally Dmg Buff %,
  Max HP+, Attack Power+, Weapon Attack Power+, Max MP+, Debuff Duration %, HP Recovery+

---

## 2. Damage is multiplicative → log score `D`

Lines multiply, they don't add. We score each accessory by the **log of its
total damage multiplier** so damage becomes additive (and a clean pricing axis):

```
D = 100 · ln(total multiplier)      (for small values D ≈ the % gain)
```

### DPS line values

Raw accessory values (tier low / mid / high):

| Line | low | mid | high | how it converts to damage |
|---|---|---|---|---|
| Outgoing Damage % | 0.55 | 1.20 | 2.00 | direct bucket; value = the % |
| Additional Damage % | 0.95 | 1.60 | 2.60 | additive: `acc / (1 + base_additional)` → ≈ 0.70 / 1.18 / 1.91 |
| Attack Power % | 0.40 | 0.95 | 1.55 | through the attack-power model |
| Weapon Attack Power % | 0.80 | 1.80 | 3.00 | through the model (sqrt → ~half value) |
| Crit Rate % | 0.40 | 0.95 | 1.55 | crit-factor change |
| Crit Damage % | 1.10 | 2.40 | 4.00 | crit-factor change |
| Attack Power+ (flat) | 80 | 195 | 390 | added to atk flats |
| Weapon Attack Power+ (flat) | 195 | 480 | 960 | added to weapon power after % |

**Attack-power model** (drives atk%, weapon%, flats, main stat):
```
atk        = sqrt(WP · MS / 6)
total_atk  = (atk + sup_base · k)·(1 + atk%) + flat_atk + base_flat_atk
```
- WP = base weapon power × (1 + weapon%) + weapon-flat; MS = base main stat + the accessory's main-stat roll.
- Weapon power gives ~half its value because of the sqrt.
- `k` = the support's attack-power buff to you — **derived**, see §4.
- Main stat runs through this same model (so it's diluted by the support term).

**Crit**: average multiplier `cr·cd·1.12 + (1 − cr)`; a crit line bumps cr or cd,
value = the ratio change.

**Max HP+ toggle (`HP flat = Wpn`)**: off (default), Max HP+ is junk. On, we value
Max HP+ **exactly like Weapon Attack Power+ at the same tier, in both markets**
(DPS damage via the atk model; support via the support's base atk → AP buff).
More outcomes count as premium flats, so the supply CDF reshapes and every slot
recalibrates — the necklace anchors stay pinned by definition (their reference
rolls contain no HP line) and derived earring/ring anchors are unchanged, but
mid-tier values and cut EV shift (neck optimal EV ≈ 2,134 → 2,209 at defaults).

### DPS defaults (editable)
- base additional **35.85%**, base attack power **13.33%** (incl. ark-grid-cores
  +2.13%), crit rate **90%**, crit damage **280%** (×1.12 factor), base weapon
  power **250,000**, base main stat **750,000**, base flat atk **+2,700** (ark grid cores).

---

## 3. Support value = party-damage contribution

We grade a support's lines by how much **party damage** their buffs add, on the
same log scale (contribution *above* a no-accessory support). Four buff buckets,
each applied to its **uptime / coverage** share of party damage:

```
brand    = 1 + up_brand · 0.10·(1 + brand_power + acc_brand)
tskill   = 1 + up_tskill · 0.10·(1 + ally_dmg)
serenade = 1 + up_seren · (1 + 0.5·acc_gain) · 0.15·(1 + ally_dmg + serenade_dmg)
ap       = 1 + up_ap · (apMult − 1)
   apMult = ((dps_base + sup_base·0.22·(1 + ally_atk_enh))·(1+atk%) + flat)
            / ((dps_base)·(1+atk%) + flat)
Q = 100 · ln( brand · tskill · serenade · ap )        (above no-accessory)
```

### Support line mapping & raw values

| Slot | Primaries | (raw low / mid / high) |
|---|---|---|
| Necklace | Brand (`Stigma %`) + Serenade gain (`Gauge Gain %`) | Brand 2.15/4.8/8 · Gauge 1.6/3.6/6 |
| Ring | Ally Dmg (`Ally Dmg Buff %`) + Ally Atk Enh (`Ally Atk Buff %`) | Ally Dmg 2/4.5/7.5 · Ally Atk 1.35/3/5 |
| Earring | Weapon Power % (single primary) | 0.8/1.8/3.0 |

The **only support flat** is Weapon Power+ (195/480/960) — it raises the support's
base atk → bigger AP buff, on any slot. Accessory lines feed:
Stigma→brand power, Gauge→serenade **gain** (uptime, half-effective; calibrated so
a gain line ≈ 75% of a brand line), Ally Dmg→t-skill **and** serenade, Ally Atk→ap
coefficient, Weapon% / Weapon-flat / main stat→the support's base atk.

### Buff mechanics & non-accessory bases (editable)
- **Brand**: 10% damage buff, scaled by brand power. base brand_power **48.8%**
  (ark grid 10 + echoing brand 4.8 + evolution 34). Applies to **100%** of damage.
- **AP buff (ally atk enhancement)**: support adds `0.22·(1 + ally_atk_enh)` of its
  base atk to yours. base ally_atk_enh **63.55%** (ark grid 7.8 + cores 1.75 +
  luminary 22 + pray 22 + gems 10). Applies to **95%** (default uptime).
- **T-skill**: 10% outgoing buff, scaled by ally dmg. Applies to **40%**.
- **Serenade (Bard, representative support)**: 15% buff, scaled additively by ally
  dmg + serenade dmg. base ally_dmg **7.66%** (order moon 2.01 + faith 2.5 + ark
  grid 3.15); base serenade_dmg **88.03%** (spec 58.03 + gems 10 + cores 20).
  Applies to **70%** (the 70% already bakes in the 46.42% stat gain; accessory
  gauge gain adds at half effectiveness).

Rough high-tier party-damage contributions: brand ≈ +0.69%, ally-atk-enh ≈ +0.81%,
ally-dmg ≈ +0.94%, serenade-gain ≈ +0.51%, all comparable to DPS lines.

---

## 4. The support's buff to your DPS (`k`)

The DPS attack-power model's support term is **not** a free input — it's the AP
buff a baseline support gives you, derived from the support fields:

```
k = 0.22 · (1 + ally_atk_enh) · ap_uptime      (default ≈ 0.342)
```

It's shown read-only in the support section and updates on Recalculate.

---

## 5. Pricing (supply × demand)

```
value(D) = max(0,  ∫[baseline..D]  min(cap, p_min·(1 − F(x))^(−1/a)) dx  −  tax)
```

- **Supply `F(D)`**: enumerate every full-cut outcome (all 19,440 ordered triples)
  × 5 main-stat quintile levels (**min/low/mid/high/max** = 0/25/50/75/100% of the
  roll range, 20% of drops each) → the share of cuts scoring ≤ D.
- **Demand**: an 80/20-style **Pareto**, `p_min·(1−F)^(−1/a)` gold per unit of
  log-damage. Rare = steep premium.
- **Cap**: **60,000,000 gold per 1% damage** (richest-buyer ceiling). Applied
  **only to final pricing, not calibration** — the cap is absolute and would break
  the p_min-linearity the calibration relies on. It only trims the very rarest items.
- **Baseline (= 0 gold)**: a *better-primary-high / nothing / nothing* accessory at
  min main stat. Value is credited only above it.
- **Pheon tax**: a flat **60,000 gold** per accessory. Buying costs Pheons (from
  Blue Crystals at ~19,100g/pack); the buyer pays it, so the seller nets 60k less.
  `value = max(0, gross − 60k)`. All shown gold values are net.

### Calibration — two anchors per market (necklace only)

Only the **necklace** high/mid & high/high net prices are inputs; `(a, p_min)`
solve to hit them. Earring/ring anchors are **derived** by scaling the neck anchor
by that slot's damage-above-baseline ratio, then each slot fits its own `(a, p_min)`.

| Market | neck high/mid | neck high/high |
|---|---|---|
| DPS | 500,000 | 3,200,000 |
| Support | 250,000 | 1,200,000 |

Derived (≈, defaults): DPS earring h/h ~1.84M, ring h/h ~1.90M; support ring h/h
~1.82M. Anchors are editable; the cheapest-roll definition is *useless 3rd line,
min main stat*.

---

## 6. Cut EV & optimal policy

- Every finished accessory is worth **`max(DPS value, Support value)`** — you sell
  into whichever market pays more. (A Brand+Serenade neck that's worthless to DPS
  prices ~1.35M via support.)
- A **Bellman DP** over every cut state chooses cut-vs-stop (cut while
  `E[next] − 1,200g > 0`). Optimal neck EV at mid stat ≈ 2,134g/attempt. The
  policy table shows, at every stat quintile, the **EV of paying for the next cut
  and playing on** (net of remaining cut costs), color-scaled — red for ≤0 (deeper = worse),
  a log green ramp brightening with the EV for cut — e.g. a junk-opener mid-stat earring is −10g (a coin flip), min-stat −688g
  (clear stop), while necks stay positive at any stat.
- Reference strategies: **S1** = abandon unless cut 1 is a **DPS or support**
  primary at mid+; **S3** = always full-cut. Partial cuts are valued at 0.
- The **optimal-policy table** breaks decisions into 12 rows per accessory:
  dps-primary / support-primary / flat / useless × high/mid/low.

---

## 7. Budget planner

For each of the 5 slots (1 neck, 2 earrings, 2 rings) we build the cost→damage
**efficient frontier** over every primary pair × flat tier (none/low/mid/high) ×
main-stat quintile (min/low/mid/high/max). All slots' marginal upgrades are merged and sorted by
**gold per 1% damage**; a budget buys the cheapest-per-damage **prefix**. The
loadout shows the equipped Primary / Flat / Main per slot; "closest upgrade /
cheapest equipped" show the efficiency right at your budget. The budget slider is
**logarithmic** (each tick = a fixed % change) and follows the DPS/Support toggle.

---

## 8. Files

- **`index.html`** — the published page (GitHub Pages) and authoritative model;
  self-contained HTML + JS, no build, no deps.
- **`accessory_value.py`** — Python reference in full parity; `verify` asserts it
  reproduces values captured from the live page; `value` prices a roll in both markets.
- **`README.md`**, **`CLAUDE.md`** — overview and a guide for future Claude sessions.

---

## 9. Design history (why it looks the way it does)

- **Damage metric**: started as a linear %-sum, then moved to the multiplicative
  **log-multiplier** so stacking is exact.
- **Demand curve**: linear → convex power-law `F^α` (over-spread the mid tiers) →
  **Pareto** `(1−F)^(−1/a)`, which puts the best-in-slot premium only at F→1 and
  keeps mid tiers tight. Calibrated to the 80/20 principle.
- **Anchors**: per-slot (6 inputs) → **necklace-only (2 per market)** with
  earring/ring derived by damage ratio.
- **Cap**: 10M → effectively-uncapped (1e9) → 100M → **60M** gold / 1% damage; made
  cap-free during calibration after a bug where the cap broke p_min-linearity
  (produced a 600M anchor).
- **Baseline**: {primary high + 2 low flats} → **{better primary high + nothing}**
  at min main stat, consistently for both markets.
- **Support**: added the full party-damage-contribution model (brand / AP /
  serenade / t-skill) with editable uptimes (AP default 95%); the DPS support term
  `k` is now derived from those fields rather than a hardcoded 0.382.
- **Catalog**: collapsed to gold-prominent / damage-small cells, three accessories
  side by side. Cut EV folds in `max(DPS, Support)`.
