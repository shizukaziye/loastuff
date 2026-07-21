# Lost Ark Accessory Value Calculator

An interactive, from-first-principles model for pricing cut accessories
(necklace / earring / ring) under the Ark Passive system.

**Live site:** `index.html` — open it locally or via GitHub Pages. Everything
computes in-browser; edit the inputs and hit **Recalculate**.

## What it does

- Enumerates every 3-cut outcome (closed-form, no Monte Carlo) from the
  official Korean drop rates (6.3% / 3.0% / 0.7% per effect tier, renormalized
  after each locked line).
- Scores damage **multiplicatively** via the sqrt attack-power model
  (`atk = sqrt(weapon_power · main_stat / 6)`, diluted by a support), working
  in log-multiplier space so damage is additive.
- Prices each slot by matching a **supply curve** (cut probabilities × 5
  main-stat quintiles — min/low/mid/high/max, hover any of them on the site for
  the exact stat) to an **80/20 Pareto demand curve**, integrated above a
  zero-value baseline, then subtracting the **pheon tax** (default 60k).
- Solves the optimal cutting policy via Bellman DP.

## Interactive inputs

- **Anchor prices** (net gold) for the cheapest high/mid and high/high of each
  slot, clamped 10k–10M. The model fits `(a, pmin)` per slot to reproduce them.
- **Character stats**: non-accessory additional damage %, attack power %, crit
  rate / crit damage, base weapon power, base main stat, support attack
  multiplier, and the pheon tax.
- **HP flat toggle** (`Junk` / `= Wpn`): optionally value `Max HP+` lines exactly
  like `Weapon Attack Power+` at the same tier, in both markets — more premium
  outcomes, recalibrated prices, higher cut EV. (Python: `value --hp-as-wp`.)

Change anything and click Recalculate — the damage table, catalog, and EV all
update live (~0.3s).

## Files

- `index.html` — the interactive calculator (self-contained HTML + JS, the
  published page), including support-accessory valuation, the DPS/Support market
  toggle, and `max(DPS, Support)` cut EV.
- `accessory_value.py` — Python reference in **full parity** with the site
  (same DPS + Support model, derived neck-only anchors, uptimes, corrections).
  `python3 accessory_value.py verify` runs closed-form checks and asserts the
  numbers match values captured from the live page (anchors, calibration
  `a`/`pmin`, EV, a support-only roll, etc.). `python3 accessory_value.py value
  --type neck --main-stat 17000 --line "Outgoing Damage %" high --line
  "Additional Damage %" mid` prices a specific accessory in both markets.

No dependencies (Python stdlib only; the site is plain JS).
