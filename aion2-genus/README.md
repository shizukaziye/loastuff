# Aion 2 Genus Boards

https://www.loseii.com/aion2-genus/

The most damage from Genus Insight for the fewest Soul Crystals, for PvE on the Global client. You set a budget; the page says which lines to lock on each of the five boards, when to lock them and when to stop. Enter a board as it stands and its card gives the next move and the cost left.

## Files

No build. Each file loads with a `?v=` pin:

- `index.html`: the markup and the static text (how it works, what it assumes, sources)
- `style.css`: only what Damage Math's stylesheet lacks (tiles, tabs, lock table, board cards)
- `genus.js`: the game's numbers and the solver (`A2G`). Pure functions, no DOM. Also runs under node.
- `app.js`: everything on screen and the saved state (`localStorage` key `aion2-genus-v1`)
- `test.js`: `node test.js`; also `npm run check:aion2-genus` at the repo root and a step in `checks.yml`

The page also loads three files from `/aion2-damage-math/`: `style.css` (the look), `model.js` (the damage model, `A2`) and `presets.js` (the built-in sheets, `A2P`). **When one of those changes, bump its pin in this folder's `index.html` too.** `tools/check-cross-pins.mjs` fails until you do.

**Bump a file's `?v=` pin in `index.html` whenever that file changes.** The zone caches `.css` and `.js` for hours.

## The game's numbers (`genus.js`, top of file)

- A press costs 4 Soul Crystals for each open slot plus a lock charge: 0, 8, 16, 36, 76, 156, 236, 316, 396 for 0 to 8 locks. Each crystal also costs 250 Kinah.
- At Insight 10 a slot rolls Heroic 5% and Unique 15%. The line is drawn evenly from the slot's list: 10 lines in slots 1, 3, 5, 6, 9; 12 in slots 2 and 8; 14 in slots 4 and 7 (12 on Special).
- `LINES` holds each line's Heroic and Unique range; `BOARDS`, `S15`, `S369`, `S7M`, `S7S` hold the lists.

Heroic ranges and the lists are from Aion2Data's read of the client (build 2026.11.11). Unique ranges marked `uRead` are printed in a guide; the rest are the printed minimum doubled. The Auto Analysis window shows each grade's minimum and maximum, so they are easy to check in game.

## The solver

A board's state is which slots are locked. After a press you may stop (every line stays), press again, or lock some of what shows and press again. `solveBoard` finds, for each of the 48 states, what one more press is worth:

```
W(state) = -cost(state) + E[ max( stop and keep it all,
                                  W(state),
                                  best over subsets L of the lines showing: value(L) + W(state + L) ) ]
```

Values are `price x % damage`, where price is the Soul Crystals paid for +1% damage. The page picks the price whose plan spends your budget (`sweep`, `priceFor`), then runs `plan` at that price.

- A press can land any mix of useful lines. `enumerate` lists every mix of up to four at once; values sit on a fine grid for one line (five per line and grade) and coarser grids for two, three and four (7, 3 and 2 bins). Slots of one class are alike, so each mix is counted once with its multiplicity.
- `forward` follows the policy from any state and returns the expected crystals, presses and damage. `simulate` plays the same policy with a seeded generator for the spread of the bill.
- **Critical Hit, Accuracy and Damage Boost are curves, not unit prices.** Each point makes the next worth less, and Critical Hit and Accuracy are worth nothing past their caps. `plan` prices all three at the slope of the curve where the plan ends. For the two capped stats it searches, one after the other, for the price at which the plan lands on the cap and no further (`settle`). Reported damage uses the curves themselves (`valuer.critAt`, `accAt`, `poolAt`).
- Damage per line comes from Damage Math's `A2` model on the chosen sheet (`valuer`). A genus Damage Boost line counts only on its own board, against bosses of that genus.

## Line formulas (`valuer`)

All values are `100 x ln(damage after / damage before)`, so they add.

