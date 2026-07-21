# CLAUDE.md — project guide

Lost Ark accessory **value / cut-EV calculator**. A single-page web app plus a
Python reference. Prices cut accessories for both **DPS** and **Support**
markets, recommends what to cut, and plans purchases against a budget.

## Files (only these)

- **`index.html`** — the entire app: self-contained HTML + CSS + vanilla JS, no
  build, no deps. This is the published page (GitHub Pages) **and the
  authoritative model**. Everything computes in-browser from editable inputs.
- **`accessory_value.py`** — Python reference in **full parity** with the JS.
  `python3 accessory_value.py verify` asserts it reproduces values captured from
  the live page (stored in `REFS`). `value` prices a single roll in both markets.
- **`README.md`** — user-facing overview.
- No other source files; `.claude/` is gitignored.

## The model (mirror exactly across both files)

- **Damage is multiplicative** → score each accessory by `D = 100·ln(total
  multiplier)` (additive, ~percent for small values).
- **DPS lines**: Outgoing = direct %; Additional = `acc/(1+base_additional)`;
  atk/weapon power, flats, main stat run through `atk = sqrt(WP·MS/6)`,
  `total_atk = (atk + sup·k)(1+atk%) + flat`; crit via `cr·cd·1.12 + (1-cr)`.
  `k` (support's atk buff to you) is **derived**: `0.22·(1+ally_atk_enh)·ap_uptime`.
- **Support quality** = party-damage contribution (above a no-accessory support):
  `Q = 100·ln(brand·tskill·serenade·ap)`, each buff scaled by an editable uptime
  (brand/AP/serenade/t-skill; AP default 95%). Lines: Stigma→brand, Gauge→
  serenade gain (half-effective uptime), Ally Dmg→t-skill+serenade, Ally Atk→ap,
  Weapon%/flat/main-stat→support base atk.
- **Pricing**: supply `F(D)` = share of full cuts (all 19,440 outcomes × 5
  main-stat quintiles min/low/mid/high/max, 20% each — `msLevels`/`ms_levels`) scoring ≤ D. Demand = 80/20 Pareto `pmin·(1−F)^(−1/a)`.
  Value = ∫ price over [baseline, D] − pheon tax, floored at 0. Baseline =
  better-primary-high / nothing / nothing at min main stat (= 0). **Calibration
  is cap-free** (the demand cap breaks pmin-linearity). Only the **necklace**
  anchors are inputs; earring/ring anchors derived by damage-above-baseline ratio.
- **Cut EV** = `max(DPS, Support)` per outcome; optimal cut via Bellman DP.
- **hpAsWp toggle** (`HP flat = Wpn`, default off): `Max HP+` is aliased to
  `Weapon Attack Power+` at the value layer (`effName`/`eff_name`) in both
  markets; supply reshapes and everything recalibrates. Anchors stay pinned
  (their rolls contain no HP line). JS `setHP()` / Python `set_hp_as_wp()`.
- **Budget planner**: per-slot cost→damage efficient frontier over primary pair ×
  flat tier × main-stat quintile; merge slots by gold/1%-damage; budget buys the
  cheapest-per-damage prefix.

## Conventions / workflow

- **Validate JS in the browser**, not by reading. Use the Claude Preview MCP:
  serve via `.claude/launch.json` (python http.server on the project dir),
  `preview_start`, then `preview_eval` to call the page's functions and check
  numbers / `preview_console_logs` for errors. (Screenshots have been flaky;
  rely on DOM/eval.)
- **Keep Python in parity**: after changing the JS model, re-capture reference
  numbers from the page and update `REFS` in `accessory_value.py`, then
  `python3 accessory_value.py verify` must pass.
- **Inputs are editable + recalc**: anchors (neck DPS/Support h-m & h-h + pheon
  tax in row 1), DPS character stats (row 2), support buff totals + uptimes.
- Commit + push when done; site is GitHub Pages
  (`https://shizukaziye.github.io/lost-ark-accessories/`). Git is authenticated
  on the dev machine.

## Don't

- Don't add a build step or dependencies — keep `index.html` self-contained.
- Don't reintroduce a "support atk mult" input — it's derived from uptime+enh.
- Don't let the demand cap into calibration (only into final pricing).
