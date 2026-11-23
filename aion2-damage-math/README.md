# Aion 2 Damage Math

https://www.loseii.com/aion2-damage-math/

What each damage stat is worth on one character, for PvE on the Global client. You enter a sheet (or pick a built-in one) and the page prices every stat for it: the damage formula step by step, a ranking of +1 of each stat, Soul Binding lines and manastones in expected damage, and a compare section that works any upgrade out in Kinah per 1% damage with the arithmetic shown.

## Files

No build. The page is five files, loaded with `?v=` pins:

- `index.html` — the page's markup and its static tables (formula, Global against Korea and Taiwan, confidence, sources)
- `style.css` — one dark theme on `/shared/tokens.css`; the sticky rail sits below the site nav through `--loseii-nav-offset`
- `model.js` — the damage model (`A2`). Pure functions, no DOM. Also runs under node.
- `presets.js` — the built-in sheets and targets (`A2P`). Also runs under node.
- `app.js` — everything on screen: inputs, ranking, charts, compare, saved state (`localStorage` key `aion2-damage-math-v3`)
- `fonts/` — Marcellus (headings), self-hosted, SIL OFL 1.1 (`fonts/OFL.txt`)
- `test.js` — `node test.js`; also `npm run check:aion2-math` at the repo root and a step in `checks.yml`

**Bump a file's `?v=` pin in `index.html` whenever that file changes.** The zone caches `.css` and `.js` for hours, so an unpinned change reaches nobody.

## The model

```
Attack  = (Pure Attack × (1 + Weapon Damage Boost) × Power Shard + Attack Bonus + base Attack)
          × (1 + Attack Increase) + PvE, Boss and Back or Front Attack
Hit     = Attack × skill coefficient + skill flat damage − (Defense − Penetration) ÷ 10
Damage  = Hit × (1 + every Damage Boost − target tolerance) × crit × Double × Multi-hit × rotation
Window  = (Pure Attack + Attack Bonus + base Attack) × (1 + Attack Increase)
```

"Window" is the Attack the character window shows. It leaves out Weapon Damage Boost and the Power Shard and counts the weapon at the middle of its range. The page turns that number back into Pure Attack, the part Weapon Damage Boost multiplies.

`test.js` checks the model three ways: against the per-stat values published for a Korean endgame sheet (Double Chance, Weapon Damage Boost, Critical Damage Boost, Damage Boost, Attack, Max Attack, Attack Bonus, Perfect, Multi-hit), against closed-form derivatives on a Global sheet, and against worked examples from Korean and Taiwanese forum tests of the character window.

## What is measured and what is assumed

The page's own Confidence table is the full list. The parts most likely to move:

- **The character window on Global.** Korean and Taiwanese tests show Weapon Damage Boost is not in the displayed Attack. One Global reading (a 22 Attack helmet line moved Bu's Attack by 28 where her visible 17.1% Attack Increase predicts 26) does not fit yet. The check is to take the Revelation Amulet off: the Attack should not move.
- **Base Attack, 237.** Bu's gear, Attack Bonus and Attack Increase explain 2,444 of the 2,722 her window shows. The rest, before Attack Increase, is entered as base Attack on every built-in sheet. Only Bu's Attack was read in game; the other sheets' Attack is predicted from their gear plus that 237.
- **Filler strength, 50%.** How much of a cooldown or Combat Speed gain turns into damage. It decides most of what Illusion and Time are worth.
- **Global Multi-hit.** One proc worth 15% on top of a 20% hidden chance. The Korean chained model is a switch under Model choices.

## Data with a date on it

- **Material prices** for the ring craft: `PRICE_SETS` in `app.js`, lowest asks on Kinah Ledger read Nov 16, 2026, for Nezekan (Elyos) and Azphel (Asmodian), NA East. Update the numbers and `PRICE_DATE` together, then bump `app.js`'s pin. A visitor who has not edited the comparison gets the new numbers on their next load; one who has keeps their own.
- **Built-in sheets**: gear, points and passives as Shugo.GG showed them on Nov 16, 2026 (`presets.js`). Each sheet's `ring` entry sizes the built-in ring option to that character's own rings and server.
- **Regional differences**: the table in `index.html`. Korea's Nov 11, 2026 patch cut deity points to 0.1% and moved Amplified stages to Damage Boost, which is why older Korean guides disagree with it.

## Saved state

`app.js` keeps one object in `localStorage`, versioned by `v`. `merge()` upgrades older saves; when a change makes old numbers wrong (a new reading of the character window, new built-in options), bump `v` and say in `merge()` what happens to a save from before.
