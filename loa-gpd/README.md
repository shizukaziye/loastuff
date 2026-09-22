# loa-gpd

A gold-per-damage chart for Lost Ark: every progression system on one scale, so
you can see what your next million gold is actually worth.

Two axes. **Support**, where "damage" means the damage a support hands to the
party — the accessory calculator's model, with the party multiplier on the gold
axis so the numbers match the astrogem calculator. **DPS**, where it is the
character's own damage on the bracelet calculator's model.

Systems charted:

- **Honing** — T4 Upper (1675) normal track, +11 through +25. Two rows: all five
  armour pieces together, and the weapon on its own.
- **Karma** — Karmic Enlightenment past level 21.
- **Ability stone** — 7-7 up to 9-7.
- **Skill gems** — levelling the set.
- **Bracelet** — the bracelet calculator's F to S+ ladder, priced by rolling.
- **Accessories** — neck, earring and ring, built live from the accessory
  calculator's price lattice, starting from the growth shop piece (one high line,
  two low flats). Switches above the plan choose which flat-line and main-stat
  families count; the default is no flat line, high main stat.
- **Ark grid** — a simulated account cutting rares or epics, one ladder each,
  priced tier by tier from 250k to 100M gold per 1%.

A character lookup (lostark.bible) places one character on every ladder and
names the cheapest next upgrade.

Game tables come from Maxroll's planner feed and are re-baked by
`python tools/fetch-game-data.py`, which cross-checks itself against bebkok's
gear sheet. See [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

Lives at https://www.loseii.com/loa-gpd/ inside the [loastuff](https://github.com/shizukaziye/loastuff)
monorepo (`loa-gpd/`), since 2026-09-22. `shizukaziye.github.io/loa-gpd` redirects here.