| Line | How it is priced |
|---|---|
| PvE, plain and genus Damage Boost | one sum: `1 + Damage Boost + PvE + Boss - target tolerance`; a curve (`poolAt`) |
| Double Chance, Weapon Damage Boost, Multi-hit, Perfect | `A2` gain per 1%, on the sheet |
| Front and Back Attack Damage Boost | `A2` gain on the share of hits from that side (below) |
| Attack Bonus, Max Attack | `A2` gain per point. Max Attack adds half its value to average Attack, plus Perfect |
| Critical Hit | 10 points above the boss's resist = 1% crit, capped at 50%; a curve (`critAt`), zero past the cap |
| Front and Back Attack Critical Hit | Critical Hit times the share of hits from that side |
| Critical Damage Boost | `A2` gain at the crit rate the plan ENDS with (`critLines`), not today's |
| PvE, Boss, Front, Back and Critical Attack | left out (`LEFT_OUT`); see below |
| Accuracy Bonus, PvE Accuracy | parry chance = 6.7% per 100 Accuracy short of the boss's Block, capped at 80%; a parried hit loses half; hits from behind are never parried; a curve (`accAt`), zero once the gap is closed |
| Power Shard Damage Bonus | 100 points = 1% on the shard's bonus |

- **Left out: PvE Attack, Boss Attack, Front Attack, Back Attack, Critical Attack** (Shizu's call, 2026-11-22). The solver never locks them and the dropdowns do not list them; `valuer` still prices them so the tests can show the comparison. Why:
  - All five are added after Attack Increase, so Weapon Damage Boost, the Power Shard and Attack Increase never multiply them (Kanon's Bible: "Because this added after Attack Increase the value is less than Pure Attack").
  - Each counts only under a condition: on a boss (Boss Attack measured 0 on the training dummy), from one side, on a crit (and Critical Attack is cut by the target's Critical Damage Defense), never in PvP.
  - The one measured Global test (Aion 2 Maps, one Ranger, build of 2026-10-28): 10 Attack = +0.27% on bosses, 10 Boss Attack = +0.13% to +0.14%. That is half of Attack per point; the `A2` formula gives about 0.6, so the model prices PvE and Boss Attack some 15% to 35% high. At the measured rate a 20 roll is about +0.27% to +0.32%, under Attack Bonus 16 (+0.36%) and Max Attack 20 (+0.34%) on Paroxysmal's sheet.
  - Kanon's tiers: Attack, Max Attack, Attack Bonus first; PvE and Boss Attack second; Front, Back, Species and Critical Attack last. No source calls PvE or Boss Attack bad outright, and nobody has published a measured Global value for PvE Attack, Max Attack or Attack Bonus.
  - Cost of leaving them out: about 0.3% counted damage at a 100,000-crystal budget.
- **Sides.** `stance` is the side you fight from. Front lines count on `frontRate` (85%) of hits when you play the front and back lines on the rest; play the back and it is `backRate` (70%) from behind. The share that can be parried is everything not from behind.
- **Half for capped stats.** `capWeight` (50%) scales the Critical Hit and Accuracy curves when the solver chooses. `plan.total` is that counted damage; `plan.real` is every line at full on today's sheet.

## Checks (`test.js`)

- Press costs against the client's table.
- Raid Relay's finished-board table: four chosen Heroic lines 25,500 crystals (solver 25,489), four Unique-or-better 6,300 (6,347), Special about 2,400 cheaper (2,438).
- Line values on Paroxysmal's sheet: front and back shares, the accuracy formula by hand, crit-only lines at today's crit and at the cap, and Max Attack against Attack Bonus on a Korean and a Global sheet.
- The books balance: price x gain - cost equals the value the solver reports.
- Boards played roll by roll with true continuous rolls and the solver's rules: bill, gain and net within a few percent of what it expects. This is the test of the grids.
- The plan: a higher price never buys less, no plan beats a perfect set, it stops at the crit and accuracy caps, counted and real damage add up as defined, cold and warm starts agree, and a started board is left alone at a low price.

## What is assumed

The page's own "What the page assumes" list is the full set. The ones most likely to move:

- **Rolls are even inside a grade's range.** The client does not say.
- **Lines below Unique count as nothing.**
- **Genus Damage Boost adds into the Damage Boost sum.** Untested. If it multiplies on its own it is worth more.
- **The parry figures are player tests** (Aion 2 Maps, Timesaver): 6.66 to 10 per 100 Accuracy, 20% to 50% lost on a parried hit. `OPTS` holds 6.7 and 50.
- **Accuracy starts at 1,000 against 1,200.** The sheets carry no Accuracy, so this is a guess until the visitor types theirs.
- **Crystals a week** (6,500 free, 27,500 with three keys a day) are as of late November 2026 and sit in `index.html` as two buttons and a paragraph.

## Saved state

`app.js` keeps one object in `localStorage`, versioned by `v`. `merge()` drops anything it does not recognise. "My Damage Math sheet" reads Damage Math's own save (`aion2-damage-math-v3`) and never writes to it.
