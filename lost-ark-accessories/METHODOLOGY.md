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
same log scale (contribution *above* a no-accessory support). A support has three
damage channels, each applied to its **uptime / coverage** share:

```
ap     = 1 + up_ap · (apMult − 1)
   apMult = ((dps_base + sup_base·0.22·(1 + ally_atk_enh))·(1+atk%) + flat)
            / ((dps_base)·(1+atk%) + flat)

brand  = 1 + up_brand · 0.10·(1 + brand_power + acc_brand)

# Serenade of Courage, Major Chord and the T-skill are the support's identity
# buffs. All three raise the damage dealer's Additional Damage, so they share
# one bracket, add up, and are then diluted by the dealer's own base additional:
   ser   = 0.15·(1 + ally_dmg + acc_ally_dmg)·(1 + spec_eff)
   chord = 0.02·(1 + ally_dmg + acc_ally_dmg)·(1 + spec_eff)
   tsk   = 0.10·(1 + ally_dmg_t + acc_ally_dmg)
   identity = 1 + (up_seren·ser + up_chord·chord + up_tskill·tsk) / (1 + base_add)
   spec_eff = spec · class_coeff          (Bard 0.0005006 per point of spec)

Q = 100 · ln( ap · brand · identity )        (above no-accessory)
```

The identity bracket is the key correction over the earlier model: a point of
ally-damage enhancement sits *inside* `(1 + ally_dmg …)`, so its worth rides on how
big that bracket already is (spec, gems, ark grid), not on a fixed 15% buff.

### Support line mapping & raw values

| Slot | Primaries | (raw low / mid / high) |
|---|---|---|
| Necklace | Brand (`Stigma %`) + Serenade gain (`Gauge Gain %`) | Brand 2.15/4.8/8 · Gauge 1.6/3.6/6 |
| Ring | Ally Dmg (`Ally Dmg Buff %`) + Ally Atk Enh (`Ally Atk Buff %`) | Ally Dmg 2/4.5/7.5 · Ally Atk 1.35/3/5 |
| Earring | Weapon Power % (single primary) | 0.8/1.8/3.0 |

The **only support flat** is Weapon Power+ (195/480/960) — it raises the support's
base atk → bigger AP buff, on any slot. Accessory lines feed:
Stigma→brand power, Gauge→serenade **gain** (a meter-gen input that moves the Bard's
identity base in 5/10/15% bar steps; modelled here as half-effective uptime, an
acknowledged approximation), Ally Dmg (`acc_ally_dmg`)→the identity bracket (serenade,
chord **and** t-skill), Ally Atk→the ap coefficient, Weapon% / Weapon-flat / main
stat→the support's base atk.

### Buff mechanics & non-accessory bases (editable)
- **AP buff (ally atk enhancement)**: support adds `0.22·(1 + ally_atk_enh)` of its
  base atk to yours. base ally_atk_enh **68.25%** (ark grid 8.25 + evolution T4 44 +
  gems 10 + bracelet 6). Applies to **95%** (default uptime).
- **Brand**: 10% damage buff, scaled by brand power. base brand_power **43.13%**
  (ark grid 13.13 + evolution T4 4 + karmic rank 6 + karmic T4 20). Applies to **100%**.
- **Serenade of Courage (Bard, representative support)**: 15% buff (3 bars), through
  the identity bracket `(1 + ally_dmg)·(1 + spec_eff)`. Applies to **70%**.
- **Major Chord**: the Bard's Tier-4 identity node — a **2%** buff sharing the same
  identity bracket as serenade. Applies to **70%**. (Was missing from the old model.)
- **T-skill**: 10% buff through its **own** ark-grid bracket. base ally_dmg_t **7.13%**
  (t-skill ark grid). Applies to **40%**.
- **Identity bracket base**: base ally_dmg **37.13%** (identity ark grid 27.13 + gems 10);
  spec_eff **55.06%** (spec 1100 × the Bard coefficient); base_add **35.6%** (the damage
  dealer's own additional damage, which dilutes all three identity buffs).

Rough high-tier party-damage contributions (Bard, spec 1100, uptimes above):
brand-neck ≈ +0.70%, ally-atk ring ≈ +0.75%, ally-dmg ring ≈ +1.01%. Per point:
ally-atk ≈ 0.150, ally-dmg ≈ 0.136, brand ≈ 0.087 — all comparable to DPS lines.
Spec and class scale these: at higher spec every identity-bracket line (ally-dmg,
serenade, chord, t-skill) is worth more; non-Bard classes swap the coefficient and
identity base.

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
- **Support identity rework** (from the Bebkok sup-buff sheet): serenade, **Major
  Chord** (previously missing) and the t-skill now share one identity bracket that
  raises the dealer's Additional Damage — each is `base·(1 + ally_dmg)·(1 + spec_eff)`,
  summed, then diluted by the dealer's own base additional. This replaces the old
  additive `serenade_dmg` bag (spec is now a multiplier, not a summand) and fixes
  ally-damage enhancement, whose worth now rides on the bracket size and spec.
- **Catalog**: collapsed to gold-prominent / damage-small cells, three accessories
  side by side. Cut EV folds in `max(DPS, Support)`.
