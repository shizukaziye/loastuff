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

- A press can land any mix of useful lines. `enumerate` lists every mix of up to four at once; values sit on a fine grid for one line and coarser grids for two, three and four. Slots of one class are alike, so each mix is counted once with its multiplicity.
- `forward` follows the policy from any state and returns the expected crystals, presses and damage. `simulate` plays the same policy with a seeded generator for the spread of the bill.
- **Critical Hit and Damage Boost are curves, not unit prices.** Each point makes the next worth less, and Critical Hit is worth nothing past the crit cap. `plan` prices both at the slope of the curve where the plan ends, and for Critical Hit it searches for the price at which the plan lands on the cap and no further. Reported damage uses the curves themselves (`valuer.critAt`, `poolAt`).
- Damage per line comes from Damage Math's `A2` model on the chosen sheet (`valuer`). A genus Damage Boost line counts only on its own board, against bosses of that genus.

## Checks (`test.js`)

- Press costs against the client's table.
- Raid Relay's finished-board table: four chosen Heroic lines 25,500 crystals (solver 25,489), four Unique-or-better 6,300 (6,347), Special about 2,400 cheaper (2,438).
- Line values on Paroxysmal's sheet against the figures first worked out by hand.
- The books balance: price x gain - cost equals the value the solver reports.
- Boards played roll by roll with true continuous rolls and the solver's rules: bill, gain and net within a few percent of what it expects. This is the test of the grids.
- The plan: a higher price never buys less, it stops at the crit cap, cold and warm starts agree, and a started board is left alone at a low price.

## What is assumed

The page's own "What the page assumes" list is the full set. The ones most likely to move:

- **Rolls are even inside a grade's range.** The client does not say.
- **Lines below Unique count as nothing.**
- **Genus Damage Boost adds into the Damage Boost sum.** Untested. If it multiplies on its own it is worth more.
- **Crystals a week** (6,500 free, 27,500 with three keys a day) are as of late November 2026 and sit in `index.html` as two buttons and a paragraph.

## Saved state

`app.js` keeps one object in `localStorage`, versioned by `v`. `merge()` drops anything it does not recognise. "My Damage Math sheet" reads Damage Math's own save (`aion2-damage-math-v3`) and never writes to it.
